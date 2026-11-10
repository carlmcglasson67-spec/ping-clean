// TEST-ONLY stand-in for Supabase Auth (GoTrue) and the REST API (PostgREST), for
// running the real app end to end where Docker isn't available. Not a mock of the data:
// every REST query runs against the real migrated Postgres as the signed-in user
// (SET ROLE authenticated + request.jwt.claims), so row level security decides what
// comes back, exactly as on Supabase. Supports only the PostgREST subset Ping uses:
//   select=cols | col=eq./neq./gt./gte./lt./lte./in.(…) | order=col.asc|desc | limit=n
//   HEAD + Prefer: count=exact | POST /rpc/<fn> with named args (filters apply to set-returning ones)
//   PATCH (update) and POST (insert), with Prefer: return=representation|minimal
//   Storage: upload (owner + size metadata), sign one or many, and fetch-by-signed-URL, gated by the real
//   storage.objects policies. File bytes live in memory only. CORS like Supabase.
//   Auth: password sign-in, sign-up, resend, recovery and verify (email links go to a test outbox).
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
/** TEST-ONLY service-role key for this fake, signed like Supabase's (role: service_role). */
export function fakeServiceRoleKey() {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ role: "service_role", iss: "fake-supabase", iat: now, exp: now + 24 * 3600 });
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

// How each session was signed in, as GoTrue's `amr` claim: "password" for a sign-in, and
// "otp" for EVERY email link verified with a token hash (reset, sign-up, magic link…),
// exactly as GoTrue does (internal/api/verify.go, verifyPost:
// `a.issueRefreshToken(r, w.Header(), tx, user, models.OTP, grantParams)`).
// Kept per refresh token with the session id, so a refreshed session keeps its id, method
// and time, as in GoTrue.
const sessions = new Map();
async function session(userId, method = "password", kept = null) {
  const user = await userJson(userId);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;
  const info = kept ?? { amr: [{ method, timestamp: iat }], sid: randomUUID() };
  const refresh = `rt.${userId}.${randomUUID()}`;
  sessions.set(refresh, info);
  return {
    access_token: signJwt({ sub: userId, role: "authenticated", aud: "authenticated", email: user.email, iat, exp,
      session_id: info.sid, aal: "aal1", amr: info.amr }),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: exp,
    refresh_token: refresh,
    user,
  };
}

