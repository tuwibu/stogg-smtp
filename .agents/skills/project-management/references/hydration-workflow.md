# Persistence Workflow

Plan files ARE the persistent state. No ephemeral hydration layer needed — read the file, edit the file, the file is the truth.

## Flow Diagram

```
┌──────────────────┐
│ Plan Files       │  ← Source of truth (persistent across sessions)
│ plan.md          │
│ phase-01-*.md    │
│ [ ] step 1       │  ← Pending
│ [x] step 2       │  ← Done
└──────────────────┘
        ▲
        │ Read / Edit
        ▼
┌──────────────────┐
│ Agent            │  ← Reads checkboxes, edits as work progresses
│ + the `update_plan` checklist      │  ← Optional live cursor for session-scoped substeps
└──────────────────┘
```

## Session Start

1. Read `plan.md` + every `phase-NN-*.md` in target plan-dir.
2. Identify unchecked `[ ]` items = remaining work.
3. (Optional) Mirror current-phase items into `update_plan` checklist for live agent visibility — only when phase has 3+ substeps worth tracking.
4. Already-checked `[x]` items = done, skip.

**No hydration step.** Plan IS the state.

## During Work

- Pick up an item → set the `update_plan` checklist status `in_progress` (optional).
- Complete item → Edit phase file: `[ ]` → `[x]` IMMEDIATELY. Don't batch.
- Parallel phases (file-disjoint) → each agent edits only its owned phase file.
- Cook-state machine (`.cook-state.json`) tracks cross-phase completion.

## Session End: Verify Sync

Plan files are already updated incrementally. Final verification:

1. Sweep all `phase-XX-*.md` files in target plan-dir.
2. Confirm `[x]` count matches actual work completed.
3. Backfill stale `[ ]` in earlier phases (if any).
4. Update `plan.md` frontmatter `status` (pending → in-progress → completed) at phase/plan boundaries.
5. Report unresolved items where work happened but no checkbox got flipped.
6. Git commit captures state transition for next session.

## Cross-Session Resume

When user runs `/cook plans/<dir>` in a new session:

1. Read plan files → state is already accurate (no re-hydration needed).
2. `[ ]` items = remaining work, `[x]` = done.
3. `.cook-state.json` (maintained by `cook-state.cjs` hook) tells which phases finished.
4. Pick up from the next unchecked phase.

**Plan files survive everything:** session restart, branch switch, machine swap, even Codex reinstall.

## Compound Interest Effect

Each session makes specs smarter:
- **Session 1:** Execute first phases, establish patterns, edit phase files inline.
- **Session 2:** See completed work in phase files, build on established patterns.
- **Session 3:** Full context of prior sessions in checkbox state + commit history.

Git history shows progression. Completed checkboxes show the path that worked. Specs gain **institutional memory** purely from filesystem state.

## YAML Frontmatter Sync

Plan files MUST have frontmatter with these fields:

```yaml
---
title: Feature name
description: Brief description
status: in-progress  # pending | in-progress | completed
priority: P1
effort: medium
branch: feature-branch
tags: [auth, api]
created: 2026-02-05
---
```

Update `status` field when plan state crosses boundaries (start work, finalize).
