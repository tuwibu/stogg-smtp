# Tag Workflow

Execute via `git-manager` subagent. Creates the next `v*.*.*` tag on the current `HEAD` and pushes it.

## Version scheme — `vMAJOR.MINOR.PATCH`

Auto-increment order (when the user does NOT specify a version):

```
v1.0.1 → v1.0.2 → ... → v1.0.9 → v1.1.0 → v1.1.1 → ... → v1.1.9 → v1.2.0 → ...
... → v1.9.9 → v1.10.0 → v1.10.1 → ...
```

Rules:
- **PATCH** increments by 1, capped at `9`. When it would exceed `9` → reset to `0` and bump **MINOR**.
- **MINOR** is **NOT** capped at 9. After `v1.9.9` the next tag is `v1.10.0` (two-digit minor), then
  `v1.10.1`, `v1.10.2`, … `v1.10.9`, `v1.11.0`, …
- **MAJOR** never auto-increments. It only changes when the user passes an explicit version.
- **Seed (no existing tag):** first tag is `v0.0.1` (pre-release / still in dev). MAJOR stays `0`
  until the user explicitly cuts a `v1.0.0`.

## Tool 1: Find latest tag + compute next

```bash
latest=$(git tag --list "v[0-9]*.[0-9]*.[0-9]*" --sort=-v:refname | head -1)
if [ -z "$latest" ]; then
  next="v0.0.1"
else
  ver=${latest#v}
  IFS=. read -r MA MI PA <<< "$ver"
  PA=$((PA+1))
  if [ "$PA" -gt 9 ]; then PA=0; MI=$((MI+1)); fi
  next="v${MA}.${MI}.${PA}"
fi
echo "latest=${latest:-none} next=$next"
```

`--sort=-v:refname` is Git's version sort — it orders `v1.10.0` above `v1.9.9` correctly.

**If the user passed an explicit version** (e.g. `/git tags v2.0.0`): skip the auto-compute, validate
it matches `^v[0-9]+\.[0-9]+\.[0-9]+$`, and ensure it does not already exist
(`git rev-parse "$version" 2>/dev/null` → if found, STOP and report the collision).

## Tool 2: Sync `package.json` version + commit

The `package.json` `version` field uses the SAME number **without** the `v` prefix
(`next=v0.0.2` → package version `0.0.2`).

```bash
pkgver="${next#v}"
if [ -f package.json ]; then
  if command -v npm >/dev/null 2>&1; then
    # Also updates package-lock.json; does NOT tag/commit by itself
    npm version "$pkgver" --no-git-tag-version --allow-same-version
  else
    # Fallback: edit the version field in place
    node -e "const f='package.json',p=require('./'+f);p.version='$pkgver';require('fs').writeFileSync(f,JSON.stringify(p,null,2)+'\n')"
  fi
  git add package.json package-lock.json 2>/dev/null
  git commit -m "chore(release): $next"
else
  echo "no package.json — skipping version sync, tagging HEAD as-is"
fi
```

- **No `package.json`** → skip the sync silently, tag current `HEAD` as-is.
- **`package.json` with no `version` field** → skip the sync (do not invent one), tag as-is.
- **Monorepo:** only the root `package.json` is synced unless the user names another path.
- The tag is placed on this release commit (next Tool), so the tag and the bumped version match.

## Tool 3: Create the tag

```bash
git tag "$next"
```

Lightweight tag on the release commit from Tool 2 (or current `HEAD` if no `package.json`).

## Tool 4: Push commit + tag

```bash
git push origin HEAD && git push origin "$next"
```

Pushes the release commit to the current branch, then the new tag. Only the new tag is pushed (not
`--tags`, to avoid pushing unrelated local tags). Follows `branch-policy.md` — pushes to the current
branch, never creates one.

## Output Format

```
✓ latest tag:  v1.0.5
✓ package.json: 1.0.5 → 1.0.6
✓ commit:      chore(release): v1.0.6
✓ new tag:     v1.0.6 (on abc123)
✓ pushed:      origin HEAD + v1.0.6
```

## Error Handling

| Error | Action |
|-------|--------|
| Tag already exists | STOP, show existing tag, do not overwrite |
| Explicit version bad format | STOP, show expected `vX.Y.Z` |
| No commits yet (`HEAD` invalid) | STOP, "commit something before tagging" |
| Push rejected (tag exists on remote) | STOP, report; suggest a manual bump |

## Notes

- No branch involved — tagging is independent of `branch-policy.md`. The tag is placed on whatever
  commit `HEAD` points at, on the current branch.
- Never delete or move an existing tag unless the user explicitly asks.
