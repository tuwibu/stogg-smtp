# Quick Mode (--quick)

Lightweight secrets + dependency + OWASP pattern scan. No red-team persona loop. Designed for pre-commit and CI gates.

## When to Use

- Pre-commit hook: catch accidental secret commits before push
- CI gate: fast security check on every PR
- Quick sanity check before demo or code review
- Replaces deprecated `/security-scan` skill

## Workflow

### 1. Detect Stack

Check for `package.json` (Node), `requirements.txt`/`pyproject.toml` (Python), `go.mod` (Go), `Cargo.toml` (Rust).

### 2. Secret Sweep

Load `references/secret-patterns.md`. Use Grep tool to scan all source files for each pattern category.

Exclude: `.env.example`, test fixtures (`*.test.*`, `*.spec.*`), docs, `node_modules/`, `dist/`, `vendor/`.

For each match: verify not a placeholder → rate severity (CRITICAL / HIGH / MEDIUM). Redact values to first 4 + last 2 chars in output.

### 3. Dependency Audit

Run based on detected stack:

```bash
# Node.js
npm audit --json 2>/dev/null

# Python
pip audit --format json 2>/dev/null

# Go
go list -m -u all 2>/dev/null
```

Parse output → categorize by severity.

### 4. OWASP Pattern Grep

Load `references/vulnerability-patterns.md`. Grep source files for dangerous patterns (SQL injection, XSS, command injection, path traversal, insecure randomness, eval).

For each match: read 5-line context → determine real vulnerability vs false positive.

### 5. Output

Severity-ranked markdown report, no red-team persona, no iterative loop:

```
## Quick Security Scan — {date}

### Summary
| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Secrets  | X | X | X | - |
| Deps     | X | X | X | X |
| Code     | X | X | X | - |

### Findings (ranked by severity)
...

### Recommendations
...
```

Save to `plans/reports/security-quick-{date}.md` if `--save` flag or running in cook workflow.

## Constraints

- NEVER output actual secret values — redact to `<first4>...<last2>`
- NEVER modify code automatically — report only
- NEVER execute found credentials
- If CRITICAL secret found → recommend immediate rotation
