---
title: "Epic Workflow"
scope: "plan epic subcommand"
---

# Epic Workflow (`/plan epic`)

An **epic** is a container that groups related `plan-NN-<slug>/` child plans under a single
`epic.md` index. Use an epic when a large initiative spans multiple independent plans that must
execute in a dependency-ordered sequence.

## When to Use

Use `/plan epic` when:
- The initiative has **3+ child plans** with blockedBy dependencies between them.
- Different plans may be cooked independently in separate sessions.
- You need a single-glance status view across all child plans.

For a single plan with multiple phases, use `/plan` + `/cook` directly — no epic needed.

## Detail-Dependency vs Cook-Dependency

Two distinct questions, two distinct mechanisms — do not conflate them:

| Question | Mechanism | Controls |
|----------|-----------|----------|
| When can this plan **run** (cook)? | `blockedBy` frontmatter | `next` (pick plan to cook) |
| When can this plan's **phases be written** (detail)? | `detailMode` + stub-state | `next-to-detail` (pick plan to detail) |

- **`detailMode: sequential`** (default, safe) — detailing a later plan needs the **OUTPUT** of an
  upstream plan (e.g. plan-01 reverse-engineers a spec; plans 02-05 can only be detailed accurately
  once that spec exists). Detail in waves: only stubs whose `blockedBy` are `completed` are detailed
  now; the rest are detailed at resume time after upstream is cooked. Never guess phases against
  output that does not exist yet.
- **`detailMode: upfront`** — every child plan can be detailed from **static CONTEXT** already
  available (no plan depends on another's runtime output). Detail all stubs immediately, in parallel.

Picking the wrong mode has a clear failure signature: `upfront` on an output-dependent epic produces
hand-wavy phases written against a spec that isn't there. When unsure, prefer `sequential`.

## Execution Mode (`sequential` | `parallel`)

Separate from `detailMode` (when phases are *written*), `executionMode` controls how child plans are
*cooked*. Stored in `epic-state.json`, set at `init`, preserved on `rollup`.

| Mode | Cook topology | Cooked where |
|------|---------------|--------------|
| `sequential` (default) | Dependency **chain** — one plan at a time, resume in a fresh chat between plans | Main working tree |
| `parallel` | Dependency **fan** — 1 foundation → N workers concurrently → 1 merge | Each worker on its own git worktree + branch |

### Parallel topology (required shape)

A parallel epic MUST be exactly this fan-out/fan-in DAG (expressed purely via `blockedBy`, no new
field). Worker roles are *derived* from topology:

```
plan-01-foundation   blockedBy: []                              ← init/setup, cook first (sequential)
plan-02-<worker>     blockedBy: [plan-01-foundation]            ┐
plan-03-<worker>     blockedBy: [plan-01-foundation]            ├ worker wave (parallel, separate chats)
plan-04-<worker>     blockedBy: [plan-01-foundation]            ┘
plan-99-merge        blockedBy: [plan-02, plan-03, plan-04]     ← fan-in: merge + review + fix
```

- **foundation** = `blockedBy: []`. Owns ALL shared config (package.json, schema, migrations, env) so
  workers don't collide on them.
- **worker** = `blockedBy` includes the foundation. Each MUST have **exclusive file ownership** (no two
  workers touch the same file) — reuse the `--parallel` plan mode's file-ownership matrix.
- **merge** = `blockedBy` lists ≥2 workers. The fan-in step.

### Execution-mode gate (classify-first)

`/plan epic <id>` with **no** `--parallel` flag → auto-infer + confirm via `AskUserQuestion`
(header `Execution Mode`):
- Fan-shaped `blockedBy` (1 root → N → 1) → recommend `parallel`.
- Linear chain → recommend `sequential`.
- Give each option a substantive `description`. User confirms/overrides →
  `init --execution-mode <chosen>`.

`/plan epic <id> --parallel` → skip the question (mode explicitly chosen). Never pick silently.

### Parallel run flow (end-to-end)

1. **Scaffold** foundation + N workers + merge; set `executionMode: parallel`.
2. **Cook foundation** in the main tab → commit scaffold + DB to the base branch (workers branch FROM it).
3. **Dispatch** — main tab runs:
   ```bash
   node .codex/hooks/epic-parallel-dispatch.cjs <epic-dir>
   ```
   Prints one copy-paste block per ready worker. The user opens N fresh chats, pastes one each:
   ```
   /worktree create epic/<epicId>/<plan-dir>
   /cook <abs>/plans/<epicId>/<plan-dir>/ --epic <abs>/plans/<epicId> --worker
   ```
4. **Workers cook in parallel** — each on its own worktree/branch. Phase files are read via the
   absolute path into the main tree's `plans/` (workers only WRITE code into their worktree; nothing
   is copied). On completion `cook --worker` writes a `Epic-Plan-Done: <plan-dir>` commit trailer and
   STOPS (no chain prompt, no resume snapshot).
5. **Fan-in merge** — back in the main tab, `/cook plans/<epicId>/plan-99-merge/`. Its phases:
   - Gate: `node .codex/hooks/epic-worker-status.cjs <epic-dir>` → refuse if `allDone:false`.
   - Merge each worker branch `--no-ff` in `plan-NN` order; STOP on conflict (hand to user / `/fix`).
   - Run review + test + fix over the integrated result.

