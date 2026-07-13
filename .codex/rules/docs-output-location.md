# Docs Output Location (during plan / cook)

**When the user asks to "write docs" while a plan is active or during `cook`, and does NOT name a
target folder → write the doc into the ACTIVE PLAN directory, not `./docs`.**

Rationale: mid-implementation doc requests are almost always API/feature notes meant for a *sibling
project* (e.g. an `admin` frontend consuming the API just built) to read and follow — not permanent
project documentation. They belong next to the plan that produced them.

## The rule

| Situation | Where the doc goes |
|---|---|
| User says "viết docs" / "write docs" / "document this API" **during an active plan or `cook`**, no folder named | **Active plan dir**, as a flat descriptive file: `<plan-dir>/<descriptive-kebab-name>.md` |
| User **explicitly names a folder/path** ("viết docs vào folder `docs`", "put it in `docs/api/`", "write to `packages/x/README`") | Follow the named location exactly |
| User invokes a structured `/docs` subcommand (`init`/`update`/`services`/`flows`/`business-sync`) | Keep that skill's canonical `./docs/**` targets (explicit invocation = explicit destination) |
| No active plan AND no folder named | Ask, or default to `plans/reports/` per `documentation-management.md` — do NOT dump into `./docs` silently |

## Finding the active plan dir

Read the `## Plan Context` block injected by the hook at the top of the user prompt:
- `Plan: <path>` set → that's the active plan dir. Write the doc there.
- `Plan: none` → no active plan. Fall to the "no active plan" row above.

During `cook`, the plan dir is the directory being executed (the one holding the `phase-*.md` files).

## File naming inside the plan dir

Flat file at the plan-dir root, kebab-case, self-describing — mirror the user's own convention:

```
plans/260706-0643-channel-growth-and-youtube-scan/frontend-api-channel-growth.md
```

- Name it after the consumer + surface + feature (e.g. `frontend-api-<feature>.md`,
  `admin-api-<feature>.md`) so a sibling project grepping the plan dir knows what it documents.
- Do NOT nest under a `docs/` subfolder inside the plan — keep it at the plan-dir root next to the
  phase files, unless the user asks otherwise.

## Override precedence

1. **Explicit user path** — always wins. "vào folder docs" / any named path → obey it.
2. **Active plan dir** — default when a plan is active / cooking and no path named.
3. **`plans/reports/`** — fallback when no plan is active and no path named.

`./docs` is NEVER the silent default for an ad-hoc "write docs" request mid-plan — it is used only
when the user names it or runs a structured `/docs` subcommand.

## Anti-patterns (forbidden)

| Pattern | Why it's wrong |
|---|---|
| Writing an ad-hoc API doc into `./docs/` mid-cook without being told to | Pollutes canonical project docs; user wanted it in the plan dir |
| Nesting the doc under `<plan-dir>/docs/…` | User's convention is flat at plan-dir root |
| Ignoring an explicit "vào folder docs" and defaulting to the plan dir | Explicit user path always wins |

## Scope

Applies to freeform documentation the agent writes on request during `plan` / `cook` / direct
implementation turns. The structured `/docs` skill keeps ownership of `./docs/**` for its own
subcommands. Related: `documentation-management.md` (plan/report layout), `branch-policy.md`
(same "default sensibly, obey explicit override" shape).
