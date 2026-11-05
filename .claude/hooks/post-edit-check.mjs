#!/usr/bin/env node
// PostToolUse on Edit|Write. Runs the same guardrail scripts CI runs, scoped to the file
// that changed. Exit 2 puts the message in front of Claude so it fixes the line.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { relative } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8"));
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const abs = String(input.tool_input?.file_path ?? "");
if (!abs) process.exit(0);
const file = relative(root, abs);

const run = (args) => spawnSync("bash", args, { cwd: root, encoding: "utf8" });
const problems = [];

const s = run(["scripts/check-secrets.sh", file]);
if (s.status !== 0) problems.push(s.stdout + s.stderr);

if (file.startsWith("supabase/migrations/")) {
  const r = run(["scripts/check-rls.sh"]);
  if (r.status !== 0) problems.push(r.stdout + r.stderr);
}

if (problems.length) {
  process.stderr.write("Ping guardrail failed (see ping-data-security skill):\n" + problems.join("\n"));
  process.exit(2);
}
process.exit(0);
