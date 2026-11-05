#!/usr/bin/env node
// PreToolUse on Edit|Write.
// - Live Stripe keys: blocked outright.
// - Schema (supabase/migrations): asks Carl before the edit happens.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const ti = input.tool_input ?? {};
const file = String(ti.file_path ?? "");
const text = [ti.content, ti.new_string].filter(Boolean).join("\n");

const out = (decision, reason) => {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: reason },
  }));
  process.exit(0);
};

if (/(sk|rk)_live_[A-Za-z0-9]{8,}/.test(text)) {
  out("deny", "Live Stripe key in an edit. Ping runs in test mode only; keys belong in Vercel env vars, never in the repo.");
}
if (/\/supabase\/migrations\//.test(file)) {
  out("ask", "Schema change. Carl signs off every migration: check the table, columns and RLS policies before approving.");
}
process.exit(0);
