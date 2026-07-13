# Workflow Chaining

After completing any skill that is a **key** in `workflow.chains` (from `claude/.ck.json`), you MUST invoke `AskUserQuestion` with next-step options **before ending the response** — IF the remaining chain (after filtering) is non-empty. If the skill is terminal (not a key) or the filtered chain is empty → end with just the output summary, no prompt, no invented options.

This rule REPLACES any hardcoded "Finalize Phase" / "want to commit?" transitions inside individual skills.

## How It Works

1. Look up the finished skill as a **key** in `workflow.chains`. Not a key → terminal (e.g. `git`); stop, no prompt.
2. The array value is the remaining chain (ordered).
3. Apply conditional filters (below) — silently drop gated skills.
4. Filtered chain non-empty → MUST call `AskUserQuestion`. Empty → stop, no prompt.
5. NEVER print options as markdown text (`[1] Proceed...`) — they aren't clickable. Always the `AskUserQuestion` tool.

## Conditional Skills

Skills gated by capability flags in `claude/.ck.json` → `workflow`. Flag unset/false → skill is **silently removed** (do NOT explain why an option is missing).

| Skill | Gate | Rule |
|-------|------|------|
| `simplify`, `git` | `codingLevel >= 1` | Level 0 (Intern) gets minimal chain (`brainstorm → plan → cook`). |
| `test` | `codingLevel >= 2` | Level 0/1 skip it. |
| `test` | `workflow.hasTests === true` | Default `false` → `test` filtered from every chain. |
| `simplify` | `simplify-eligibility.cjs` → `eligible: true` | Hook diffs HEAD vs `workflow.simplifyThreshold` (default `{maxLoc:30,maxFiles:2}`). Tiny change → dropped. Fails open (error → eligible). |
| `git` | `<projectRoot>/.git` exists (auto-detect via `resolveProjectRoot()`) | No `.git` → `git` filtered. No config flag; filesystem only. |

**Coding level:** read `codingLevel` from `.ck.json` (default `0`). Env `CODING_LEVEL` overrides. Same value drives session Tone Calibration.

**Flipping `hasTests`:** set to `true` ONLY inside `brainstorm`/`plan`, after the user commits to tests via `AskUserQuestion` → edit `.ck.json` `workflow.hasTests = true` + ensure plan has test ownership + criteria. User may also flip manually (treat as explicit consent).

### Filtering algorithm

```
remaining = chains[current_skill]
level = env.CODING_LEVEL ?? config.codingLevel ?? 0
if level < 1: drop {simplify, git, test}
elif level < 2: drop {test}
if workflow.hasTests !== true: drop test
if not exists(resolveProjectRoot(cwd)+"/.git"): drop git
if "simplify" in remaining and simplify-eligibility.cjs.eligible === false: drop simplify

next, rest = remaining[0], remaining[1:]
options = [Proceed to /next]
# near-skip (one step): if rest non-empty AND next ∉ skipBlockers → add "Skip to /rest[0]"
# commit shortcut: if git ∈ remaining at index ≥ 2 AND next ∉ skipBlockers
#   AND no skipBlocker sits between next and git → add "Skip to /git"
options += [Stop here]
```

- Filtering empties chain → no `AskUserQuestion`, just stop.
- Only survivor is `git` + `.git` exists → `Proceed to /git` + `Stop`. Missing `.git` → empty → no prompt.

## Option Format (AskUserQuestion params)

- **question**: `"{current} done. Chain: {next} → {rest...}. Next step?"`
- **header**: `"Next step"` · **multiSelect**: `false`
- **options** (UI auto-appends "Other"):
  - `"Proceed to /{next}"` — invoke next skill with context from current.
  - `"Skip to /{rest[0]}"` — near-skip. Only if `rest` non-empty AND `next` ∉ `skipBlockers`.
  - `"Skip to /git"` — commit shortcut. Only if `git` ∈ remaining at index ≥ 2, `next` ∉ `skipBlockers`, and no producer (`cook`/`fix`/skipBlocker) sits between `next` and `git`.
  - `"Stop here"` — end workflow, no further skills.

## Skip Safety — blockers

Some skills **produce the artifact** downstream skills consume; skipping them orphans the chain. List in `.ck.json` → `workflow.skipBlockers` (default `["cook", "fix"]`).

**Rule: if `next` ∈ `skipBlockers` → NO Skip option** (only Proceed + Stop). `cook` writes code, `fix` applies the fix — skip them and test/simplify/docs/git have nothing to work on. Every other chain skill is non-blocking (skipping leaves a valid, if less-polished, artifact).

**Maintenance:** adding a new producer skill (`migrate`, `scaffold`...) → add it to `skipBlockers`. Config only, no code.

### Examples

After `/plan` (remaining `[cook, simplify, docs, git]` with `hasTests=false`):
- `next = cook` ∈ skipBlockers → **no Skip** → options: `Cook now` + `Stop`.

After `/cook` (remaining `[simplify, docs, git]`, `hasTests=false`):
- `next = simplify` ∉ skipBlockers → near-skip → `Skip to /docs`; `git` at index 2, intermediate `[docs]` clean → `Skip to /git`.
- Options: `Proceed to /simplify` + `Skip to /docs` + `Skip to /git` + `Stop`.

