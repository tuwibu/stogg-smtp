---
name: project-management
description: "Track progress, update plan statuses, generate reports, coordinate docs updates. Use for project oversight, status checks, plan completion, cross-session continuity."
user-invocable: true
when_to_use: "Invoke for progress tracking, plan status, or handoffs."
category: utilities
keywords: [project, progress, status, reports]
argument-hint: "[task: status, sync, report]"
metadata:
  author: claudekit
  version: "2.0.0"
---

# Project Management

Project oversight and coordination using persistent plan files as the source of truth.

**Principles:** Token efficiency | Concise reports | Data-driven insights

## When to Use

- Checking project status or progress across plans
- Updating plan statuses after feature completion
- Syncing plan.md checkboxes with implementation state
- Generating status reports or summaries
- Coordinating documentation updates after milestones
- Verifying task completeness against acceptance criteria
- Cross-session resume of multi-phase work

## Mechanism

Plan tracking uses `plan.md` + `phase-NN-*.md` checkboxes as the **source of truth**. Does not use the ephemeral Tasks API.

| Operation | Tool | Persistence |
|---|---|---|
| Read plan state | `Read` tool | Persistent (file) |
| Update `[ ]` → `[x]` | `Edit` tool | Persistent (file) |
| Update YAML frontmatter status | `Edit` tool | Persistent (file) |
| Session-scoped subtasks | `update_plan` checklist tool | Ephemeral (clears per session) |
| Format validation | `plan-format-kanban.cjs` hook | Auto PostToolUse |

**Why this design:** Plan files survive session restart, branch switch, machine swap. the `update_plan` checklist covers in-session granular tracking only.

## Core Capabilities

### 1. Plan State Operations
Load: `references/task-operations.md`

- Read `plan.md` + all `phase-NN-*.md` in target plan-dir
- Parse YAML frontmatter (status, priority, effort)
- Count `[ ]` vs `[x]` checkboxes per phase
- Optionally use `update_plan` checklist to mirror in-session unchecked items for live tracking

### 2. Session Bridging (Persistence Pattern)
Load: `references/hydration-workflow.md`

Plan files are persistent. Session memory is ephemeral. The pattern:
- **Read:** Open plan-dir, scan `[ ]` items across all phases
- **Track in-session:** Optional — `update_plan` checklist mirror for live agent visibility
- **Sync-back:** Edit `[ ]` → `[x]` in real time as work completes; update YAML frontmatter status on phase boundaries
- **Resume next session:** Re-read plan files (no hydration needed — state IS the file)

### 3. Progress Tracking
Load: `references/progress-tracking.md`

- Scan `./plans/*/plan.md` for active plans
- Parse YAML frontmatter for status, priority, effort
- Count `[x]` vs `[ ]` in phase files for completion %
- Cross-reference completed work against planned tasks
- Verify acceptance criteria met before marking complete

### 4. Documentation Coordination
Load: `references/documentation-triggers.md`

Trigger `./docs` updates when:
- Phase status changes, major features complete
- API contracts change, architecture decisions made
- Security patches applied, breaking changes occur

Delegate to `docs-manager` subagent for actual updates.

### 5. Status Reporting
Load: `references/reporting-patterns.md`

Generate reports: session summaries, plan completion, multi-plan overviews.
- Use naming: `{reports-path}/pm-{date}-{time}-{slug}.md`
- Sacrifice grammar for brevity; use tables over prose
- List unresolved questions at end

## Workflow

```
[Scan Plans] → [Read State] → [Edit Checkboxes] → [Update YAML] → [Generate Report] → [Trigger Doc Updates]
```

1. Glob `plans/*/plan.md` — check active plans
2. Read target plan-dir: `plan.md` + all `phase-NN-*.md`
3. As work progresses: Edit `[ ]` → `[x]` directly in phase files; optionally the `update_plan` checklist for session-scoped subtasks
4. On phase boundary: run full-plan sync-back (sweep all phase files, backfill stale checkboxes), then update YAML frontmatter status
5. Generate status report to reports directory
6. Delegate doc updates if changes warrant

## Mandatory Sync-Back Guard

When updating plan status, NEVER mark only the currently active phase.

1. Sweep all `phase-XX-*.md` files under the target plan directory.
2. Reconcile every completed work item against phase file `[ ]` items.
3. Backfill stale checkboxes in earlier phases before marking later phases done.
4. Update `plan.md` status/progress from real checkbox counts.
5. If any completed work cannot be mapped to a phase file, report unresolved mappings and do not claim full completion.

## Plan YAML Frontmatter

All `plan.md` files MUST have:

```yaml
---
title: Feature name
status: in-progress  # pending | in-progress | completed
priority: P1
effort: medium
branch: feature-branch
tags: [auth, api]
created: 2026-02-05
---
```

Update `status` when plan state changes.

## Quality Standards

- All analysis data-driven, referencing specific plans and reports
- Focus on business value delivery and actionable insights
- Highlight critical issues requiring immediate attention
- Maintain traceability between requirements and implementation

## Related Skills

- `plan` — Creates implementation plans (planning phase)
- `cook` — Implements plans (execution phase, maintains `.cook-state.json`)
- `plans-kanban` — Visual dashboard for plan viewing
