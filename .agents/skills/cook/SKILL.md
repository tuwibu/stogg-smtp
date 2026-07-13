---
name: cook
description: "Implement features, plans, and fixes with structured workflow. Use for feature development, plan execution, code implementation pipelines."
user-invocable: true
when_to_use: "Invoke to implement known scope after requirements are clear."
category: utilities
keywords: [implementation, workflow, feature, pipeline]
argument-hint: "[task|plan-path] [--interactive|--fast|--parallel|--auto|--no-test] [--tdd]"
metadata:
  author: claudekit
  version: "2.2.0"
---

# Cook - Smart Feature Implementation

End-to-end implementation with automatic workflow detection.

**Principles:** YAGNI, KISS, DRY | Token efficiency | Concise reports

## Usage

```
/cook <natural language task OR plan path>
```

**IMPORTANT:** If no flag is provided, the skill will use the `interactive` mode by default for the workflow.

**Optional flags to select the workflow mode:** 
- `--interactive`: Full workflow with user input (**default**)
- `--fast`: Skip research, scout→plan→code
- `--parallel`: Multi-agent execution
- `--no-test`: Skip testing step
- `--auto`: Auto-approve low-risk steps; high-risk changes stop for human approval before finalize/commit/ship

**Composable flags** (combine with any mode):
- `--tdd`: Tests-first per phase — write tests for current behavior before
  refactoring, then verify they still pass after the implementation step
- `--resume`: Boot from an epic resume snapshot. Re-derives the next ready plan from
  the LIVE epic (via `epic-state.cjs next`) rather than trusting the snapshot pointer
  (anti-stale), prints a short plan summary, then runs. See "Epic mode" below.
- `--worker`: Cook a worker plan of a PARALLEL epic. On completion, instead of writing a
  resume snapshot, the worker records a `Epic-Plan-Done: <plan-dir>` commit trailer on its
  own branch and STOPS (no chain prompt). See "Epic mode → Parallel epics" below.

**Example:**
```
/cook "Add user authentication to the app" --fast
/cook path/to/plan.md --auto
/cook "Refactor auth middleware" --tdd
```

<HARD-GATE>
Do NOT write implementation code until a plan exists and has been reviewed.
This applies regardless of task simplicity. "Simple" tasks are where unexamined assumptions waste the most time.
Exception: `--fast` mode skips research but still requires a plan step.
User override: If user explicitly says "just code it" or "skip planning", respect their instruction.
</HARD-GATE>

<HARD-GATE-SCOUT-FIRST>
Before planning OR asking clarifying questions, scan the codebase. Mandatory scout outputs:
1. Project type, language(s), framework(s)
2. Existing modules/files relevant to the task
3. Current patterns/conventions for similar features (so the implementation matches them)
4. Existing docs in `./docs/` and any in-flight plans in `./plans/` covering this area
5. Public APIs, schemas, contracts that the task could affect

State a 3-6 bullet codebase-context summary to the user before asking questions. Skip ONLY when input is a `plan.md`/`phase-*.md` path (the plan already encodes scout output).
</HARD-GATE-SCOUT-FIRST>

<HARD-GATE-EXACT-REQUIREMENTS>
Before producing a plan, you MUST be able to answer ALL of these in one concrete sentence each (use `AskUserQuestion` to pin them down — do NOT proceed on vague intent):

1. **Expected output**: the concrete artifact(s) the user will see at the end (file paths, feature behavior, UI screen, API endpoint + payload, CLI command + flags).
2. **Acceptance criteria**: specific behaviors / inputs → outputs / edge cases that MUST work to call it "done".
3. **Scope boundary**: what is explicitly OUT of scope this round.
4. **Non-negotiable constraints**: stack, file locations, naming, backward compatibility, deadlines, performance.
5. **Touchpoints**: which existing files/modules (from scout) will be modified or extended; which contracts must stay stable.

Ground every `AskUserQuestion` option in scout findings (e.g., "Add to `src/api/users.ts` (matches existing pattern) or new `src/api/profile.ts`?"). Skip ONLY when input is a `plan.md`/`phase-*.md` path.
</HARD-GATE-EXACT-REQUIREMENTS>

<HARD-GATE-NO-SIDE-EFFECTS>
Implementation is NOT done until verified to be side-effect-free. Code-review and test gates MUST prove:

