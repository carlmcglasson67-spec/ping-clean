// TEST-ONLY stand-in for Supabase Auth (GoTrue) and the REST API (PostgREST), for
// running the real app end to end where Docker isn't available. Not a mock of the data:
// every REST query runs against the real migrated Postgres as the signed-in user
// (SET ROLE authenticated + request.jwt.claims), so row level security decides what
// comes back, exactly as on Supabase. Supports only the PostgREST subset Ping uses:
//   select=cols | col=eq./neq./gt./gte./lt./lte./in.(…) | order=col.asc|desc | limit=n
//   HEAD + Prefer: count=exact | POST /rpc/<fn>
// Never deploy this. Real environments use a real Supabase project.
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";
import pg from "pg";

// PostgREST returns numeric and bigint as JSON numbers; node-postgres returns strings.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// PostgREST returns date columns as plain "YYYY-MM-DD" strings.
pg.types.setTypeParser(1082, (v) => v);

const SECRET = "ping-e2e-only-secret-not-for-real-use-000000";
const pool = new pg.Pool({ connectionString: process.env.PING_TEST_DATABASE_URL, max: 6 });
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Object.assign(new Error(`bad identifier ${s}`), { status: 400 });
  return `"${s}"`;
};

const b64u = (b) => Buffer.from(b).toString("base64url");
function signJwt(claims) {
  const head = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = String(token ?? "").split(".");
  if (!h || !b || !s) return null;
  const want = createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url");
  if (want !== s) return null;
  const claims = JSON.parse(Buffer.from(b, "base64url").toString());
  return claims.exp * 1000 > Date.now() ? claims : null;
}

async function userJson(id) {
  const { rows } = await pool.query(`select id, email, raw_user_meta_data, created_at from auth.users where id = $1`, [id]);
  const u = rows[0];
  return u && { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, user_metadata: u.raw_user_meta_data ?? {}, app_metadata: { provider: "email" }, created_at: u.created_at };
}

async function session(userId) {
  const user = await userJson(userId);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  return {
    access_token: signJwt({ sub: userId, role: "authenticated", aud: "authenticated", email: user.email, iat, exp, session_id: randomUUID() }),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: `rt.${userId}`,
    user,
  };
}

/** Runs fn in a transaction as the bearer token's user (or anon). */
async function asUser(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const role = claims ? "authenticated" : "anon";
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims ?? { role: "anon" })]);
    await c.query(`set local role ${role}`);
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function buildSelect(table, params) {
  const values = [];
  const cols = (params.get("select") ?? "*").split(",").map((c) => (c.trim() === "*" ? "*" : ident(c.trim()))).join(", ");
  const where = [];
  const ops = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
  for (const [k, v] of params) {
    if (["select", "order", "limit", "offset"].includes(k)) continue;
    const dot = v.indexOf(".");
    const op = v.slice(0, dot);
    const val = v.slice(dot + 1);
    if (op === "in") {
      const list = val.replace(/^\(|\)$/g, "").split(",").map((x) => x.replace(/^"|"$/g, ""));
      values.push(list);
      where.push(`${ident(k)}::text = any($${values.length}::text[])`);
    } else if (op === "is") {
      where.push(`${ident(k)} is ${val === "null" ? "null" : val === "true" ? "true" : "false"}`);
    } else if (ops[op]) {
      values.push(val);
      where.push(`${ident(k)} ${ops[op]} $${values.length}`);
    } else throw Object.assign(new Error(`unsupported filter ${op}`), { status: 400 });
  }
  let sql = `select ${cols} from public.${ident(table)}`;
  if (where.length) sql += ` where ${where.join(" and ")}`;
  const order = params.get("order");
  if (order) {
    sql += " order by " + order.split(",").map((o) => {
      const [c, dir] = o.split(".");
      return `${ident(c)} ${dir === "desc" ? "desc" : "asc"}`;
    }).join(", ");
  }
  const limit = Number(params.get("limit"));
  if (limit) sql += ` limit ${Math.min(limit, 1000)}`;
  return { sql, values };
}

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
};

const readBody = (req) => new Promise((r) => {
  let d = "";
  req.on("data", (c) => (d += c));
  req.on("end", () => r(d ? JSON.parse(d) : {}));
});

export function startFakeSupabase(port = 54321) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    const claims = verifyJwt(bearer);
    try {
      // ---------------- auth
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
        const { email, password } = await readBody(req);
        const { rows } = await pool.query(
          `select id from auth.users where email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)`,
          [String(email).toLowerCase(), String(password)],
        );
        if (!rows[0]) return send(res, 400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
        return send(res, 200, await session(rows[0].id));
      }
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
        const { refresh_token } = await readBody(req);
        const id = String(refresh_token).replace(/^rt\./, "");
        return send(res, 200, await session(id));
      }
      if (url.pathname === "/auth/v1/user") {
        if (!claims) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
        return send(res, 200, await userJson(claims.sub));
      }
      if (url.pathname === "/auth/v1/logout") return send(res, 204);

      // ---------------- rest
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (rpc) {
        const rows = await asUser(claims, (c) => c.query(`select * from public.${ident(rpc[1])}()`)).then((r) => r.rows);
        return send(res, 200, rows);
      }
      const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
      if (table && (req.method === "GET" || req.method === "HEAD")) {
        const { sql, values } = buildSelect(table[1], url.searchParams);
        const rows = await asUser(claims, (c) => c.query(sql, values)).then((r) => r.rows);
        const wantsCount = /count=exact/.test(String(req.headers.prefer ?? ""));
        const range = `0-${Math.max(rows.length - 1, 0)}/${wantsCount ? rows.length : "*"}`;
        if (req.method === "HEAD") return send(res, 200, undefined, { "content-range": range });
        return send(res, 200, rows, { "content-range": range });
      }
      return send(res, 404, { message: `fake-supabase: ${req.method} ${url.pathname} not supported` });
    } catch (e) {
      return send(res, e.status ?? 400, { code: e.code ?? "PGRST000", message: e.message });
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, close: async () => { server.close(); await pool.end(); } })));
}
