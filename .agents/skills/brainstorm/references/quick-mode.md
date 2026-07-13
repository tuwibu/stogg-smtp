# Quick Mode (--quick)

Short-answer expert architect Q&A. Replaces deprecated `/ask` skill.

## When to Use

- Single focused technical question needing a direct answer
- Architecture decision with clear context — no exploration needed
- Pre-implementation sanity check on an approach
- When you want one expert answer, not a 2-3 path comparison

## What is Skipped

- Completeness Radar (coverage check across edge cases)
- Scope challenge / decomposition loop
- Edge case sweep
- Multi-path comparison (2-3 approach debate)
- Discovery Phase clarifying questions (proceed with given context)

## Workflow

1. **Read context**: `./README.md` + any referenced `./docs/*.md` relevant to the question.
2. **Consult 4 advisors** (internally, no separate output per advisor):
   - Systems Designer — system boundaries and component interactions
   - Technology Strategist — tech choices and patterns
   - Scalability Consultant — non-functional requirements
   - Risk Analyst — trade-offs and risks
3. **Output one expert answer** — direct, concrete, honest. Follow YAGNI / KISS / DRY.
4. **Save report** to `plans/reports/brainstorm-quick-{date}.md` (≤30 lines).

## Output Format

```
## Answer: {question summary}

**Recommendation:** {direct answer}

**Rationale:** {2-4 sentences}

**Key trade-offs:**
- Pro: ...
- Con: ...

**Next step:** {one concrete action}
```

No multi-path comparison table. No "Option A vs Option B vs Option C" unless the question explicitly asks for comparison.

## Constraints

- Do NOT implement anything — analysis and guidance only
- Do NOT ask clarifying questions unless the question is fundamentally ambiguous
- Report ≤ 30 lines
- Brutal honesty: if the approach is wrong, say so directly