1. New behavior matches every acceptance criterion above.
2. All tests pass — including tests in modules that share files/contracts with the change.
3. No existing business logic / workflow regression: explicitly walk each touchpoint and any caller of changed functions.
4. No new lint/type/build errors anywhere in the repo.
5. Public contracts unchanged unless intentional and called out (function signatures, exported types, API responses, DB schemas, env vars, config keys).

User override: If user invoked `--no-test`, item 2 is downgraded to a warning. Surface the unverified-tests risk in the finalize `AskUserQuestion` so the user accepts the trade-off rather than having it silently chosen. Items 1, 3, 4, 5 are enforced via the `code-reviewer` subagent when it runs (high-risk/large-diff or on request); for small low-risk changes, verify them inline.

If review/testing reveals a side effect, regression, or broken workflow, STOP. Use `AskUserQuestion` to present:
- What broke (file, test, workflow, user-facing behavior)
- Why this implementation caused it (1-line cause)
- 2-4 concrete options for the user to choose, e.g.:
  - "Revert this slice and re-plan with stricter scope"
  - "Keep the implementation and update <dependents> to match the new contract"
  - "Add a compatibility shim at <boundary> so old callers keep working"
  - "Accept the regression — old behavior was unintended/buggy"

Let the user decide. Do not silently patch around regressions.
</HARD-GATE-NO-SIDE-EFFECTS>

## Anti-Rationalization

| Thought | Reality |
|---------|---------|
| "This is too simple to plan" | Simple tasks have hidden complexity. Plan takes 30 seconds. |
| "I already know how to do this" | Knowing ≠ planning. Write it down. |
| "Let me just start coding" | Undisciplined action wastes tokens. Plan first. |
| "The user wants speed" | Fastest path = plan → implement → done. Not: implement → debug → rewrite. |
| "I'll plan as I go" | That's not planning, that's hoping. |
| "Just this once" | Every skip is "just this once." No exceptions. |

## Smart Intent Detection

| Input Pattern | Detected Mode | Behavior |
|---------------|---------------|----------|
| Path to `plan.md` or `phase-*.md` | code | Execute existing plan |
| Contains "fast", "quick" | fast | Skip research, scout→plan→code |
| Contains "trust me", "auto" | auto | Auto-approve low-risk artifact-validated steps; stop on high-risk |
| Lists 3+ features OR "parallel" | parallel | Multi-agent execution |
| Contains "no test", "skip test" | no-test | Skip testing step |
| Default | interactive | Full workflow with user input |

See `references/intent-detection.md` for detection logic.

## Process Flow (Authoritative)

```mermaid
flowchart TD
    A[Intent Detection] --> B{Has plan path?}
    B -->|Yes| F[Load Plan]
    B -->|No| C{Mode?}
    C -->|fast| D[Scout → Plan → Code]
    C -->|interactive/auto| SC[Scout Codebase MANDATORY]
    SC --> SR[Summarize Findings to User]
    SR --> RQ{Exact requirements captured?<br/>output, acceptance, scope, constraints, touchpoints}
    RQ -->|No| SR
    RQ -->|Yes| E[Research → Review → Plan]
    E --> F
    D --> F
    F --> G[Review Gate]
    G -->|approved| H[Implement]
    G -->|rejected| E
    H --> H1{Simplify signal?}
    H1 -->|Yes| H2[Conditional Simplify]
    H1 -->|No| I[Review Gate]
    H2 --> I
    I -->|approved| J{--no-test?}
    J -->|No| K[Test]
    J -->|Yes| L[Finalize]
    K --> L
    L --> M[Report + Journal]
```

**This diagram is the authoritative workflow.** Prose sections below provide detail for each node. If prose conflicts with this flow, follow the diagram.

## Workflow Overview

```
[Intent Detection] → [Research?] → [Review] → [Plan] → [Review] → [Implement] → [Conditional Simplify?] → [Review] → [Test?] → [Review] → [Finalize]
```

**Default (non-auto):** Stops at `[Review]` gates for human approval before each major step.
**Auto mode (`--auto`):** Skips human review gates only for low-risk work. High-risk changes stop for human approval before finalize/commit/ship.
**Task tracking:** Use the `update_plan` tool during the implementation step. **Fallback:** If Codex subagent workflows are unavailable (VSCode extension), keep progress in an `update_plan` checklist instead.