**Conventions (keep in sync across all three tools):** branch `epic/<epicId>/<plan-dir>`, done-marker
trailer `Epic-Plan-Done: <plan-dir>`. Shared by `epic-parallel-dispatch.cjs`, `cook --worker`, and
`epic-worker-status.cjs`.

### Scope: single-machine, solo

This design assumes **one machine, one developer** running multiple chats. Worktrees share the local
`.git`, so refs coordinate without push/fetch, and phase files are reachable by absolute path.
**Cross-machine parallelism is OUT of scope** (YAGNI) — it would need remote push/fetch of both refs
and `plans/` (gitignored today). Do not extend for it until there is a real need.

## Subcommand Flow

```
/plan epic <epic-id>
```

1. **Scaffold + classify** — Create `plans/<epic-id>/` (or current dir if path given):
   - Stub child plan dirs: `plan-NN-<slug>/plan.md` for each named child plan (overview only).
   - **Classify the epic's `detailMode` BEFORE init** (classify-first): auto-infer from the child
     plans' `blockedBy` (all empty → suggest `upfront`; chained `blockedBy` → suggest `sequential`),
     then confirm/override with the user. See "Detail-Dependency vs Cook-Dependency" below.
   - Init state with the chosen mode:
     ```bash
     node .codex/hooks/epic-state.cjs init <epic-dir> --detail-mode <sequential|upfront>
     ```
     Writes `epic-state.json` `{epicId, plans:[], status:"draft", detailMode}` + scaffolds `epic.md`.
     Omit the flag → defaults to `sequential` (safe). There is **no** separate `set-detail-mode`
     command — pass the mode to `init`.

2. **Detail child plans (auto)** — Each child `plan.md` MUST have flat frontmatter:
   ```
   status: pending     # pending | in-progress | completed | blocked
   blockedBy: [plan-NN-slug, ...]   # bare dir names, same epic scope
   ```
   Dependency truth lives **only** in child `plan.md` frontmatter. `epic.md` is index-only —
   never parse it for dependencies.

   Phase files are filled via `/plan` (standard planning flow), driven by `next-to-detail`:
   ```bash
   node .codex/hooks/epic-state.cjs next-to-detail <epic-dir>
   ```
   Prints stub plans (0 phase files) ready to detail, one dir per line:
   - `upfront` → all stubs (skill fans out `planner` agents in parallel to detail every child at once).
   - `sequential` → only stubs whose `blockedBy` are all `completed` (detail in waves; later plans
     are detailed at resume time, once upstream OUTPUT exists).
   Prints `no-plan-to-detail` and exits 0 when nothing is ready to detail.

   **Stub-detection:** a plan dir with **0** `phase-*.md` files is treated as "not yet detailed".
   After detailing, every child has ≥1 phase file. (No `detailed` frontmatter flag — file count is
   the source of truth.)

3. **Rollup** — After editing child plans, refresh epic state:
   ```bash
   node .codex/hooks/epic-state.cjs rollup <epic-dir>
   ```
   Reads each `plan-NN-*/plan.md`, aggregates `status`/`blockedBy`, writes `epic-state.json`,
   refreshes the `epic.md` table. **`rollup` fully regenerates `epic.md`** (machine-managed) —
   do NOT add human notes there, they will be overwritten; put notes in child `plan-NN-*/plan.md`.

4. **Select next plan** — Before each cook session:
   ```bash
   node .codex/hooks/epic-state.cjs next <epic-dir>
   ```
   Returns the dir name of the next READY plan (`status: pending` AND all `blockedBy` entries
   are `completed`). Tie-break: fewest phase files first (smallest blast radius).
   Prints `no-ready-plan` and exits 0 when nothing is ready — signal to pause.

5. **Run/resume** — Cook the selected plan:
   ```bash
   /cook plans/<epic-id>/<ready-plan-dir>/
   ```
   This is standard `/cook` — no new command. `--resume` flag (Phase 3) handles cross-session
   state restoration.

6. **Check overall state** — At any point:
   ```bash
   node .codex/hooks/epic-state.cjs check <epic-dir>
   ```
   Prints `{status, totalPlans, readyPlans, plansToDetail, detailMode, isComplete}` JSON to stdout.

## Auto-Detail Orchestration (skill behavior)

`/plan epic` drives detailing automatically — the user no longer hand-prompts "now detail plan-02":

1. **Scaffold stubs** → write each `plan-NN-<slug>/plan.md` overview (status, blockedBy, summary).
2. **Classify (auto-infer + confirm)** → inspect child `blockedBy`: all empty → recommend `upfront`;
   chained → recommend `sequential`. Open `AskUserQuestion` (header `Detail Mode`) with the inferred
   option marked `(Recommended)`; give each option a substantive `description`.
   User confirms or overrides → `init --detail-mode <chosen>`.
