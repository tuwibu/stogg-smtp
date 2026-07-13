---
name: security
description: "STRIDE + OWASP-based security audit with optional red-team persona discovery loop and auto-fix. Scans code for vulnerabilities from multiple attacker perspectives (auth attacker, supply chain, insider, infrastructure), categorizes by severity, and can iteratively fix findings. Use --quick for fast CI/pre-commit scans (replaces deprecated /security-scan)."
user-invocable: true
when_to_use: "Invoke for threat-modeled security audit or auto-fix loops."
category: utilities
keywords: [security, STRIDE, OWASP, audit, red-team, penetration-testing, vulnerability-discovery]
argument-hint: "<scope glob or 'full'> [--fix] [--red-team] [--iterations N]"
metadata:
  author: claudekit
  attribution: "Security audit pattern adapted from iterative discovery loop by Udit Goenka (MIT)"
  license: MIT
  version: "1.0.0"
---

# security — Security Audit

Runs a structured STRIDE + OWASP security audit on a given scope. Produces a severity-ranked findings report. With `--fix`, applies fixes iteratively using an internal iteration loop. Use `--quick` for a fast secrets + deps + OWASP pattern scan (replaces deprecated `/security-scan`).

## When to Use

- Before a release or major deployment
- After adding auth, payment, or data-handling features
- Periodic security review (monthly/quarterly)
- Compliance check (SOC 2, GDPR, PCI-DSS prep)

## When NOT to Use

- Purely cosmetic changes (CSS, copy edits)
- No user-facing code or data handling involved

---

## Modes

| Mode | Invocation | Behavior |
|------|-----------|----------|
| Audit only | `/security <scope>` | Scan → categorize → report (one-shot) |
| Red-team discovery | `/security <scope> --red-team` | Iterate 4 attacker personas → STRIDE/OWASP sweep → report |
| Bounded red-team | `/security <scope> --red-team --iterations N` | Cap persona discovery to N iterations total |
| Audit + Fix | `/security <scope> --fix` | Scan → categorize → fix Confirmed Critical/High → diff → approve → `/git` |
| Red-team + Fix | `/security <scope> --red-team --fix` | Full persona discovery → fix Confirmed Critical/High → diff → approve → `/git` |
| Bounded fix | `/security <scope> --fix --iterations N` | Limit fix iterations to N |
| Quick scan | `/security --quick [scope]` | Regex secrets + deps audit + grep OWASP. For CI/pre-commit. See `references/quick-mode.md`. |

---

## Audit Methodology

### 1. Scope Resolution
Expand the provided glob or `full` keyword into a file list. Read all in-scope files before analysis.

### 2. STRIDE Analysis
Evaluate each threat category systematically:
- **S**poofing — identity/authentication weaknesses
- **T**ampering — input validation, integrity controls
- **R**epudiation — audit logging gaps
- **I**nformation Disclosure — data leakage, secret exposure
- **D**enial of Service — rate limits, resource exhaustion
- **E**levation of Privilege — broken access control, RBAC gaps

### 3. OWASP Top 10 Check
Map findings to OWASP categories (A01–A10). See `references/stride-owasp-checklist.md` for per-category checks.

### 4. Dependency Audit
Run the appropriate package audit tool for the detected stack:
- Node.js: `npm audit`
- Python: `pip-audit`
- Go: `govulncheck`
- Ruby: `bundle audit`

### 5. Secret Detection
Scan for hardcoded API keys, passwords, tokens, and private keys using regex patterns. See `references/stride-owasp-checklist.md` → Secret Patterns.

### 6. Finding Categorization
Assign each finding a severity level (see Severity Definitions below).

---

## Output Format

```
## Security Audit Report

### Summary
- Files scanned: N
- Findings: X critical, Y high, Z medium, W low, V info

### Findings

| # | Severity | Category | File:Line | Description | Fix Recommendation |
|---|----------|----------|-----------|-------------|-------------------|
| 1 | Critical  | Injection | api/users.ts:45 | SQL string concatenation | Use parameterized queries |
| 2 | High      | Auth      | auth/login.ts:12 | No rate limiting | Add express-rate-limit |
```

---

## Red-Team Discovery Mode (--red-team)

When `--red-team` is provided, the audit runs a **multi-persona iterative discovery loop** before (or instead of) the standard one-shot STRIDE/OWASP sweep. Each persona represents a distinct attacker mindset with its own threat model and probe targets.

### Persona Execution Order

1. **Security Adversary** — external hacker; auth bypass, injection, IDOR, privilege escalation
2. **Supply Chain Attacker** — dependency/CI poisoning; CVEs, unsigned artifacts, overly permissive CI
3. **Insider Threat** — compromised internal account; horizontal/vertical escalation, bulk export, audit gaps
4. **Infrastructure Attacker** — runtime/deployment foothold; SSRF, secrets in env, container misconfig