| Mode | Research | Testing | Review Gates | Phase Progression |
|------|----------|---------|--------------|-------------------|
| interactive | ✓ | ✓ | **User approval at each step** | One at a time |
| auto | ✓ | ✓ | Auto only if artifacts pass and high-risk stop is false | All low-risk phases continuously |
| fast | ✗ | ✓ | **User approval at each step** | One at a time |
| parallel | Optional | ✓ | **User approval at each step** | Parallel groups |
| no-test | ✓ | ✗ | **User approval at each step** | One at a time |
| code | ✗ | ✓ | **User approval at each step** | Per plan |

## Step Output Format

```
✓ Step [N]: [Brief status] - [Key metrics]
```

## Blocking Gates (Non-Auto Mode)

Human review required at these checkpoints (skipped with `--auto`):
- **Post-Research:** Review findings before planning
- **Post-Plan:** Approve plan before implementation
- **Post-Implementation:** Approve code before testing
- **Post-Testing:** 100% pass + approve before finalize

**Always enforced (all modes):**
- **Testing:** 100% pass required (unless no-test mode)
- **Code Review (conditional):** Spawn `code-reviewer` subagent ONLY when the change is high-risk (auth/secrets/payments/DB schema/migration/public API/CI/deploy/destructive FS — per the review-cycle Risk Triggers) or large-diff, or when the user requests it. Small low-risk changes skip the subagent (verify acceptance inline). When it runs, use explicit checks:
  (a) every acceptance criterion met,
  (b) no regression to business logic in touchpoints/blast-radius,
  (c) no breaking changes to public contracts (signatures, schemas, APIs, env vars) unless called out,
  (d) follows existing patterns from scout,
  (e) no new lint/type/build errors anywhere.
  Pass scout summary + acceptance criteria as context. If reviewer flags side effects → trigger HARD-GATE-NO-SIDE-EFFECTS (`AskUserQuestion` with 2-4 options).
  Then: User approval OR artifact-gated auto approval. Score is advisory; it never approves by itself.
- **Finalize (MANDATORY - never skip):**
  1. **Activate `/project-management` skill (MANDATORY)** → run full plan sync-back across ALL `phase-XX-*.md` (not only current phase), update `plan.md` status/progress, hydrate Codex tasks, generate progress report
  2. `docs-manager` subagent → update `./docs` if changes warrant
  3. `update_plan` → mark all Codex tasks complete after sync-back verification (skip if Codex subagent workflows unavailable)
  4. Ask user if they want to commit via `git-manager` subagent
  5. Run `/journal` to write a concise technical journal entry upon completion

## Epic mode (child plan of an epic)

When cooking a plan that belongs to an epic (an `epic-state.json` container — see
`.codex/skills/plan/references/epic-workflow.md`), cook stops at the **epic boundary**
instead of auto-chaining to the next plan. This is the keystone human-checkpoint.

1. **Init with epic context.** When the plan-dir is a child of an epic, init state with
   the epic pointer so completion is detectable:
   ```bash
   node .codex/hooks/cook-state.cjs init <plan-dir> <total-phases> --epic <epic-dir>
   ```
   This writes `epicDir` into `.cook-state.json`; `check` then surfaces it.

2. **Boundary stop (replaces chain prompt).** After the final phase, when
   `cook-state.cjs check` returns `isComplete: true` AND `epicDir` is set:
   - DO NOT fire the workflow-chain `AskUserQuestion`.
   - Generate the resume checkpoint:
     ```bash
     node .codex/hooks/resume-snapshot.cjs <epic-dir> <this-plan-basename>
     ```
   - Print the emitted `/cook <epic>/<next> --resume` command and **STOP**. The user
     opens a fresh chat and pastes it — fresh top-level context, hard checkpoint
     (spec §7). If `epicDir` is null (standalone plan), the normal chain prompt fires.

3. **`--resume` boot.** On `/cook <plan-dir> --resume`:
   - Read the snapshot under `session-state/resume/` for carry-over context only.
   - Re-derive the next ready plan from the LIVE epic via
     `node .codex/hooks/epic-state.cjs next <epic-dir>` — the snapshot pointer is a
     hint, never trusted (anti-stale).
   - **Auto-detail the next wave (sequential epics only), BEFORE cooking.** If the epic's
     `detailMode` is `sequential` (from `epic-state.cjs check`), run
     `node .codex/hooks/epic-state.cjs next-to-detail <epic-dir>`; for each stub it prints,
     spawn a `planner` agent to write that child's phase files (upstream OUTPUT now exists),
     then `node .codex/hooks/epic-state.cjs rollup <epic-dir>`. `no-plan-to-detail` or
     `upfront` → skip. This removes the manual "now detail plan-NN" nudge; it is PLANNING only,
     so the execution human-checkpoint stays intact. Contract:
     `.codex/rules/phase-completion-gate.md` → "Auto-detail happens at RESUME, not at the boundary".
   - Present a short plan summary, then run that plan (init its cook-state with `--epic`).

