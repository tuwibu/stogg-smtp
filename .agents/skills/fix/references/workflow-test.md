# Test Failure Fix Workflow

For fixing failing tests and test suite issues. Uses native Codex task plan items for phase tracking.

## Task Setup (Before Starting)

```
T1 = update_plan(subject="Compile & collect failures", activeForm="Compiling and collecting failures")
T2 = update_plan(subject="Debug root causes",          activeForm="Debugging test failures",       addBlockedBy=[T1])
T3 = update_plan(subject="Plan fixes",                 activeForm="Planning fixes",                addBlockedBy=[T2])
T4 = update_plan(subject="Implement fixes",             activeForm="Implementing fixes",            addBlockedBy=[T3])
T5 = update_plan(subject="Re-test",                     activeForm="Re-running tests",              addBlockedBy=[T4])
T6 = update_plan(subject="Code review",                 activeForm="Reviewing code",                addBlockedBy=[T5])
```

## Workflow

### Step 1: Compile & Collect Failures
`update_plan(T1, status="in_progress")`
Use `tester` agent. Fix all syntax errors before running tests.

- Run full test suite, collect all failures
- Group failures by module/area

`update_plan(T1, status="completed")`

### Step 2: Debug
`update_plan(T2, status="in_progress")`
Use `debugger` agent for root cause analysis.

- Analyze each failure group
- Identify shared root causes across failures

`update_plan(T2, status="completed")`

### Step 3: Plan
`update_plan(T3, status="in_progress")`
Use `planner` agent for fix strategy.

- Prioritize fixes (shared root causes first)
- Identify dependencies between fixes

`update_plan(T3, status="completed")`

### Step 4: Implement
`update_plan(T4, status="in_progress")`
Implement fixes step by step per plan.

`update_plan(T4, status="completed")`

### Step 5: Re-test
`update_plan(T5, status="in_progress")`
Use `tester` agent. If tests still fail → keep T5 `in_progress`, loop back to Step 2.

`update_plan(T5, status="completed")`

### Step 6: Review
`update_plan(T6, status="in_progress")`
Use `code-reviewer` agent.

`update_plan(T6, status="completed")`

## Common Commands
```bash
npm test
bun test
pytest
go test ./...
```

## Tips
- Run single failing test first for faster iteration
- Check test assertions vs actual behavior
- Verify test fixtures/mocks are correct
- Don't modify tests to pass unless test is wrong