After `/docs` (remaining `[git]`) with no `.git`: gate drops `git` → empty → no prompt, just stop.

## Chain Lookup

Read `workflow.chains` from `claude/.ck.json`. Raw chains keep `test` in place; filtering happens at lookup (flip `hasTests` once → enabled everywhere). Current shape:

```
brainstorm: [plan, cook, test, simplify, docs, git]
plan:       [cook, test, simplify, docs, git]
cook:       [test, simplify, docs, git]
debug:      [fix, docs, git]
fix:        [docs, git]
test:       [docs, git]
simplify:   [docs, git]
docs:       [git]
```

## Mid-Chain Entry

User starts at a mid-chain skill → use **that skill's own chain**, not a parent's remaining. Each key is an independent entry point (e.g. `/cook` directly → `[test, simplify, docs, git]`).

## Context Passing

Always pass relevant context to the next skill:

| Transition | Context |
|------------|---------|
| `brainstorm` → `plan` | Report path, key decisions, chosen approach |
| `plan` → `cook` | Plan dir path, phase files |
| `cook` → `test` | Modified files, phases completed |
| `*` → `docs` | Invoke as `/docs update` — sync `./docs/` to changes; pass changed files + summary |
| `docs` → `git` | Final changed files (code + docs) |
| `debug` → `fix` | Report path, root cause, files involved |

## Enforcement

Before ending the response after a chained skill completes:

1. Is the current skill a **KEY** in `workflow.chains`? (Appearing only as a *value* does NOT count.)
2. Key → compute filtered remaining chain. Non-empty → **the LAST tool call before ending MUST be `AskUserQuestion`**. Empty → stop, no prompt.
3. Not a key → terminal skill → stop, no prompt, do NOT invent options.

**Never fabricate next-step options for a terminal skill** (e.g. after `/git`: no "Draft release notes / Tag release" prompt — write the commit/PR summary and end). If the user wants more, they'll ask.

### Multi-phase skills (cook)

For `cook` on a plan directory, **"completing" = ALL phases done**, not the current phase. Before steps 1-3, run:

```bash
node claude/hooks/cook-state.cjs check <plan-dir>
```

- `isComplete: false` → DO NOT prompt. Print `Phase X/Y done — loading next phase`, continue the loop.
- `isComplete: true` AND `epicDir` is `null` → proceed with steps 1-3 (normal chain prompt).
- `isComplete: true` AND `epicDir` is set (plan is an epic child) → **epic-boundary path: DO NOT fire the chain `AskUserQuestion`.** Run `node .claude/hooks/resume-snapshot.cjs <epicDir> <plan-basename>`, print the `/cook … --resume` command, and STOP. Full contract: `codex/rules/phase-completion-gate.md` → "Epic-boundary exception".

State file `<plan-dir>/.cook-state.json` is source of truth. Full contract: `codex/rules/phase-completion-gate.md`. Applies to any future multi-phase producer — wire to the same gate, don't invent a parallel mechanism.

For `sequential` epics, the next wave's phase files are auto-detailed at the **start of the
`--resume` session** (before cooking the target plan), not at the boundary — see
`phase-completion-gate.md` → "Auto-detail happens at RESUME, not at the boundary".

### Violations

- ❌ Markdown-text options / text question after a skill completes.
- ❌ `AskUserQuestion` after a terminal skill with invented options.
- ✅ `AskUserQuestion` tool as the last action when current IS a key and filtered chain is non-empty; otherwise just the output summary.

## Authorized overrides

A skill's SKILL.md may own bespoke fork UI at its Hand off — this rule yields to it (the Enforcement rule still holds: last tool call is `AskUserQuestion`, only the options differ).

| Skill | Fork | Why |
|-------|------|-----|
| `plan` | Hand off | Options depend on TDD eligibility (`detect-tests.cjs` + `test-eligibility.cjs`). Eligible → `Cook now` + `Write tests first` + `Stop`. Else → generic chain. |

## Skill availability

**Review is not a chain step.** `cook` spawns the `code-reviewer` subagent at its finalize gate
(conditionally — high-risk or large-diff), `fix` spawns it unconditionally at step 4, and `ship`
delegates to it too. Review already runs *inside* the producers. Adding a `code-review` chain entry
would run a second pass over the diff the producer just reviewed. `/code-review` remains a
user-invoked entry point for the modes no subagent covers: `#PR`, a commit hash, `--pending`,
`codebase parallel`, and the spec-compliance stage.

The full skill roster lives in `.codex/skills/` (and `.ck.json` for chain membership) — do not duplicate the list here. Standalone utilities (`bootstrap`, `explore`, `security`, `deploy`, `db-design`, backend/frontend packs, `setup`, etc.) are NOT chain keys → they never trigger a chain prompt; they can run mid-workflow as helpers. If a chain references a skill that isn't implemented, still present the option; if picked and missing, reply *"Skill `{name}` is not available — what would you like instead?"*.
