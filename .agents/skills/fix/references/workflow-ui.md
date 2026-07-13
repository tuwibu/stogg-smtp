# UI Fix Workflow

For fixing visual/UI issues. Requires design skills. Uses native Codex task plan items for phase tracking.

## Required Skills (activate in order)
1. `ui-ux-pro-max` - Design database (ALWAYS FIRST)
2. `ui-ux-pro-max` - Design principles
3. `frontend-design` - Implementation patterns

## Pre-fix Research
```bash
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "<product-type>" --domain product
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "<style>" --domain style
python3 .agents/skills/ui-ux-pro-max/scripts/search.py "accessibility" --domain ux
```

## Task Setup (Before Starting)

```
T1 = update_plan(subject="Analyze visual issue",    activeForm="Analyzing visual issue")
T2 = update_plan(subject="Implement UI fix",         activeForm="Implementing UI fix",       addBlockedBy=[T1])
T3 = update_plan(subject="Verify visually",          activeForm="Verifying visually",         addBlockedBy=[T2])
T4 = update_plan(subject="DevTools check",           activeForm="Checking with DevTools",     addBlockedBy=[T3])
T5 = update_plan(subject="Test compilation",         activeForm="Testing compilation",        addBlockedBy=[T4])
T6 = update_plan(subject="Update design docs",       activeForm="Updating design docs",       addBlockedBy=[T5])
```

## Workflow

### Step 1: Analyze
`update_plan(T1, status="in_progress")`
Analyze screenshots/videos with `ai-multimodal` skill.

- Read `./docs/design-guidelines.md` first
- Identify exact visual discrepancy

`update_plan(T1, status="completed")`

### Step 2: Implement
`update_plan(T2, status="in_progress")`
Use `designer` agent.

`update_plan(T2, status="completed")`

### Step 3: Verify Visually
`update_plan(T3, status="in_progress")`
Screenshot + `ai-multimodal` analysis.

- Capture parent container, not whole page
- Compare to design guidelines
- If incorrect → keep T3 `in_progress`, loop back to Step 2

`update_plan(T3, status="completed")`

### Step 4: DevTools Check
`update_plan(T4, status="in_progress")`
Use `browser`, `browser`, Chrome MCP / `chrome-devtools-mcp`, or project-native browser tests.

`update_plan(T4, status="completed")`

### Step 5: Test
`update_plan(T5, status="in_progress")`
Use `tester` agent for compilation check.

`update_plan(T5, status="completed")`

### Step 6: Document
`update_plan(T6, status="in_progress")`
Update `./docs/design-guidelines.md` if needed.

`update_plan(T6, status="completed")`

## Tips
- Use `ai-multimodal` for generating visual assets
- Use `ImageMagick` for image editing
