# Branch Policy

**The default is: work on the main branch. Do NOT create branches unless the user explicitly asks.**

This rule is the single source of truth for when/how branches get created. `CLAUDE.md`, the `git`
skill, the `ship` skill, and the `git-manager` agent all defer here.

## The one rule

| Situation | Behavior |
|---|---|
| User asks to commit / push, no branch mentioned | Commit & push to the **current main branch** (`main` or `master`). Never create a branch. |
| User explicitly says "tách branch" / "tạo nhánh" / "create a branch" / "new branch" / "work on a branch" | Create a branch — but **ask for the name first** via `AskUserQuestion`. Never pick silently. |
| Already on a non-main branch (user or a worktree put us there) | Stay on it. Commit/push to that branch. Do NOT switch back to main, do NOT create another branch. |

**Auto-creating a branch "theo ý thích" (at the agent's own discretion) is a policy violation.**

## Detecting the main branch (don't assume `main`)

```bash
# Primary: whatever origin/HEAD points at
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
# Fallback: whichever exists locally/remotely
git rev-parse --verify main   >/dev/null 2>&1 && echo main   || \
git rev-parse --verify master >/dev/null 2>&1 && echo master
```

Use the detected name everywhere — a repo on `master` must never be pushed to a fabricated `main`.

## When a branch IS explicitly requested — ask for the name

Do NOT invent `feature/whatever` silently. Fire `AskUserQuestion`:

- **header:** `"Branch name"`
- **question:** `"Tạo branch mới cho thay đổi này. Chọn tên (hoặc tự nhập):"`
- **options:** 2-3 candidate names derived from the actual change + conventional prefix, each with a
  substantive `description` (the change it will hold). The UI auto-appends "Other" so the user can type
  a custom name. Examples of good candidates:
  - `feat/<slug>` — for a new feature
  - `fix/<slug>` — for a bugfix
  - `refactor/<slug>` — for restructuring
- Only after the user picks/enters a name:
  ```bash
  git checkout -b <chosen-name>
  ```

Prefix convention (`feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`, `hotfix/`) lives in
`.claude/skills/git/references/branch-management.md` — reuse it to seed candidate names.

## Interaction with other skills / rules

- **`ship`** — the pipeline historically aborted when run from the main branch. Under this policy that
  abort is **removed**: shipping directly from main is allowed (it's the default). `ship` only moves to
  a branch when the user explicitly asked for one (then it asks for the name per this rule).
- **`worktree`** — creating a worktree is an explicit user action, so it legitimately creates a branch.
  That is NOT a violation of this rule (the user opted in by invoking `/worktree`).
- **`decision-prompt-visibility.md`** — the branch-name `AskUserQuestion` must give each candidate a
  real `description`, not a bare label.
- **`surface-silent-decisions.md`** — if you push to main by default (the no-branch path), that's the
  expected default and needs no special surfacing; but if you had to pick which main name (`main` vs
  `master`) on an ambiguous repo, note it.

## Anti-patterns (forbidden)

| Pattern | Why it's wrong |
|---|---|
| Running `git checkout -b feature/x` because "changes should go on a branch" | User didn't ask — violates the default-to-main rule |
| Creating a branch AND naming it yourself when the user only said "tách branch" | Name must come from the user via `AskUserQuestion` |
| Assuming `main` on a repo whose default is `master` | Push target must be detected, not assumed |
| `ship` aborting because current branch is `main` | Main is the default working branch now — don't force a feature branch |

## Scope

Universal — every skill and every direct turn that stages/commits/pushes/ships. The only sanctioned
branch creations are (a) the user explicitly requesting one, or (b) an explicit `/worktree` invocation.
