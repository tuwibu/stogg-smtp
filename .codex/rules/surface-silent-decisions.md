# Surface Silent Decisions

When Claude proceeds **without asking** but had to **decide something on the user's behalf** — pick a default, make an assumption, choose a value, cut/defer scope, resolve an ambiguity — that decision is **invisible to the user** unless explicitly surfaced. Silent decisions are where quality silently drifts: the user never gets a chance to catch a wrong default until it ships.

This rule is the complement of `decision-prompt-visibility.md`:
- That rule: when you **ask** via `AskUserQuestion`, print the content being decided first.
- This rule: when you **don't ask** but decide anyway, **list the decision** so the user can review it.

Together: **the user must always be able to see and control any decision made for them — whether you asked or not.**

## The rule

At the end of any turn where you made one or more non-obvious decisions on the user's behalf, emit a compact **"Quyết định tôi đã tự chọn"** block (heading or bold line, then bullets). Each bullet: the decision + the one-line reason + (if applicable) the alternative you rejected.

Format:

```
**Quyết định tôi đã tự chọn (kiểm tra giúp):**
- Dùng `zod` để validate thay vì `joi` — repo đã có zod ở 3 chỗ; tránh thêm dep.
- Đặt page size mặc định = 20 — khớp các endpoint list hiện có; chưa thấy yêu cầu khác.
- Bỏ qua retry cho call nội bộ — out of scope lần này; ghi chú follow-up.
```

The user reads it in 5 seconds and can veto any line. That is the quality gate.

## What counts as a "silent decision" (surface these)

| Category | Example |
|---|---|
| **Default pick on ambiguity** | Chose library / pattern / file location / naming when the request didn't specify |
| **Concrete value** | Threshold, timeout, page size, retry count, port, cache TTL, column type |
| **Assumption to proceed** | Assumed input format, assumed env, assumed "user meant X" |
| **Scope call** | Included X / excluded Y / deferred Z without confirming |
| **Trade-off taken** | Chose perf over readability, skipped error handling "for now", picked simpler-but-narrower approach |
| **Ambiguity resolved by confidence** | Proceeded under the ≥85% confidence path (`review-audit-self-decision.md` §4) instead of asking |

## When NOT to clutter (skip the block)

- Mechanical / forced choices with no real alternative (the only valid import path, the obvious type).
- Decisions the user **already stated** — echoing their own instruction back is noise.
- Trivial style picks that match surrounding code (following existing convention IS the decision; no need to announce).

Rule of thumb: surface a decision when **a reasonable reviewer might have chosen differently** and the cost of a wrong default is non-trivial. If every option is equivalent, stay quiet.

## Interaction with confidence + asking

`review-audit-self-decision.md` §4 says: confidence ≥85% → answer/act directly instead of asking. This rule adds the missing half: **acting directly does NOT mean acting silently.** You still proceeded on a judgment call — disclose it in the decisions block so the user can override even though you didn't stop to ask.

Decision tree:
- Confidence < 85% OR high-reversibility risk → **ask** (`AskUserQuestion`, content visible per `decision-prompt-visibility.md`).
- Confidence ≥ 85% → **proceed**, then **list the decision** in the surface block (this rule).
- Forced/mechanical → just do it, no surfacing.

## Anti-patterns (forbidden)

| Pattern | Why it's wrong |
|---|---|
| Picking a default in `thinking`, shipping it, never mentioning it | User can't QC a decision they never saw |
| Burying a scope cut inside a long report body | Cuts must be scannable, not archeology |
| "I assumed X" only revealed when the user later asks why it broke | Disclose at decision time, not at autopsy time |
| Listing 15 trivial style picks to look thorough | Noise drowns the 1 decision that actually mattered |

## Scope

Universal — every skill and every direct turn. Most load-bearing in implementation turns (`cook`, `fix`, direct edits) where dozens of small defaults accumulate, and in design turns (`brainstorm`, `plan`) where scope/approach calls are made. The block goes at the **end** of the turn's visible response, never inside a tool call.
