# Ping Clean — start here

What's in this kit and which lesson it comes from:

| File | Lesson | Job |
| --- | --- | --- |
| CLAUDE.md | CLAUDE.md | The rules every session reads first |
| intent/v1/intent.md, spec.md, plan.md | Plan mode | What, what it does, how it's built |
| .claude/skills/ (3) | Skills | Money rules, data security, Pervonio premium design |
| .claude/agents/ (3) | Subagents | verifier, security-reviewer, design-reviewer (report only, never edit) |
| .claude/hooks/ + settings.json | Hooks | Blocks live Stripe keys, asks you before any schema change, checks RLS and secrets after every edit |
| .github/workflows/guardrails.yml | Hooks (PR check) | Same checks on every pull request |

## Step 1 — New repo (5 minutes)
```bash
mkdir ping-clean && cd ping-clean && git init
# unzip this kit into the folder, then:
chmod +x scripts/*.sh
git add -A && git commit -m "Ping Clean: CLAUDE.md, intent, skills, agents, hooks"
gh repo create carlmcglasson67-spec/ping-clean --private --source=. --push
```
In GitHub: Settings → Branches → protect main, require the "Guardrails" check.

## Step 2 — Answer the open questions
Bottom of intent/v1/spec.md. Price, commission and tier windows are needed before Phase 2.
Phase 1 can start without them.

## Step 3 — Phase 1, ONE session
```bash
claude
```
Then paste:
> Read CLAUDE.md and intent/v1/. Enter plan mode and plan Phase 1 (Foundations) only.
> Show me the full schema and RLS policies before writing any migration.

Approve the plan, let it build, then:
> Use the security-reviewer agent on this branch, then the verifier agent. Open a PR.

You merge.

## Step 4 — Phases 2–4, parallel agents
Run `bash scripts/start-tracks.sh` (or `bash scripts/start-tracks.sh 3` to add admin).
It prints one command per terminal: main session + Track A + Track B. Each agent reads
its own brief in intent/v1/tracks/ and only touches its own folder.

Or by hand:
Terminal 1:
```bash
claude --worktree site-booking
```
> You are Track A in intent/v1/plan.md. Only edit app/(site) and app/(account).
> If you need a shared change in lib/, components/ui/ or supabase/, stop and tell me.
> Plan first.

Terminal 2:
```bash
claude --worktree cleaner-app
```
> You are Track B in intent/v1/plan.md. Only edit app/(work). Same rules. Plan first.

Each track finishes with: design-reviewer → security-reviewer → verifier → PR.
Add Track C (admin) in a third terminal only once you're keeping up with reviewing two.

## Step 5 — Phase 5 money, ONE session
> Plan Phase 5 using the ping-money-rules skill. Test mode only.

## Your working rules
- You steer and review; sessions build. Never skip the reviewers.
- When Claude makes the same mistake twice, add a line to "Things Claude gets wrong" in CLAUDE.md.
- No new features in V1 without dropping one of equal size.
