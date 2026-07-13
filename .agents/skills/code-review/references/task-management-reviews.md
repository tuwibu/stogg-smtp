# Review Task Management Patterns

Track review pipeline execution via Codex task plan (update_plan, update_plan, update_plan).

## When to Create Tasks

| Review Scope | Tasks? | Rationale |
|--------------|--------|-----------|
| Single-file fix | No | Scout + review + done, overhead not worth it |
| Multi-file feature (3+ files) | Yes | Track scout → review → fix → verify chain |
| Parallel reviewers (2+ scopes) | Yes | Coordinate independent reviews |
| Review cycle with Critical fixes | Yes | Dependencies between fix → re-verify |

**3-Task Rule:** Skip task creation when review pipeline has <3 meaningful steps.

## Review Pipeline as Tasks

```
update_plan: "Scout edge cases"         → pending
update_plan: "Review implementation"    → pending, blockedBy: [scout]
update_plan: "Fix critical issues"      → pending, blockedBy: [review]
update_plan: "Verify fixes pass"        → pending, blockedBy: [fix]
```

Dependency chain auto-unblocks: scout → review → fix → verify.

## Task Schemas

### Scout Task

```
update_plan(
  subject: "Scout edge cases for {feature}",
  activeForm: "Scouting edge cases",
  description: "Identify affected files, data flows, boundary conditions. Changed: {files}",
  metadata: { reviewStage: "scout", feature: "{feature}",
              changedFiles: "src/auth.ts,src/middleware.ts",
              priority: "P2", effort: "3m" }
)
```

### Review Task

```
update_plan(
  subject: "Review {feature} implementation",
  activeForm: "Reviewing {feature}",
  description: "Code-reviewer subagent reviews {BASE_SHA}..{HEAD_SHA}. Plan: {plan_ref}",
  metadata: { reviewStage: "review", feature: "{feature}",
              baseSha: "{BASE_SHA}", headSha: "{HEAD_SHA}",
              priority: "P1", effort: "10m" },
  addBlockedBy: ["{scout-task-id}"]
)
```

### Fix Task (created after review finds issues)

```
update_plan(
  subject: "Fix {severity} issues from review",
  activeForm: "Fixing {severity} review issues",
  description: "Address: {issue_list}",
  metadata: { reviewStage: "fix", severity: "critical",
              issueCount: 3, priority: "P1", effort: "15m" },
  addBlockedBy: ["{review-task-id}"]
)
```

### Verify Task

```
update_plan(
  subject: "Verify fixes pass tests and build",
  activeForm: "Verifying fixes",
  description: "Run test suite, build, confirm 0 failures. Evidence before claims.",
  metadata: { reviewStage: "verify", priority: "P1", effort: "5m" },
  addBlockedBy: ["{fix-task-id}"]
)
```

## Parallel Review Coordination

For multi-scope reviews (e.g., backend + frontend changed independently):

```
// Create scoped review tasks — no blockedBy between them
update_plan(subject: "Review backend auth changes",
  metadata: { reviewStage: "review", scope: "src/api/,src/middleware/",
              agentIndex: 1, totalAgents: 2, priority: "P1" })

update_plan(subject: "Review frontend auth UI",
  metadata: { reviewStage: "review", scope: "src/components/auth/",
              agentIndex: 2, totalAgents: 2, priority: "P1" })

// Both run simultaneously via separate code-reviewer subagents
// Fix task blocks on BOTH completing:
update_plan(subject: "Fix all review issues",
  addBlockedBy: ["{backend-review-id}", "{frontend-review-id}"])
```

## Task Lifecycle

```
Scout:    pending → in_progress → completed (scout report returned)
Review:   pending → in_progress → completed (reviewer findings returned)
Fix:      pending → in_progress → completed (all Critical/Important fixed)
Verify:   pending → in_progress → completed (tests pass, build clean)
```

### Handling Re-Reviews

When fixes introduce new issues → create new review cycle:

```
update_plan(subject: "Re-review after fixes",
  addBlockedBy: ["{fix-task-id}"],
  metadata: { reviewStage: "review", cycle: 2, priority: "P1" })
```

Limit to 3 cycles. If still failing after cycle 3 → escalate to user.

## Integration with Planning Tasks

Review tasks are **separate from** cook/planning phase tasks.

**When cook spawns review:**
1. Cook completes implementation phase → creates review pipeline tasks
2. Review pipeline executes (scout → review → fix → verify)
3. All review tasks complete → cook marks phase as reviewed
4. Cook proceeds to next phase

Review tasks reference the phase but don't block it directly — the orchestrator manages handoff.

## Quality Check

After pipeline registration: `Registered [N] review tasks (scout → review → fix → verify chain)`

## Error Handling

If `update_plan` fails: log warning, fall back to sequential review without update_plan. Review pipeline functions identically — tasks add visibility, not functionality.
