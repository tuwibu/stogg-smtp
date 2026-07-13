---
name: docs
description: "Analyze codebase and manage project documentation. Use for doc initialization, updates, summaries, codebase analysis, per-service reference docs, and business-doc sync from memory."
user-invocable: true
when_to_use: "Invoke to create, refresh, or audit project documentation."
category: utilities
keywords: [documentation, init, update, summarize, services, reference, per-service, business-sync, memory]
argument-hint: "init|update|summarize|services|flows|business-sync [--preview] [--update] [--scenarios] [--memory-summary <path>] [--svc <name>] [--dry-run]"
metadata:
  author: claudekit
  version: "1.6.0"
---

# Documentation Management

Analyze codebase and manage project documentation through scouting, analysis, and structured doc generation.

**IMPORTANT:** Invoke "/project-organization" skill to organize the outputs.

## Default (No Arguments)

If invoked without arguments, use `AskUserQuestion` to present available documentation operations:

| Operation | Description |
|-----------|-------------|
| `init` | Analyze codebase & create initial docs |
| `update` | Analyze changes & update docs |
| `summarize` | Quick codebase summary |
| `services` | Generate per-service docs under `docs/services/<svc>/` |
| `flows` | Generate cross-service business-process flows under `docs/flows/<process>.md` |
| `business-sync` | Reconcile business docs from consolidated memory + latest code |

Present as options via `AskUserQuestion` with header "Documentation Operation", question "What would you like to do?".

## Subcommands

| Subcommand | Reference | Purpose |
|------------|-----------|---------|
| `/docs init` | `references/init-workflow.md` | Analyze codebase and create initial documentation |
| `/docs update` | `references/update-workflow.md` | Analyze codebase and update existing documentation |
| `/docs summarize` | `references/summarize-workflow.md` | Quick analysis and update of codebase summary |
| `/docs services` | `references/services-workflow.md` | Generate per-service docs: `reference.md`, `flows.md`, `scenarios.md` under `docs/services/<svc>/` |
| `/docs flows` | `references/business-flows-workflow.md` | Generate cross-service business-process docs under `docs/flows/<process>.md` (human-facing, hybrid detection, git-diff staleness) |
| `/docs business-sync` | `references/business-sync-workflow.md` | Reconcile business docs from `/memory-sync` output + latest code (scout/repomix); never auto-overwrites |
| `--preview` flag | _(deprecated for init/update)_ | **DEPRECATED:** init/update no longer generate per-domain `docs/flows/<domain>-flow.md`. Use `/docs flows` for the business-process layer. `--preview` for brainstorm/plan (inline diagram in `plan.md`) is unaffected — different mechanism. |

## Routing

Parse `$ARGUMENTS`:
1. Strip the `--preview` token if present. **DEPRECATED for `init`/`update`** — it no longer
   generates `docs/flows/<domain>-flow.md`. If passed to init/update, warn the user once and point
   to `/docs flows`. (The brainstorm/plan `--preview` is a separate mechanism and not handled here.)
2. Strip `--update` and `--scenarios` tokens if present; pass as flags to services/flows mode.
3. Match the first remaining word as the subcommand:
   - `init` → Load `references/init-workflow.md`
   - `update` → Load `references/update-workflow.md`
   - `summarize` → Load `references/summarize-workflow.md`
   - `services` → Load `references/services-workflow.md` (`--update` triggers update mode; `--scenarios` forces scenario regeneration)
   - `flows` → Load `references/business-flows-workflow.md` (`--update` triggers staleness-based regeneration)
   - `business-sync` → Load `references/business-sync-workflow.md` (pass `--memory-summary`, `--svc`, `--dry-run` flags through)
   - empty/unclear → AskUserQuestion (do not auto-run `init`)

## Shared Context

Documentation lives in `./docs` directory:
```
./docs
├── project-overview-pdr.md
├── code-standards.md
├── codebase-summary.md
├── design-guidelines.md
├── deployment-guide.md
├── system-architecture.md
└── project-roadmap.md
```

Use `docs/` directory as the source of truth for documentation.

**Ad-hoc docs during plan/cook:** a freeform "write docs" request while a plan is active (or during
`cook`) with no folder named goes into the **active plan directory**, NOT `./docs`. The structured
subcommands above (`init`/`update`/`services`/`flows`/`business-sync`) keep their `./docs/**` targets.
See `.codex/rules/docs-output-location.md`.

When authoring or refreshing diagrams in `system-architecture.md`, apply standard SVG layout rules (component spacing, arrow routing, label placement, z-index ordering). Pair with `/preview --diagram` for visual self-review.

**IMPORTANT**: **Do not** start implementing code.