Each persona phase follows the internal iteration loop protocol:
- Select next untested attack vector from persona's probe list
- Assume that attacker's mindset — reason as adversary, not defender
- Probe relevant code, trace data flows, find missing guards
- Validate with proof (file:line, attack scenario, impact)
- Log to `plans/reports/security-audit-<YYMMDD-HHmm>.tsv` with `persona` column
- Chain: prior persona findings compound into later phases

**Artifact path (mandatory).** The results TSV is a complete inventory of the project's unpatched
vulnerabilities, with `file:line`. It goes to `plans/reports/security-audit-<YYMMDD-HHmm>.tsv` and is
gitignored. Never write it to the repo root, and never commit it: masking secrets inside the file does
nothing if the file itself gets pushed.

After all 4 personas complete, a standard STRIDE/OWASP sweep fills remaining coverage gaps.

> See `references/red-team-personas.md` for the full persona catalog: threat models, typical attack vectors, and per-persona probe checklists.

### Credential Hygiene (Mandatory)

All findings across every persona MUST mask secret values before logging. Never emit raw JWTs (`eyJ...`), 32+ char hex strings, AWS key prefixes (`AKIA`, `ASIA`), or connection strings with embedded passwords. Use `<REDACTED_TOKEN>`, `<REDACTED_PASSWORD>`, or reference the env var name only.

---

## Fix Mode (--fix)

When `--fix` is provided, apply fixes after the audit. Fix Mode edits code — so it is bounded on both
axes, and it never commits.

### 1. Select

Only findings where **`severity ∈ {Critical, High}` AND `confidence == Confirmed`** are eligible.

- `Medium` / `Low` / `Info` → report-only. Per Severity Definitions, `Low` is a theoretical risk and
  `Info` carries no direct risk; editing production code over either is a worse trade than leaving it.
- `confidence: Likely` → report-only. An unproven vulnerability is not a licence to change behavior.
  Fixing a hole that does not exist is strictly worse than not fixing it.

Print what was skipped and why. Never drop a finding silently — a reduced fix set the user cannot see
reads as "nothing else was found".

### 2. Fix

For each selected finding, in severity order:
- Apply one targeted fix.
- Run the guard (tests or lint).
- Guard fails → **stop immediately** and report. Do not continue to the next finding.

### 3. Approve

After the loop, show `git diff --stat` and the full diff, then `AskUserQuestion`:
apply / revert / review each finding.

### 4. Hand off

On approval, hand off to `/git`. `/security` **never** runs git itself — `/git` owns commit-message
conventions, the branch policy, and the secret scan. A skill that commits its own work has no reviewer.

> Tip: Use `--iterations N` to cap total fix iterations when scope is large.

---

## Severity Definitions

| Severity | Description | Fix Priority |
|----------|-------------|-------------|
| Critical | Exploitable now, data breach or RCE risk | Immediate — block release |
| High | Exploitable with moderate effort, significant impact | This sprint |
| Medium | Limited exploitability or impact | Next sprint |
| Low | Theoretical risk, defense-in-depth improvement | Backlog |
| Info | Best practice suggestion, no direct risk | Optional |

---

## Integration with Other Skills

- Run after `predict` when the security persona flags concerns
- Feed Critical/High findings into `/security --fix` for automated remediation
- Use `scenario` with `--focus authorization` for deeper auth flow testing
- Pair with `plan` to schedule Medium/Low findings as sprint tasks

---

## Example Invocations

```bash
# One-shot audit — API layer only
/security src/api/**/*.ts

# Red-team discovery — full codebase, all 4 personas
/security full --red-team

# Red-team discovery — bounded to 20 iterations total
/security src/ --red-team --iterations 20

# Red-team discovery + auto-fix confirmed Critical/High
/security full --red-team --fix

# One-shot audit + auto-fix, max 15 iterations
/security src/ --fix --iterations 15
```

---

## Quick Mode (--quick)

Fast secrets regex + dependency audit + OWASP pattern grep. No red-team persona loop. For CI/pre-commit. See `references/quick-mode.md`.

See `references/stride-owasp-checklist.md` for the detailed per-category checklist and secret detection regex patterns.

See `references/red-team-personas.md` for the full persona catalog: threat models, attack vectors, probe checklists, discovery loop integration, and TSV schema extension for `--red-team` mode.

## Lineage

Faithful absorption (in scope) of upstream security audit pattern by Udit Goenka ([uditgoenka/autoresearch](https://github.com/uditgoenka/autoresearch), MIT). The local version supports both one-shot STRIDE + OWASP audit and the red-team-personas iterative discovery loop.

`--quick` flag absorbs the deprecated `/security-scan` skill — see `references/quick-mode.md`.
