# Business-Flow Diagram (brainstorm / plan output)

`brainstorm` and `plan` embed a business-flow diagram only when the user opts in via the `--preview`
flag. The flag also sets a **durable intent** that survives the planning chain
(brainstorm → plan → validate → red-team) so the diagram cook implements against is always current.
This rule is the single source of truth; both skills point here.

## Opt-in: the `--preview` flag

- `--preview` present → diagram intent is ON.
- `--preview` absent → no diagram, ever (default). No auto-detection of flow complexity.

## Durable intent (survives the chain)

The flag is per-invocation, but the intent must persist across planning steps:

- `brainstorm --preview` → record the intent so the downstream `/plan` carries it.
- `/plan --preview`, or a plan created from a `--preview` brainstorm → write `preview: true` into
  `plan.md` frontmatter. This is the persistent marker every later step reads.

## Where the diagram is drawn / refreshed

- **brainstorm (`--preview`):** draw an inline mermaid flow in the summary report — a snapshot of the
  agreed flow at brainstorm time.
- **Pre-cook gate (authoritative):** whenever a planning skill is about to present a handoff that
  offers `/cook` as an option, and `preview: true` is set, **(re)generate** the inline mermaid
  diagram in `plan.md` from the CURRENT requirements — then present the handoff.

"Final" = the gate immediately before cook. Every planning gate (`/plan validate`, `/plan red-team`)
runs before cook and may rewrite the business flow; refreshing once at the pre-cook gate guarantees
the diagram is fresh without re-rendering on every individual edit.

## How to draw

- Write an **inline** ` ```mermaid ` block directly in the report / `plan.md` — renders in markdown.
- Keep it compact (≤ ~12 nodes). If it needs more, the flow is probably under-decomposed.
- Use `mermaidjs-v11` only as a **syntax reference**. Do NOT invoke it as a generator — drawing
  mermaid is just writing text.

## Polished / standalone output

If the user wants a polished, standalone, or interactive diagram (separate file, zoomable HTML),
suggest `/preview --diagram`. Do NOT build a parallel diagram-generation mechanism — `/preview` owns
curated/standalone output.

## Anti-patterns (forbidden)

- Drawing without the `--preview` opt-in.
- Detecting flow complexity to decide whether to draw — the flag is the only signal.
- Leaving a stale brainstorm-time diagram in `plan.md` after validate/red-team changed the flow
  (the pre-cook gate must refresh it).
- Spawning `mermaidjs-v11` as a generator, or creating a new pipeline alongside `/preview`.

## Scope

Applies only to `brainstorm` and `plan` (incl. its `validate` / `red-team` subcommands). No other
skill is affected. The `docs` skill generates flow files via two independent mechanisms, neither part
of this rule's planning-chain `--preview`: `docs services` → `docs/services/<svc>/flows.md`
(per-module, auto), and `docs flows` → `docs/flows/<process>.md` (cross-service business processes).
The old `docs init/update --preview` per-domain generation is deprecated/removed.