/** Runs fn in a transaction as the bearer token's user (or anon). */
async function asUser(claims, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    // The service-role key (a JWT with role "service_role", as on Supabase) runs as the
    // service_role database role: the only caller register_interest accepts.
    const role = claims?.role === "service_role" ? "service_role" : claims ? "authenticated" : "anon";
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

const selectCols = (params) =>
  (params.get("select") ?? "*").split(",").map((c) => (c.trim() === "*" ? "*" : ident(c.trim()))).join(", ");

/** A GET's select. `from` defaults to the table; a set-returning RPC passes its call (and its args in `values`). */
function buildSelect(table, params, from = `public.${ident(table)}`, values = []) {
  const cols = selectCols(params);
  const where = buildWhere(params, values);
  let sql = `select ${cols} from ${from}`;
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

// Column types, so JSON bodies can be bound correctly (jsonb vs text[]).
const columnTypes = new Map();
async function colType(table, col) {
  const key = `${table}.${col}`;
  if (!columnTypes.has(key)) {
    const { rows } = await pool.query(
      `select data_type from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`,
      [table, col],
    );
    columnTypes.set(key, rows[0]?.data_type ?? "text");
  }
  return columnTypes.get(key);
}
async function bind(table, col, v) {
  return (await colType(table, col)) === "jsonb" ? JSON.stringify(v) : v;
}

/** PATCH /rest/v1/<table>?filters — an UPDATE as the signed-in user (RLS applies). */
async function buildUpdate(table, params, body) {
  const values = [];
  const sets = [];
  for (const [k, v] of Object.entries(body)) {
    values.push(await bind(table, k, v));
    sets.push(`${ident(k)} = $${values.length}`);
  }
  const where = buildWhere(params, values);
  let sql = `update public.${ident(table)} set ${sets.join(", ")}`;
  if (where.length) sql += ` where ${where.join(" and ")}`;
  return { sql: `${sql} returning ${selectCols(params)}`, values };
}

/** POST /rest/v1/<table> — an INSERT of one row or many, as the signed-in user. */
async function buildInsert(table, params, body) {
  const rows = Array.isArray(body) ? body : [body];
  const cols = Object.keys(rows[0] ?? {});
  const values = [];
  const tuples = [];
  for (const r of rows) {
    const ph = [];
    for (const c of cols) {
      values.push(await bind(table, c, r[c] ?? null));
      ph.push(`$${values.length}`);
    }
    tuples.push(`(${ph.join(", ")})`);
  }
  return {
    sql: `insert into public.${ident(table)} (${cols.map(ident).join(", ")}) values ${tuples.join(", ")} returning ${selectCols(params)}`,
    values,
  };
}

// ---------------- email (test only)
// Sign-up, resend and recovery "send" their links here instead of by email. The links are
// built the way Ping's Supabase email templates build them: {{ .RedirectTo }}&token_hash=…&type=…
const outbox = []; // { email, type, link }
const tokens = new Map(); // token_hash -> { userId, type }
const config = { confirm: true }; // Supabase "Confirm email" setting
// The links Ping's email templates produce. They're built from the Site URL alone, never
// from RedirectTo (see the PR's template steps), so a redirect mismatch can't break them:
//   {{ .SiteURL }}/auth/confirm?flow=signup&token_hash={{ .TokenHash }}&type=email
//   {{ .SiteURL }}/auth/confirm?flow=reset&token_hash={{ .TokenHash }}&type=recovery
// The Site URL is fixed, as it is in the Supabase project's settings, and never taken from
// the request's redirect address: if the app ever ran on a different host from the Site
// URL, these links would point elsewhere and the e2e checks would fail.
let SITE_URL = "http://127.0.0.1:3200";
function mail(email, type, userId) {
  const hash = randomUUID().replace(/-/g, "");
  tokens.set(hash, { userId, type });
  const site = SITE_URL;
  const link = type === "signup"
    ? `${site}/auth/confirm?flow=signup&token_hash=${hash}&type=email`
    : `${site}/auth/confirm?flow=reset&token_hash=${hash}&type=recovery`;
  outbox.push({ email, type, link });
}
const userByEmail = async (email) =>
  (await pool.query(`select id, email_confirmed_at from auth.users where email = $1`, [String(email ?? "").toLowerCase()])).rows[0];

function buildWhere(params, values) {
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
  return where;
}

// The browser talks to Supabase directly for uploads, so answer CORS like Supabase does.
const CORS = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" };

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { "content-type": "application/json", ...CORS, ...headers });
  res.end(body === undefined || status === 204 ? "" : JSON.stringify(body));
};

const readRaw = (req) => new Promise((r) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => r(Buffer.concat(chunks)));
});
const readBody = async (req) => {
  const d = (await readRaw(req)).toString();
  return d ? JSON.parse(d) : {};
};

// Signed storage URLs: HMAC over bucket/path/expiry, checked when the URL is fetched.
const signPath = (bucket, path, exp) => createHmac("sha256", SECRET).update(`${bucket}/${path}:${exp}`).digest("base64url");
const storedFiles = new Map(); // "<bucket>/<path>" → { type, bytes }

