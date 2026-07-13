# Skill Activation Matrix

When to activate each skill and tool during fixing workflows.

## Always Activate (ALL Workflows)

| Skill/Tool | Step | Reason |
|------------|------|--------|
| `scout` OR parallel `Explore` | Step 1 | Understand codebase context before diagnosing |
| `debug` | Step 2 | Systematic root cause investigation |
| `sequential-thinking` | Step 2 | Structured hypothesis formation — NO guessing |
| `/project-management` | Step 6 | MANDATORY for sync-back and progress tracking, every fix |

## Task Orchestration (Moderate+ Only)

| Tool | Activate When |
|------|---------------|
| `update_plan` | After complexity assessment, create all phase tasks upfront |
| `update_plan` | At start/completion of each phase |
| `update_plan` | Check available unblocked work, coordinate parallel agents |
| `update_plan` | Retrieve full task details before starting work |

Skip Tasks for Quick workflow (< 3 steps). See `references/task-orchestration.md`.

## Auto-Triggered Activation

| Skill | Auto-Trigger Condition |
|-------|------------------------|
| `problem-solving` | 2+ hypotheses REFUTED in Step 2 diagnosis |
| `sequential-thinking` | Always in Step 2 (mandatory for hypothesis formation) |

## Conditional Activation

| Skill | Activate When |
|-------|---------------|
| `brainstorm` | Multiple valid fix approaches, architecture decision (Deep only) |
| `ai-multimodal` | UI issues, screenshots provided, visual bugs |

## Subagent Usage

| Subagent | Activate When |
|----------|---------------|
| `debugger` | Root cause unclear, need deep investigation (Step 2) |
| `Explore` (parallel) | Scout multiple areas simultaneously (Step 1), test hypotheses (Step 2) |
| `Bash` (parallel) | Verify implementation: typecheck, lint, build, test (Step 5) |
| `researcher` | External docs needed, latest best practices (Deep only) |
| `planner` | Complex fix needs breakdown, multiple phases (Deep only) |
| `tester` | After implementation, verify fix works (Step 5) |
| `code-review` | After fix, verify quality and security (Step 5) |
| `git-manager` | After approval, commit changes (Step 6) |
| `docs-manager` | API/behavior changes need doc updates (Step 6) |
| `developer` | Parallel independent issues (each gets own agent) |

## Parallel Patterns

See `references/parallel-exploration.md` for detailed patterns.

| When | Parallel Strategy |
|------|-------------------|
| Scouting (Step 1) | 2-3 `Explore` agents on different areas |
| Testing hypotheses (Step 2) | 2-3 `Explore` agents per hypothesis |
| Multi-module fix | `Explore` each module in parallel |
| After implementation (Step 5) | `Bash` agents: typecheck + lint + build + test |
| 2+ independent issues | Task trees + `developer` agents per issue |

## Workflow → Skills Map

| Workflow | Skills Activated |
|----------|------------------|
| Quick | `scout` (minimal), `debug`, `sequential-thinking`, `code-review`, `/project-management`, parallel `Bash` verification |
| Standard | Above + Tasks, `problem-solving` (auto), `project-management`, `tester`, parallel `Explore` |
| Parallel | Per-issue Task trees + `project-management` + `developer` agents + coordination via `update_plan` |

## Step → Skills Chain (Mandatory Order)

| Step | Mandatory Chain |
|------|----------------|
| Step 0: Mode | `AskUserQuestion` (unless auto/quick detected) |
| Step 1: Scout | `scout` OR 2-3 parallel `Explore` → map files, deps, tests |
| Step 2: Diagnose | Capture pre-fix state → `debug` → `sequential-thinking` → parallel `Explore` hypotheses → (`problem-solving` if 2+ fail) |
| Step 3: Assess | Classify complexity → create Tasks (moderate+) |
| Step 4: Fix | Implement per workflow → follow root cause |
| Step 5: Verify+Prevent | Iron-law verify → regression test → defense-in-depth → parallel `Bash` verify |
| Step 6: Finalize | Report → `/project-management` (MANDATORY) → `docs-manager` → `update_plan` → `git-manager` → `/journal` |

## Detection Triggers

| Keyword/Pattern | Skill to Consider |
|-----------------|-------------------|
| "stuck", "tried everything" | `problem-solving` |
| "complex", "multi-step" | `sequential-thinking` |
| "which approach", "options" | `brainstorm` |
| "latest docs", "best practice" | `researcher` subagent |
| Screenshot attached | `ai-multimodal` |