3. **Auto-detail the ready set** → `next-to-detail <epic-dir>`:
   - `upfront` → returns all stubs → spawn one `planner` agent **per stub in parallel** (each writes
     phase files into its own `plan-NN-<slug>/` — no shared-file contention; rollup runs once after).
   - `sequential` → returns only the first wave (no-blocker stubs) → detail those now; later waves are
     detailed at resume time (see "Resume auto-detail" below).
4. **Rollup** → `rollup <epic-dir>` to refresh `epic-state.json` + `epic.md`.
5. **Hand off** → print a table: which child plans were detailed now vs deferred (and why — "waits on
   OUTPUT of plan-NN"), then offer cooking the first ready-to-cook plan.

**Planner spawn template** (context isolation per `orchestration-protocol.md`):
```
Task: Detail phase files for <plan-NN-slug> in epic <epic-id>
Agent: planner
Context:
  - Child plan dir: plans/<epic-id>/<plan-NN-slug>/
  - Plan overview: <plan.md summary + acceptance from the overview>
  - Epic context: <epic goal; upstream OUTPUT available if sequential>
  - Work context: <project root>
Acceptance: phase-*.md files written into the child dir per the canonical phase template.
```

This is PLANNING only (writes phase files) — it never cooks, so it does not violate the cook
HARD-GATE or the epic human-checkpoint.

### Resume auto-detail (sequential)

For `sequential` epics, detailing the next wave happens at the **start of the resume session**
(`/cook <epic>/<next> --resume`), before cooking the target plan — once upstream OUTPUT exists.
The epic boundary after a cook still only snapshots + stops (human-checkpoint unchanged). Contract:
`.codex/rules/phase-completion-gate.md` → "Epic-boundary exception".

## Epic State Machine

```
draft → running → passed
            ↓
          blocked   (any child plan has status: blocked)
```

Derived from children:
- All `completed` → `passed`
- Any `blocked` → `blocked`
- Any `pending`/`in-progress` → `running`
- No children yet → `draft`

## epic-state.json Schema

```json
{
  "epicId": "260621-1708-my-epic",
  "plans": [
    { "dir": "plan-01-foundation", "status": "completed", "blockedBy": [] },
    { "dir": "plan-02-feature",    "status": "pending",   "blockedBy": ["plan-01-foundation"] }
  ],
  "status": "running",
  "detailMode": "sequential",
  "createdAt": "2026-06-21T00:00:00.000Z",
  "lastUpdated": "2026-06-21T12:00:00.000Z"
}
```

`epic-state.json` is the machine source of truth. `epic.md` is the human-readable index —
never parse `epic.md` for machine decisions.

## File Ownership

| File | Owner | Parse? |
|------|-------|--------|
| `epic-state.json` | `epic-state.cjs` | Yes — machine state |
| `epic.md` | Human + `epic-state.cjs rollup` | No — index only |
| `plan-NN-*/plan.md` | `/plan` skill | Yes — `status` + `blockedBy` flat frontmatter |

## Concurrent-Cook Rules

**Sequential epics:** run one plan at a time. Two cook sessions writing `epic-state.json`
concurrently cause last-write-wins — no file lock (YAGNI for the human-checkpoint workflow).
Matches the `cook-state.json` limitation in `phase-completion-gate.md`.

**Parallel epics:** concurrent worker cooks ARE the point, and they are safe **because workers
never write `epic-state.json`**. Each worker only writes its own plan-dir's `.cook-state.json`
(distinct files) and its own git branch. Only the main tab writes `epic-state.json` (at dispatch
and merge time), and it is single-threaded. The old last-write-wins hazard does not apply as long
as this discipline holds: workers touch only their branch + their `.cook-state.json`, never the
shared epic state.

## Plans Under gitignore

`plans/` is gitignored (`.gitignore:14`). `epic-state.json` is a local-session artifact.
Cross-machine resume is out of scope (tracked for Phase 3 snapshot location design).

## Hook Script Reference

Script: `.codex/hooks/epic-state.cjs`

```
node .codex/hooks/epic-state.cjs init           <epic-dir> [--detail-mode sequential|upfront] [--execution-mode sequential|parallel]
node .codex/hooks/epic-state.cjs rollup         <epic-dir>   # preserves detailMode + executionMode
node .codex/hooks/epic-state.cjs next           <epic-dir>   # next single plan to COOK (sequential)
node .codex/hooks/epic-state.cjs ready-set      <epic-dir>   # ALL ready plans (parallel fan-out)
node .codex/hooks/epic-state.cjs next-to-detail <epic-dir>   # stub plans to DETAIL (per detailMode)
node .codex/hooks/epic-state.cjs check          <epic-dir>   # + executionMode in JSON
```

Parallel-epic helpers (separate git-aware hooks):
```
node .codex/hooks/epic-parallel-dispatch.cjs <epic-dir>   # emit N worker copy-paste prompts (fan-out)
node .codex/hooks/epic-worker-status.cjs     <epic-dir>   # scan branches for done-markers (fan-in gate)
```

Exit codes: `0` = OK / fail-open, `1` = bad args / write failure.
Fail-open: malformed child `plan.md` or corrupt `epic-state.json` → treated as no-state,
execution continues gracefully.