export function startFakeSupabase(port = 54321, { siteUrl } = {}) {
  if (siteUrl) SITE_URL = siteUrl;
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
        const u = await userByEmail(email);
        if (!u.email_confirmed_at) return send(res, 400, { code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" });
        return send(res, 200, await session(rows[0].id));
      }
      if (url.pathname === "/auth/v1/signup" && req.method === "POST") {
        const { email, password, data } = await readBody(req);
        const redirectTo = url.searchParams.get("redirect_to");
        const existing = await userByEmail(email);
        if (existing) {
          // Real GoTrue: with confirmation on, an existing address gets a look-alike success.
          if (config.confirm) return send(res, 200, { id: randomUUID(), aud: "authenticated", role: "authenticated", email, identities: [], user_metadata: {}, app_metadata: {} });
          return send(res, 422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
        }
        const id = randomUUID();
        await pool.query(
          `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
           values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, extensions.crypt($3, extensions.gen_salt('bf')), $4,
                   '{"provider":"email","providers":["email"]}', $5, '', '', '', '')`,
          [id, String(email).toLowerCase(), String(password), config.confirm ? null : new Date(), JSON.stringify(data ?? {})],
        );
        if (!config.confirm) return send(res, 200, await session(id));
        mail(String(email).toLowerCase(), "signup", id, redirectTo);
        return send(res, 200, await userJson(id));
      }
      if (url.pathname === "/auth/v1/resend" && req.method === "POST") {
        const { email, type } = await readBody(req);
        const u = await userByEmail(email);
        if (u && !u.email_confirmed_at && type === "signup") mail(String(email).toLowerCase(), "signup", u.id, url.searchParams.get("redirect_to"));
        return send(res, 200, {});
      }
      if (url.pathname === "/auth/v1/recover" && req.method === "POST") {
        const { email } = await readBody(req);
        const u = await userByEmail(email);
        if (u) mail(String(email).toLowerCase(), "recovery", u.id, url.searchParams.get("redirect_to"));
        return send(res, 200, {}); // same answer whether or not the address has an account
      }
      if (url.pathname === "/auth/v1/verify" && req.method === "POST") {
        const { token_hash, type } = await readBody(req);
        const t = tokens.get(String(token_hash));
        const want = type === "email" || type === "signup" ? "signup" : type;
        if (!t || t.type !== want) return send(res, 403, { code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" });
        tokens.delete(String(token_hash)); // links work once
        if (t.type === "signup") await pool.query(`update auth.users set email_confirmed_at = now() where id = $1`, [t.userId]);
        return send(res, 200, await session(t.userId, "otp")); // every type, as GoTrue
      }
      if (url.pathname === "/auth/v1/user" && req.method === "PUT") {
        if (!claims) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
        const { password, data } = await readBody(req);
        if (password) {
          const same = await pool.query(`select 1 from auth.users where id = $1 and encrypted_password = extensions.crypt($2, encrypted_password)`, [claims.sub, String(password)]);
          if (same.rows[0]) return send(res, 422, { code: 422, error_code: "same_password", msg: "New password should be different from the old password." });
          await pool.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id = $1`, [claims.sub, String(password)]);
        }
        if (data) await pool.query(`update auth.users set raw_user_meta_data = raw_user_meta_data || $2::jsonb where id = $1`, [claims.sub, JSON.stringify(data)]);
        return send(res, 200, await userJson(claims.sub));
      }
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
        const { refresh_token } = await readBody(req);
        const id = String(refresh_token).split(".")[1];
        return send(res, 200, await session(id, "password", sessions.get(String(refresh_token))));
      }
      if (url.pathname === "/auth/v1/user") {
        if (!claims) return send(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
        return send(res, 200, await userJson(claims.sub));
      }
      if (url.pathname === "/auth/v1/logout") return send(res, 204);

      if (req.method === "OPTIONS") {
        return send(res, 204, undefined, {
          "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS",
          "access-control-allow-headers": String(req.headers["access-control-request-headers"] ?? "*"),
          "access-control-max-age": "600",
        });
      }

      // ---------------- storage (private buckets; storage.objects RLS decides, as on Supabase)
      const signMany = url.pathname.match(/^\/storage\/v1\/object\/sign\/([a-z-]+)$/);
      if (signMany && req.method === "POST") {
        const [, bucket] = signMany;
        const { expiresIn, paths } = await readBody(req);
        const exp = Math.floor(Date.now() / 1000) + Number(expiresIn);
        const out = [];
        for (const path of paths ?? []) {
          const found = await asUser(claims, (c) => c.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, path]));
          out.push(found.rows[0]
            ? { path, error: null, signedURL: `/object/sign/${bucket}/${encodeURI(path)}?token=${exp}.${signPath(bucket, path, exp)}` }
            : { path, error: "Either the object does not exist or you do not have access to it", signedURL: null });
        }
        return send(res, 200, out);
      }
      const signed = url.pathname.match(/^\/storage\/v1\/object\/sign\/([a-z-]+)\/(.+)$/);
      if (signed && req.method === "POST") {
        const [, bucket, path] = signed;
        const { expiresIn } = await readBody(req);
        const found = await asUser(claims, (c) => c.query(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, decodeURIComponent(path)]));
        if (!found.rows[0]) return send(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
        const exp = Math.floor(Date.now() / 1000) + Number(expiresIn);
        return send(res, 200, { signedURL: `/object/sign/${bucket}/${path}?token=${exp}.${signPath(bucket, decodeURIComponent(path), exp)}` });
      }
      if (signed && req.method === "GET") {
        const [, bucket, path] = signed;
        const [exp, sig] = String(url.searchParams.get("token") ?? "").split(".");
        const name = decodeURIComponent(path);
        if (!sig || sig !== signPath(bucket, name, exp) || Number(exp) * 1000 < Date.now()) {
          return send(res, 400, { statusCode: "400", error: "InvalidJWT", message: "invalid signature or expired" });
        }
        const file = storedFiles.get(`${bucket}/${name}`);
        res.writeHead(200, { "content-type": file?.type ?? "application/octet-stream", ...CORS });
        return res.end(file?.bytes ?? Buffer.alloc(0));
      }
      const object = url.pathname.match(/^\/storage\/v1\/object\/([a-z-]+)\/(.+)$/);
      if (object && req.method === "POST") {
        const [, bucket, path] = object;
        const name = decodeURIComponent(path);
        const bytes = await readRaw(req);
        try {
          // Like Supabase: the uploader owns it, and metadata records its size (complete_visit checks both).
          await asUser(claims, (c) => c.query(
            `insert into storage.objects (bucket_id, name, owner, metadata) values ($1, $2, $3, $4)`,
            [bucket, name, claims?.sub ?? null, JSON.stringify({ size: bytes.length, mimetype: String(req.headers["content-type"] ?? "") })],
          ));
        } catch (e) {
          return send(res, 400, { statusCode: "403", error: "Unauthorized", message: e.message });
        }
        storedFiles.set(`${bucket}/${name}`, { type: String(req.headers["content-type"] ?? ""), bytes });
        return send(res, 200, { Key: `${bucket}/${name}`, Id: randomUUID() });
      }

      // ---------------- test-only controls
      if (url.pathname === "/__test/mail") {
        const found = outbox.filter((m) => m.email === url.searchParams.get("email") && (!url.searchParams.get("type") || m.type === url.searchParams.get("type")));
        return send(res, found.length ? 200 : 404, found.at(-1) ?? { message: "no mail" });
      }
      if (url.pathname === "/__test/config" && req.method === "POST") {
        Object.assign(config, await readBody(req));
        return send(res, 200, config);
      }

      // ---------------- rest
      const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
      if (rpc) {
        const fn = rpc[1];
        const args = req.method === "POST" ? await readBody(req) : {};
        const names = Object.keys(args);
        const call = `public.${ident(fn)}(${names.map((n, i) => `${ident(n)} => $${i + 1}`).join(", ")})`;
        const { rows: meta } = await pool.query(
          `select p.proretset, t.typtype from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 and p.pronamespace = 'public'::regnamespace`,
          [fn],
        );
        // PostgREST: set-returning → array, with the URL's filters, order and limit applied to
        // the function's rows; composite → object; scalar → the bare value.
        if (meta[0]?.proretset) {
          const { sql, values } = buildSelect(null, url.searchParams, `${call} as r`, names.map((n) => args[n]));
          return send(res, 200, await asUser(claims, (c) => c.query(sql, values)).then((r) => r.rows));
        }
        const rows = await asUser(claims, (c) => c.query(`select * from ${call}`, names.map((n) => args[n]))).then((r) => r.rows);
        if (meta[0]?.typtype === "c") return send(res, 200, rows[0] ?? null);
        return send(res, 200, rows[0] ? Object.values(rows[0])[0] : null);
      }
      const table = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
      if (table && (req.method === "PATCH" || req.method === "POST")) {
        const body = await readBody(req);
        const { sql, values } = req.method === "PATCH"
          ? await buildUpdate(table[1], url.searchParams, body)
          : await buildInsert(table[1], url.searchParams, body);
        const rows = await asUser(claims, (c) => c.query(sql, values)).then((r) => r.rows);
        const wantsRows = /return=representation/.test(String(req.headers.prefer ?? ""));
        if (!wantsRows) return send(res, req.method === "POST" ? 201 : 204);
        return send(res, req.method === "POST" ? 201 : 200, rows);
      }
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
      return send(res, e.status ?? 400, { code: e.code ?? "PGRST000", message: e.message, details: e.detail ?? null });
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, close: async () => { server.close(); await pool.end(); } })));
}
