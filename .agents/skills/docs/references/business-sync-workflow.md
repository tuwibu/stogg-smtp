# Business-Sync Workflow (`docs business-sync` mode)

## Purpose

Generate and reconcile business documentation in `docs/services/<svc>/` by combining:

1. **Consolidated memory** — output from `/memory-sync` (grouped, deduplicated facts).
2. **Latest code snapshot** — produced by `/scout` or `/repomix` against the project root.

> **HARD RULE — NO AUTO-OVERWRITE:** Business docs are human-reviewed artifacts. This workflow
> NEVER automatically overwrites existing content. Drift is surfaced via `AskUserQuestion`
> checkpoint; a human decides what to apply. Violations of this rule break the trust contract
> with project owners.

> **Canonical business-fact source:** business facts (`type: project | reference`) live repo-local in
> `<root>/docs/memory/` (`.ck.json` → `memory.businessDir`, under `docs/` to survive claudekit
> re-init) and are git-tracked. Because they are
> committed, staleness for business facts uses **git history of the fact file** (its last commit vs
> `<head-commit>`), not the 90-day TTL. Personal facts (`user`/`feedback`) remain machine-local.

> **Honor `supersedes`:** the consolidated memory (from `/memory-sync`) has already dropped any
> fact retired via `supersedes`. This workflow consumes that output as-is — a superseded fact MUST NOT
> appear in a drift report or in the injected `## Memory Context`. Never resurrect a superseded fact.

---

## Prerequisites

| Prerequisite | How to satisfy |
|---|---|
| Memory consolidated | Run `/memory-sync [memory-dir] --json` → save output to `tmp/memory-consolidated.json` |
| Latest code snapshot | Run `/scout` (or `/repomix`) against project root → have file list + symbol summaries in context |
| Service list agreed | `docs/services/<svc>/` structure from `services-workflow.md` (Phase 5) must exist or be initialized first |

If memory is empty (no facts) → warn and proceed with code-only generation (memory sections
will be marked `<!-- memory: none -->`).

---

## Invocation

```
/docs business-sync [--memory-summary <path>] [--svc <name>] [--dry-run]
```

| Flag | Default | Description |
|---|---|---|
| `--memory-summary` | auto-detect `tmp/memory-consolidated.json` | Path to JSON output from `/memory-sync` |
| `--svc` | all detected services | Limit reconcile to one service |
| `--dry-run` | off | Show drift report only; write nothing |

---

## Workflow

### Step 1 — Load inputs

1. Read memory summary from `--memory-summary` path (or auto-detect). Parse JSON.
2. Confirm service list: read existing `docs/services/` subdirs. If none → run
   `services-workflow.md` Init mode first, then return here.
3. Capture HEAD commit:
   ```bash
   git rev-parse HEAD
   ```
   Store as `<head-commit>`. Used in staleness checks.

### Step 2 — Map memory facts to services

For each service `<svc>`, filter memory groups by relevance:

- `project` facts whose tags or content mention `<svc>` name → include in service context.
- `reference` facts linked to `<svc>` domain keywords → include.
- `user` and `feedback` facts → include in a shared `docs/services/_shared/` section (not
  per-service; created once if absent).

Build per-service context object:
```json
{
  "svc": "<name>",
  "memoryFacts": [...],
  "sharedFacts": [...],
  "headCommit": "<sha>"
}
```

### Step 3 — Staleness check (reconcile existing docs)

For each `docs/services/<svc>/reference.md` that already exists:

1. Read `commit` field from the sibling `flows.md` frontmatter (shared staleness source,
   per `services-workflow.md`). If `flows.md` is missing or has no `commit` → treat as
   stale (full regeneration needed).
2. Run:
   ```bash
   git diff --name-only <commit>..HEAD -- <svc-source-dir>
   ```
3. Classify:
   - **Empty diff + memory unchanged** → skip this service (no drift).
   - **Non-empty diff** → code drift detected; enter Step 4.
   - **Memory facts newer than `commit` date** → memory drift detected; enter Step 4.

"Memory unchanged" = all `updated` fields in the service's `memoryFacts` predate `<commit>`
date.

### Step 4 — Generate drift report

For each drifted service, produce an in-memory diff:

```
=== DRIFT REPORT: <svc> ===
Head commit: <sha>
Previous commit: <prev-sha>

[CODE DRIFT]
Changed files since last doc sync:
  - <file> (+N/-M lines)
  ...

[MEMORY DRIFT]
New/updated facts since last doc sync:
  - <fact-id> (type: project, updated: <date>): <first 80 chars>
  ...

[PROPOSED SECTIONS TO UPDATE in reference.md]
  § Key invariants — N changed symbols detected
  § Public API surface — M new exports
  § Gotchas — 1 new error-handling pattern

[NO AUTO-OVERWRITE — human review required]
```

Do NOT write any file at this stage.

### Step 5 — Human checkpoint (AskUserQuestion)

Present drift report per service. Then ask:

