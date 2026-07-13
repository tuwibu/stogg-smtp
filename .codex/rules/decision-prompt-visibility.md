# Decision-Prompt Visibility

`AskUserQuestion` renders a popup with **short labels + one-line descriptions only**. It is a tool for capturing a **decision**, NOT for explaining the thing being decided. The full content lives in your thinking — which the user never sees.

## The bug this prevents

A skill computes "Phương án A / Phương án B" (or "Approach 1 vs 2", named designs, a recommended option) entirely inside `thinking`, then fires `AskUserQuestion` asking *"Bạn duyệt Phương án A chứ?"*. The popup label says `Phương án A (canonical DTO + 6 phases)` — but the user has **never seen what Phương án A actually contains**. They are asked to approve a black box.

## The rule

When `AskUserQuestion` options **reference a named alternative, a design, a recommendation, or any artifact the user has not already seen printed**, the content being decided MUST be visible to the user. Two ways to satisfy this, in order of preference:

1. **In the popup itself (primary, harness-independent):** give every named-alternative option a substantive `description` (≥ 40 chars). `preview` (multi-line markdown) also satisfies the gate, but some UIs (e.g. VSCode extension popup) do not render it — the `description` must stand alone.
2. **In prior visible response text (fallback):** print each option — what it is, key trade-offs (1-3 bullets), and why you recommend one — as visible markdown, then reference those names in the popup. To be reliably seen, that text must be **end-of-turn text** (no tool call after it), with the popup opening in the next turn.

**Harness limitation (why tool_input is primary):** in some harnesses (e.g. VSCode extension), assistant text emitted *mid-turn* (before/between tool calls) is **not persisted to the transcript and may never render to the user**. Only the final text of a turn is guaranteed visible. Content placed inside the tool call (`description`/`preview`) is immune to this. Long analysis belongs in the **final text of the previous turn**, not sandwiched between tool calls.

### Explain = end turn (MANDATORY)

When the user asks for an explanation / analysis / deep-dive — including by picking an
"explain more" / "Hỏi thêm" option **inside a popup** — the answer MUST be delivered as the
**final text of the turn, with NO tool call after it**. Do NOT chain straight into the next
`AskUserQuestion` in the same turn: a popup answer is a `tool_result`, not a turn boundary, so
any text printed between two popups in one turn is swallowed on affected harnesses.

Correct flow: answer → end turn → user reads & replies → ballot popup in the NEXT turn.
The extra user keystroke is the feature, not a cost — it is the moment the user actually reads.

**This narrows WHEN the popup fires — it does NOT remove popups.** The next assistant turn MUST
still open the `AskUserQuestion` ballot (as the first action of that turn). Replacing a ballot
with "trả lời bằng text giúp tôi" / a numbered-question list the user must type answers to is a
violation, not compliance — it breaks decision capture and workflow chaining.

Scope guard — this section applies ONLY to explanation/deep-dive answers. It does NOT apply to:
- **Clarifying-question batteries (Discovery):** open the popup in the same turn as usual —
  their options are self-contained via labels + descriptions, no prior essay needed.
- **Workflow-chain handoff prompts** (`Next step`, plan handoff, per `workflow-chaining.md`):
  these still fire as the last tool call of the completing turn, unchanged.

## What does NOT need this

- Pure clarifying questions grounded in facts already on screen ("Endpoint in `src/api/users.ts` or new `src/api/profile/`?") — the options are self-explanatory.
- Workflow-chain prompts ("Proceed to /test / Stop here") — the next-step names are self-describing.
- Yes/no confirmations of something stated verbatim in the prior visible turn.

The trigger is specifically: **the option text references content the user has only seen in label form, or not at all.**

> Complement: when you **don't** ask but still decide something on the user's behalf (default pick, assumption, scope cut), surface it per `.claude/rules/surface-silent-decisions.md`. Asked or not, every decision made for the user must be visible.

## Anti-patterns (forbidden)

| Pattern | Why it's wrong |
|---|---|
| Designing options A/B/C in `thinking`, then only surfacing them as popup labels | User approves a black box; cannot make an informed choice |
| `question: "Duyệt thiết kế Phương án A chứ?"` with no prior visible description of A | "Phương án A" is undefined from the user's side of the screen |
| Bare 5-word labels with empty/skimpy descriptions and no preview | Labels are identifiers, not specs — the user cannot infer the design |
| Padding `description` with filler just to clear the 40-char gate | Gate is a guard-rail, not the goal — content must actually explain the option |

## Enforcement

The `decision-visibility-gate` hook (`PreToolUse`, matcher `AskUserQuestion`) blocks calls that
violate this rule. When blocked, the hook exits 2 and prints a corrective stderr message listing
the missing option labels and the self-correction steps.

### Modes

| Mode | Behaviour | Config |
|---|---|---|
| `strict` (default) | Every named-alternative option must pass **either** the tool_input check (`description` ≥ 40 chars OR non-empty `preview`) **or** the transcript check (name-part appears in visible assistant text of the last 3 turns). Options failing both are blocked. | _(no config needed)_ |
| `minimal` | Passes when ≥ 100 characters of visible text exist in the lookback window **or** all named-alternative options pass the tool_input check. | `hooks['decision-visibility-gate']: { "mode": "minimal" }` |

**Named-alternative signals:** label matches the `Phương án/Approach/Plan/Design + X` prefix
pattern, or contains an em-dash (—). A bare `(Recommended)` suffix is NOT a signal — the
AskUserQuestion convention appends it to the suggested option of any question, including plain
clarifying prompts, so gating on it blocks ordinary questions.

### Disable / configure (`.claude/.ck.json` or `.codex/.ck.json`)

```jsonc
// Disable entirely (skip the gate for this project):
{ "hooks": { "decision-visibility-gate": false } }

// Soften to minimal mode:
{ "hooks": { "decision-visibility-gate": { "mode": "minimal" } } }
```

### Exempt patterns (built into the checker)

The gate does **not** fire for:
- Questions whose `header` is in the fixed exempt set: `Next step`, `File Access`,
  `Plan Dependency`, `Planning Operation`
- Questions where every option label matches workflow-chain patterns
  (`Proceed to /`, `Skip to /`, `Stop here`, `Cook now`, …)
- Short binary confirms: exactly 2 options, both ≤ 25 chars, no em-dash

### Exempt-list coupling warning

The exempt header set lives in `.claude/hooks/lib/decision-visibility-checker.cjs`
(`EXEMPT_HEADERS`). If chain-prompt `header` strings change in `workflow-chaining.md` (e.g.
`"Next step"` is renamed), the `EXEMPT_HEADERS` constant in the checker **must** be updated in
the same commit — and the `.codex/hooks/lib/` mirror kept byte-identical.

**Codex:** `.codex/hooks/lib/` mirrors this lib for parity; the codex runtime does not support
`AskUserQuestion` PreToolUse gating so the gate is claude-side only. Lib mirror kept in sync to
share classification logic if codex ever gains this hook event.

## Scope

Applies to every skill and to direct (non-skill) turns. Most acute in `brainstorm` (design-approval gate) and `plan` (handoff / scope selection), but the rule is universal: **never ask the user to choose between things they cannot see.**
