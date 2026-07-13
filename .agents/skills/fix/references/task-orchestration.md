# Task Orchestration

Codex task planning for tracking and coordinating fix workflows.

**Skill:** Activate `project-management` for advanced task orchestration — provides hydration (plan checkboxes → Tasks), sync-back (Tasks → plan checkboxes), cross-session resume, and progress tracking patterns.

**Tool Availability:** `update_plan`, `update_plan`, `update_plan`, `update_plan` are **CLI-only** — disabled in VSCode extension (`isTTY` check). If these tools error, use `update_plan` checklist for progress tracking instead. Fix workflow remains fully functional — Tasks add visibility and coordination, not core functionality.

## When to Use Tasks

| Complexity | Use Tasks? | Reason |
|-----------|-----------|--------|
| Simple/Quick | No | < 3 steps, overhead exceeds benefit |
| Moderate (Standard) | Yes | 6 steps, multi-subagent coordination |
| Complex (Deep) | Yes | 9 steps, dependency chains, parallel agents |
| Parallel | Yes | Multiple independent issue trees |

## Task Tools

- `update_plan(subject, description, activeForm, metadata)` - Create task
- `update_plan(taskId, status, addBlockedBy, addBlocks)` - Update status/deps
- `update_plan(taskId)` - Get full task details
- `update_plan()` - List all tasks with status

**Lifecycle:** `pending` → `in_progress` → `completed`

## Standard Workflow Tasks (6 phases)

Create all tasks upfront, then work through them:

```
T1 = update_plan(subject="Scout codebase",       activeForm="Scouting codebase",     metadata={step: 1, phase: "investigate"})
T2 = update_plan(subject="Diagnose root cause",   activeForm="Diagnosing root cause", metadata={step: 2, phase: "investigate"})
T3 = update_plan(subject="Implement fix",         activeForm="Implementing fix",      metadata={step: 3, phase: "implement"},  addBlockedBy=[T1, T2])
T4 = update_plan(subject="Verify + prevent",      activeForm="Verifying fix",         metadata={step: 4, phase: "verify"},     addBlockedBy=[T3])
T5 = update_plan(subject="Code review",           activeForm="Reviewing code",        metadata={step: 5, phase: "verify"},     addBlockedBy=[T4])
T6 = update_plan(subject="Finalize",              activeForm="Finalizing",            metadata={step: 6, phase: "finalize"},   addBlockedBy=[T5])
```

Update as work progresses:
```
update_plan(taskId=T1, status="in_progress")
// ... scout codebase ...
update_plan(taskId=T1, status="completed")
// T3 auto-unblocks when T1 + T2 complete
```

## Deep Workflow Tasks (9 phases)

Steps 1+2+3 run in parallel (scout + diagnose + research).

```
T1 = update_plan(subject="Scout codebase",           metadata={step: 1, phase: "investigate"})
T2 = update_plan(subject="Diagnose root cause",       metadata={step: 2, phase: "investigate"})
T3 = update_plan(subject="Research solutions",         metadata={step: 3, phase: "investigate"})
T4 = update_plan(subject="Brainstorm approaches",      metadata={step: 4, phase: "design"},     addBlockedBy=[T1, T2, T3])
T5 = update_plan(subject="Create implementation plan", metadata={step: 5, phase: "design"},     addBlockedBy=[T4])
T6 = update_plan(subject="Implement fix",              metadata={step: 6, phase: "implement"},  addBlockedBy=[T5])
T7 = update_plan(subject="Verify + prevent",           metadata={step: 7, phase: "verify"},     addBlockedBy=[T6])
T8 = update_plan(subject="Code review",                metadata={step: 8, phase: "verify"},     addBlockedBy=[T7])
T9 = update_plan(subject="Finalize & docs",            metadata={step: 9, phase: "finalize"},   addBlockedBy=[T8])
```

**Note:** Steps 1, 2, and 3 run in parallel (scout + diagnose + research simultaneously).

## Parallel Issue Coordination

For 2+ independent issues, create separate task trees per issue:

```
// Issue A tree
update_plan(subject="[Issue A] Scout",      metadata={issue: "A", step: 1})
update_plan(subject="[Issue A] Diagnose",   metadata={issue: "A", step: 2})
update_plan(subject="[Issue A] Fix",        metadata={issue: "A", step: 3}, addBlockedBy=[A-step1, A-step2])
update_plan(subject="[Issue A] Verify",     metadata={issue: "A", step: 4}, addBlockedBy=[A-step3])

// Issue B tree
update_plan(subject="[Issue B] Scout",      metadata={issue: "B", step: 1})
update_plan(subject="[Issue B] Diagnose",   metadata={issue: "B", step: 2})
update_plan(subject="[Issue B] Fix",        metadata={issue: "B", step: 3}, addBlockedBy=[B-step1, B-step2])
update_plan(subject="[Issue B] Verify",     metadata={issue: "B", step: 4}, addBlockedBy=[B-step3])

// Final shared task
update_plan(subject="Integration verify",   addBlockedBy=[A-step4, B-step4])
```

Spawn `developer` subagents per issue tree. Each agent:
1. Claims tasks via `update_plan(status="in_progress")`
2. Completes tasks via `update_plan(status="completed")`
3. Blocked tasks auto-unblock when dependencies resolve

## Subagent Task Assignment

Assign tasks to subagents via `owner` field:

```
update_plan(taskId=taskA, owner="agent-scout")
update_plan(taskId=taskB, owner="agent-diagnose")
```

Check available work: `update_plan()` → filter by `status=pending`, `blockedBy=[]`, `owner=null`

## Rules

- Create tasks BEFORE starting work (upfront planning)
- Only 1 task `in_progress` per agent at a time
- Mark complete IMMEDIATELY after finishing (don't batch)
- Use `metadata` for filtering: `{step, phase, issue, severity}`
- If task fails → keep `in_progress`, create subtask for blocker
- Skip Tasks entirely for Quick workflow (< 3 steps)