Full contract: `.codex/rules/phase-completion-gate.md` → "Epic-boundary exception" and
`.codex/rules/workflow-chaining.md` → "Multi-phase skills (cook)".

### Parallel epics (fan-out / fan-in)

When the epic's `executionMode` is `parallel` (from `epic-state.cjs check`), the boundary
behaves differently from the sequential resume-snapshot flow above. Single-machine, solo:
worktrees share one local `.git`, so branches/refs are visible across chats without push/fetch.

**Worker plan cook (`--worker`).** A worker is a child whose `blockedBy` is the foundation.
The dispatch generator hands the user a `/worktree create epic/<epicId>/<plan-dir>` +
`/cook <abs-plan>/ --epic <abs-epic> --worker` block per worker (see
`epic-parallel-dispatch.cjs`). On the worker's epic boundary (`isComplete: true`, `--worker`,
`executionMode: parallel`):

1. Ensure all work is committed on the worker branch.
2. Write the done-marker — a commit carrying the `Epic-Plan-Done: <plan-dir>` trailer
   (empty commit allowed so the marker always exists):
   ```bash
   git commit --allow-empty -m "chore(epic): mark <plan-dir> done" -m "Epic-Plan-Done: <plan-dir>"
   ```
3. Print "Worker `<plan-dir>` done — branch `epic/<epicId>/<plan-dir>` ready to merge.
   Return to the main tab and run the merge plan once all workers are done." Then **STOP**.
   Do NOT fire the chain prompt and do NOT write a resume snapshot.

If `--worker` is passed but `executionMode` is not `parallel`, warn and fall back to the
normal sequential flow.

**Merge plan cook (fan-in).** The merge plan is the child whose `blockedBy` lists ≥2 workers.
Cook it normally in the main tab, but its phases enforce a fan-in gate:

1. **Gate.** Run `node .codex/hooks/epic-worker-status.cjs <epic-dir>`. If `allDone` is
   false → print `missing` workers and **STOP** (refuse to merge a partial wave).
2. **Merge.** With `allDone: true`, create an integration branch from the foundation base,
   then `git merge --no-ff` each worker branch in `plan-NN` order. On conflict, STOP and hand
   off to the user / `/fix` — never auto-resolve.
3. **Finish.** Run review + test + fix as ordinary cook phases over the integrated result.

Branch convention `epic/<epicId>/<plan-dir>` and trailer `Epic-Plan-Done:` are shared by
`epic-parallel-dispatch.cjs`, worker cook, and `epic-worker-status.cjs` — keep them in sync.

Full contract: `.codex/skills/plan/references/epic-workflow.md` → "Execution Mode".

## Required Subagents (MANDATORY)

| Phase | Subagent | Requirement |
|-------|----------|-------------|
| Research | `researcher` | Optional in fast/code |
| Scout | `scout` | Optional in code |
| Plan | `planner` | Optional in code |
| UI Work | `designer` | If frontend work |
| Testing | `tester`, `debugger` | **MUST** spawn |
| Review | `code-reviewer` | Conditional (high-risk/large-diff or on request) |
| Finalize | `/project-management` skill + `docs-manager`, `git-manager` subagents | **MUST** invoke all |

**CRITICAL ENFORCEMENT:**
- Steps 4, 5, 6 **MUST** use Task tool to spawn subagents
- DO NOT implement testing, review, or finalization yourself - DELEGATE
- If workflow ends with 0 Task tool calls, it is INCOMPLETE
- Pattern: `Task(subagent_type="[type]", prompt="[task]", description="[brief]")`

## References

- `references/intent-detection.md` - Detection rules and routing logic
- `references/workflow-steps.md` - Detailed step definitions for all modes
- `references/review-cycle.md` - Interactive and auto review processes
- `references/subagent-patterns.md` - Subagent invocation patterns
- `../_shared/references/workflow-artifacts.md` - Review artifact schema and validator contract

## Workflow Position

**Typically follows:** `/plan` (execute a plan), `/brainstorm` (implement agreed solution)
**Typically precedes:** `/code-review` (review after implementation), `/test` (validate changes)
**Related:** `/fix` (alternative for bug fixes), `/plan` (create plan before cooking)
