---
name: git
description: "Git operations with conventional commits. Use for staging, committing, pushing, PRs, merges. Auto-splits commits by type/scope. Security scans for secrets."
user-invocable: true
when_to_use: "Invoke for commits, PRs, branch hygiene, or release git steps."
category: dev-tools
keywords: [git, commits, staging, PR, merge]
argument-hint: "cm|cp|pr|merge|tags [args]"
metadata:
  author: claudekit
  version: "1.0.0"
---

# Git Operations

## Default (No Arguments)

If invoked without arguments, use `AskUserQuestion` to present available git operations:

| Operation | Description |
|-----------|-------------|
| `cm` | Stage files & create commits |
| `cp` | Stage files, create commits and push |
| `pr` | Create Pull Request |
| `merge` | Merge branches |
| `tags` | Bump `package.json`, create next `v*.*.*` tag & push |

Present as options via `AskUserQuestion` with header "Git Operation", question "What would you like to do?".

Execute git workflows via `git-manager` subagent to isolate verbose output.

**IMPORTANT:**
- Sacrifice grammar for the sake of concision.
- Ensure token efficiency while maintaining high quality.
- Pass these rules to subagents.

## Branch Policy (MANDATORY)

**Default: commit & push to the current main branch (`main`/`master`). NEVER auto-create a branch.**

- No branch mentioned by the user → operate on the current branch as-is. If on the main branch, push
  to it directly. Do NOT create `feature/*` or any new branch on your own initiative.
- User explicitly asks to branch ("tách branch", "tạo nhánh", "create/new branch") → create one, but
  first call `AskUserQuestion` to let the user pick/enter the branch name (offer 2-3 prefixed
  candidates). Never name it silently.
- Detect main branch — never assume `main`:
  `git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'` (fallback: `main` or
  `master`, whichever exists).
- Full contract: `.codex/rules/branch-policy.md`. Pass this policy to the `git-manager` subagent.

## Arguments
- `cm`: Stage files & create commits
- `cp`: Stage files, create commits and push
- `pr`: Create Pull Request [to-branch] [from-branch]
  - `to-branch`: Target branch (default: main)
  - `from-branch`: Source branch (default: current branch)
- `merge`: Merge [to-branch] [from-branch]
  - `to-branch`: Target branch (default: main)
  - `from-branch`: Source branch (default: current branch)
- `tags [version]`: Sync `package.json` version, create a new tag, and push commit + tag
  - `version` (optional): explicit `vX.Y.Z`. If omitted → auto-increment the latest tag.
  - Auto-increment scheme `vMAJOR.MINOR.PATCH`: PATCH 0→9, then roll to MINOR (`v1.0.9`→`v1.1.0`);
    MINOR uncapped (`v1.9.9`→`v1.10.0`); MAJOR never auto-bumps; seed `v0.0.1` if no tag exists.
  - Updates `package.json` `version` (no `v` prefix) + commits `chore(release): <tag>`, then tags that
    commit. No `package.json` → tags HEAD as-is. Full logic: `references/workflow-tags.md`.

## Quick Reference

| Task | Reference |
|------|-----------|
| Commit | `references/workflow-commit.md` |
| Push | `references/workflow-push.md` |
| Pull Request | `references/workflow-pr.md` |
| Merge | `references/workflow-merge.md` |
| Merge PR | `references/workflow-merge-pr.md` |
| Tags | `references/workflow-tags.md` |
| Standards | `references/commit-standards.md` |
| Safety | `references/safety-protocols.md` |
| Branches | `references/branch-management.md` |
| GitHub CLI | `references/gh-cli-guide.md` |

## Core Workflow

### Step 0: Identity Guard (MANDATORY — run before ANY commit)

Never commit under a Claude/bot identity. If the effective git identity looks like a bot, restore the
repo's real author (most frequent non-bot in history). If none exists, STOP and ask the user — do NOT
guess.
```bash
n=$(git config user.name); e=$(git config user.email)
if printf '%s %s' "$n" "$e" | grep -qiE 'claude|anthropic|\[bot\]'; then
  real=$(git log --all --format='%an|%ae' 2>/dev/null | grep -viE 'claude|anthropic|\[bot\]' \
    | sort | uniq -c | sort -rn | head -1 | sed 's/^ *[0-9]* //')
  if [ -n "$real" ]; then
    git config --local user.name "${real%%|*}" && git config --local user.email "${real##*|}"
    echo "identity restored: $(git config user.name) <$(git config user.email)>"
  else
    echo "IDENTITY_UNKNOWN — STOP, ask user for real git name/email"; exit 1
  fi
fi
```
- **NEVER** pass `--author`, `GIT_AUTHOR_*`, or `GIT_COMMITTER_*` to force a Claude identity.
- `IDENTITY_UNKNOWN` → report `NEEDS_CONTEXT`, controller asks the user, then set the config.

### Step 1: Stage + Analyze
```bash
git add -A && git diff --cached --stat && git diff --cached --name-only
```

### Step 2: Security Check
Scan for secrets before commit:
```bash
git diff --cached | grep -iE "(api[_-]?key|token|password|secret|credential)"
```
**If secrets found:** STOP, warn user, suggest `.gitignore`.

### Step 3: Split Decision

**NOTE:**
- Search for related issues on GitHub and add to body.
- Only use `feat`, `fix`, or `perf` prefixes for files in `.claude` directory (do not use `docs`).

**Split commits if:**
- Different types mixed (feat + fix, code + docs)
- Multiple scopes (auth + payments)
- Config/deps + code mixed
- FILES > 10 unrelated

**Single commit if:**
- Same type/scope, FILES ≤ 3, LINES ≤ 50

### Step 4: Commit
```bash
git commit -m "type(scope): description"
```

## Output Format
```
✓ staged: N files (+X/-Y lines)
✓ security: passed
✓ commit: HASH type(scope): description
✓ pushed: yes/no
```

## Error Handling

| Error | Action |
|-------|--------|
| Secrets detected | Block commit, show files |
| No changes | Exit cleanly |
| Push rejected | Suggest `git pull --rebase` |
| Merge conflicts | Suggest manual resolution |

## References

- `references/workflow-commit.md` - Commit workflow with split logic
- `references/workflow-push.md` - Push workflow with error handling
- `references/workflow-pr.md` - PR creation with remote diff analysis
- `references/workflow-merge.md` - Branch merge workflow
- `references/workflow-merge-pr.md` - PR merge via gh CLI (review → label → confirm → merge)
- `references/workflow-tags.md` - Auto-increment `v*.*.*` tag creation + push
- `references/commit-standards.md` - Conventional commit format rules
- `references/safety-protocols.md` - Secret detection, branch protection
- `references/branch-management.md` - Naming, lifecycle, strategies
- `references/gh-cli-guide.md` - GitHub CLI commands reference
