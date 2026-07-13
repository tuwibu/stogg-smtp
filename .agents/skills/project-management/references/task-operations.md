# Plan State Operations Reference

Plan tracking uses **plan files as the source of truth**, not ephemeral Tasks. Operations are file edits.

## Read plan state

```
Read plan-dir/plan.md          → YAML frontmatter + phase table
Read plan-dir/phase-NN-*.md    → checkboxes + todo lists per phase
```

Parse the YAML frontmatter at top of plan.md for `status`, `priority`, `effort`, `created`. Count `[ ]` vs `[x]` in each phase file for completion %.

## Update checkbox

```
Edit phase-XX-name.md:
  old_string: "- [ ] step description"
  new_string: "- [x] step description"
```

Flip checkbox atomically. One Edit per step completion.

## Update YAML frontmatter status

```
Edit plan.md:
  old_string: "status: in-progress"
  new_string: "status: completed"
```

Update at phase boundaries, not every step.

## Session-scoped subtasks (optional)

Use `update_plan` checklist when an in-progress step has its own granular steps that exist only within the current session (don't survive resume).

```
the `update_plan` checklist([
  { content: "Fetch DTO shape from BE", activeForm: "Fetching DTO shape", status: "in_progress" },
  { content: "Write Zod schema mirror", activeForm: "Writing Zod schema", status: "pending" }
])
```

**Do NOT use the `update_plan` checklist as the persistent task list** — it clears per session. Plan files are persistent; the `update_plan` checklist is the live cursor.

## When to mirror plan items to the `update_plan` checklist

| Scenario | Mirror to the `update_plan` checklist? | Why |
|----------|---------------------|-----|
| Multi-phase plan execution | Yes | Live agent visibility per phase |
| Long step with substeps | Yes | Granular in-session tracking |
| Single quick edit | No | Overhead exceeds benefit |
| Cross-session resume | N/A | Just re-read plan files |

**3-Item Rule:** <3 items → skip the `update_plan` checklist, just do them.

## Sync-back guard

When marking a phase done, sweep ALL phase files in the plan-dir:

```bash
ls plans/<plan-dir>/phase-*.md | wc -l    # total
grep -l "^- \[x\]" plans/<plan-dir>/phase-*.md | wc -l   # done count
```

Backfill stale `[ ]` in earlier phases before flipping later ones to `[x]`. If a completed item can't be mapped to a phase file → report unresolved mapping, don't claim full completion.

## Parallel work coordination

For parallel phases (file-disjoint phases per plan):

1. Each agent owns one phase file exclusively (see `## Related Code Files` → `Modify`/`Create`).
2. Each agent edits only its own phase's checkboxes.
3. On completion → Edit `[ ]` → `[x]` + update YAML frontmatter status of THAT phase.
4. Main session reconciles cross-phase state via `cook-state.cjs check`.

**Key:** Phase file ownership prevents edit conflicts. The state machine (`.cook-state.json`) tracks overall progress.