```
AskUserQuestion:
  header: "Business-sync drift review"
  question: "Drift detected in <svc>. How would you like to proceed?"
  multiSelect: false
  options:
    - label: "Apply proposed updates to reference.md"
      description: "Regenerate reference.md sections listed in the drift report. flows.md and scenarios.md unchanged unless separately flagged."
    - label: "Apply all three files (reference + flows + scenarios)"
      description: "Full regeneration of docs/services/<svc>/. Use when service logic changed substantially."
    - label: "Mark as reviewed, no update"
      description: "Stamp docs/services/<svc>/reference.md with current HEAD commit. Skip regeneration."
    - label: "Skip this service"
      description: "Leave docs unchanged. Drift remains unresolved."
```

Repeat per drifted service. Non-drifted services are skipped silently (note in silent-decisions
block).

### Step 6 — Apply approved updates

Per user choice from Step 5:

**"Apply proposed updates to reference.md":**
- Regenerate only `reference.md` using `service-reference-template.md`.
- Inject memory facts into a new `## Memory Context` section at the bottom:

  ```markdown
  ## Memory Context
  <!-- AI: consolidated from /memory-sync. Human-reviewed. -->
  ### Project facts
  - **<fact-id>** (`<updated>`): <content>
  ...
  ### Reference facts
  - **<fact-id>** (`<updated>`): <content>
  ...
  ```
- Update `flows.md` frontmatter `commit` field to `<head-commit>`.
- Do NOT touch `scenarios.md`.

**"Apply all three files":**
- Full regeneration per `services-workflow.md` Step 3 (reference + flows + scenarios).
- Also inject `## Memory Context` into `reference.md`.

**"Mark as reviewed, no update":**
- Append one line to `docs/services/<svc>/reference.md`:
  ```
  <!-- reviewed: <head-commit> <ISO timestamp> — no changes applied -->
  ```
- Update `flows.md` frontmatter `commit` to `<head-commit>`.

**"Skip this service":**
- Write nothing. Log skip in the session's silent-decisions block.

### Step 7 — Output summary

After all services processed, emit:

```markdown
## Business-sync complete

| Service | Action | Files written |
|---|---|---|
| <svc-a> | Applied reference.md update | reference.md, flows.md |
| <svc-b> | Marked reviewed | flows.md (commit stamp only) |
| <svc-c> | Skipped | — |
| <svc-d> | No drift | — |
```

---

## New service (no existing docs)

If a service directory exists in the codebase but has no `docs/services/<svc>/` yet:

1. Run `services-workflow.md` Init Step 3 for that service.
2. Then inject `## Memory Context` into the generated `reference.md`.
3. No drift checkpoint needed (first write is always human-initiated by running this command).

---

## Shared facts (`docs/services/_shared/`)

`user` and `feedback` memory facts are cross-service. They land in:

```
docs/services/_shared/
└── memory-context.md   — shared user + feedback facts; manually maintained after first gen
```

On first run: create and populate. On subsequent runs: show diff, apply only if user approves
(same checkpoint pattern as per-service). Never auto-overwrite.

---

## Future P6b — DB-sync branch (NOT implemented)

The code-only path above uses scout/repomix as the "latest state" source. A future P6b
extension would add a DB-sync branch:

- **Trigger:** user passes `--db` flag.
- **Dependency:** Phase 4 DB connector (`/db-connect`) must be configured and reachable.
- **Additional step (between Step 1 and Step 2):** pull live schema via connector, compare
  against schema captured in `project` memory facts → add `[SCHEMA DRIFT]` section to the
  drift report.
- **Rationale for deferral:** claudekit is a skills/hooks toolkit with no business DB of its
  own. Live-DB reconcile adds nothing until a downstream project with a real schema adopts
  this workflow. The code-only path is complete and self-contained.

To implement P6b: add `--db` handling in Step 1, extend Step 3 with schema diff, extend the
drift report template with `[SCHEMA DRIFT]`, and update the checkpoint options to include
"Apply schema-derived updates".

---

## Cross-references

| File | Role |
|---|---|
| `.codex/skills/memory-sync/SKILL.md` | Upstream — produces memory summary consumed here |
| `.codex/skills/docs/references/services-workflow.md` | Target structure for `docs/services/<svc>/` |
| `.codex/skills/docs/references/flows-workflow.md` | Staleness mechanism reused for `flows.md` |
| `.codex/skills/docs/SKILL.md` | Entry point — routes `business-sync` subcommand here |
| `.codex/skills/docs/references/service-reference-template.md` | Template for `reference.md` regeneration |

---

## Anti-patterns (forbidden)

| Pattern | Why forbidden |
|---|---|
| Writing `reference.md` without user approval | Violates the no-auto-overwrite contract |
| Skipping the drift check and always regenerating | Wastes compute; erases manual edits |
| Merging heuristic memory duplicates automatically | Only exact duplicates are safe to auto-merge; heuristic dupes need human judgment |
| Calling `/memory-sync` inline without `--json` | Downstream JSON parsing requires structured output |
