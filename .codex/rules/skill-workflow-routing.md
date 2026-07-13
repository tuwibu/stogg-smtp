# Skill Workflow Routing

> For post-skill chain prompt logic (which option to show after a skill completes, conditional filters by coding level / hasTests / .git), see [`workflow-chaining.md`](./workflow-chaining.md). For multi-phase cook completion gate, see [`phase-completion-gate.md`](./phase-completion-gate.md). For domain-specific skill selection (frontend, backend, DB, security, etc.), see [`skill-domain-routing.md`](./skill-domain-routing.md).

When orchestrating multi-step tasks, consider these workflow sequences. Skills are listed in typical execution order.

## Core Development Workflow

```
/plan → /cook → /test → /simplify → /docs → /git
```

Review is not a hop in this chain — `cook` and `fix` spawn the `code-reviewer` subagent themselves
(see `workflow-chaining.md` → Skill availability). Reach for `/code-review` directly when you want a
mode the subagent does not cover: a PR, a specific commit, `--pending`, or a full codebase audit.

| User Intent | Suggested Start |
|-------------|----------------|
| "implement feature X", "build X", "add X" | `/plan` then `/cook` |
| "execute this plan" | `/cook <plan-path>` |
| "quick implementation" | `/cook --fast` |

## Bugfix Workflow

```
/scout → /debug → /fix → /test → /code-review
```

| User Intent | Suggested Start |
|-------------|----------------|
| "X is broken", "error in X", "bug in X" | `/fix` (auto-scouts internally) |
| "CI is failing", "tests broken" | `/fix --auto` |
| "investigate why X happens" | `/scout` then `/debug` |

## Investigation Workflow

```
/scout → /debug → /brainstorm → /plan
```

| User Intent | Suggested Start |
|-------------|----------------|
| "understand how X works" | `/scout` |
| "why is X happening" | `/debug` |
| "explore options for X" | `/brainstorm` then `/plan` |

## Post-Implementation Checklist

After completing implementation work, consider:
- `/code-review` — review changes before merging
- `/ship` — run full shipping pipeline (tests, review, version, PR)
- `/journal` — document decisions and lessons learned

## Setup Skills

Before starting implementation in a shared codebase:
- `/worktree` — create isolated worktree for the feature/fix
- `/scout` — discover relevant files and code patterns
