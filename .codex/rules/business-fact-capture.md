# Business-Fact Capture (update-over-create)

When a **business fact changes** (a rule, price, flow, threshold, policy), the change MUST land in
the memory system by **updating the existing fact file**, not by creating a new one beside it. A new
file leaves the stale fact in place until TTL/eviction — the #1 way business docs drift out of sync.

This rule is the single source of truth for the capture gate. `memory-sync` and the memory
convention defer here.

## When this gate applies

Applies before you `Write` a **new** memory fact file whose `metadata.type` is `project` or
`reference` (the business-knowledge buckets). It does NOT apply to:
- `user` / `feedback` facts (personal preferences — machine-local, not versioned business docs).
- Editing an existing fact file (that IS the update path — encouraged).
- Non-memory files.

## The gate (MANDATORY)

Before creating a new `project`/`reference` fact, run the similarity search:

```bash
node .claude/skills/memory-sync/scripts/parse-memory.cjs find "<keyword>" \
  --dir <memory-dir> --type <project|reference> --top 5
```

`<keyword>` = the noun/topic of the fact (e.g. "pricing standard plan", "checkout flow"). Read the
top match's `score`:

| Top score | Action |
|---|---|
| **≥ 0.6** | **UPDATE that file.** Edit its content, bump `metadata.updated`. If the new content *replaces the meaning* of a different existing fact, set `supersedes` (below). Do NOT create a new file. |
| **< 0.6** | No close prior art → create a new fact file. |

Threshold `0.6` is intentionally tunable here (rule-level), not hardcoded in the script — the script
only returns scores. Adjust in this table if it over/under-matches for your repo.

## Recording a supersede

When a new/updated fact **replaces the meaning** of an older fact (rule A → rule B) that lives in a
*separate* file you are keeping for history, set `supersedes` in the new fact's frontmatter:

```yaml
metadata:
  type: project
  id: pricing-standard-plan
  supersedes: pricing-standard-plan-v1   # string, or [id-a, id-b]
```

`memory-sync` then **drops** the superseded fact from the consolidated output (it will not
reach business docs), while a dangling `supersedes` (pointing at an id nobody carries) is surfaced,
never used to delete anything. Prefer editing-in-place; use `supersedes` only when you deliberately
keep the old file around.

## Override (create anyway)

You MAY create a new file despite a ≥ 0.6 match when the two facts are genuinely distinct (same
topic, different rule) — a real business reason, not convenience. When you override:
- Do it explicitly (user said so, or you have a clear business rationale).
- Surface it in the end-of-turn decisions block per `surface-silent-decisions.md`:
  *"Tạo fact mới `X` dù trùng `Y` (score 0.7) vì <lý do business>."*

## Do NOT hard-block via hook (for now)

Enforcement is rule-level (this file + `memory-sync/SKILL.md`), not a `PreToolUse` hook —
KISS/YAGNI. A hook that blocks every new business-fact Write risks false-positives and noise. If
skipping `find` proves a recurring problem in practice, escalate to a gated hook then.

## Secrets / PII

Business facts are committed to `docs/memory/` (git-tracked). NEVER write secrets, tokens,
credentials, or personal PII into a fact — only business rules. Redact before writing.

## Related

- `.claude/skills/memory-sync/SKILL.md` — capture section points here; supersede honored in dedup
- `.claude/skills/docs/references/business-sync-workflow.md` — downstream consumer; honors supersede
- `surface-silent-decisions.md` — override disclosure
- `review-audit-self-decision.md` — scout-first (run `find`) before deciding
