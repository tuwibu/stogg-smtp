#!/usr/bin/env node
// PreToolUse hook on Bash.
// Triggers on: git commit, git add
// Action: scan staged diff for secrets → block (exit 2) with offending path/line.
// Allowlist: .ck.json hooks['secrets-scanner-pre-commit'].allow (array of regex strings)
// Bypass:    .ck.json hooks['secrets-scanner-pre-commit'] === false

'use strict';

const { execFileSync } = require('child_process');
const { isHookEnabled, getHookOption } = require('./lib/ck-config-utils.cjs');

// ─── Secret patterns ────────────────────────────────────────────────────────
// Keep compiled outside the hot path (single parse per invocation).

const SECRET_PATTERNS = [
  // AWS access key id
  { name: 'AWS Access Key',       re: /\bAKIA[0-9A-Z]{16}\b/ },
  // AWS secret access key — context-anchored to avoid matching 40-char SHAs / base64 blobs
  { name: 'AWS Secret Key',       re: /(?:aws.?secret.?access.?key|aws_secret)\s*[:=]\s*['"]?[A-Za-z0-9/+]{40}['"]?/i },
  // Generic high-entropy API key ≥32 alphanum chars following common assignment patterns
  { name: 'API Key (generic)',    re: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([A-Za-z0-9_\-]{32,})['"]?/i },
  // JWT (three base64url segments)
  { name: 'JWT',                  re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  // PEM private key block
  { name: 'Private Key',         re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/ },
  // PASSWORD= / SECRET= / TOKEN= with a value on same line (no \b — catches DB_PASSWORD= etc.)
  { name: 'PASSWORD assignment', re: /(?:PASSWORD|PASSWD|SECRET|TOKEN)\s*=\s*['"]?[^\s'"]{6,}['"]?/i },
  // JSON credential field: "...PASSWORD"/"...PWD"/"...SECRET"/"...TOKEN": "value"
  // Catches inline credentials in .mcp.json / config JSON (env-ref ${VAR} is exempt).
  { name: 'JSON credential', re: /"[^"]*(?:password|passwd|pwd|secret|token)"\s*:\s*"(?!\$\{?)(?!https?:\/\/)[^"]{6,}"/i },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Run git diff --cached and return stdout string, or null on error. */
function getStagedDiff(cwd) {
  try {
    return execFileSync('git', ['diff', '--cached', '--unified=0'], {
      encoding: 'utf8',
      timeout: 10000,
      cwd: cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
  } catch {
    return null;
  }
}

/**
 * Returns list of staged .env* files (from diff header lines).
 * e.g. "+++ b/.env.local" → ".env.local"
 */
function stagedEnvFiles(diff) {
  const found = [];
  const lines = diff.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++ b/')) {
      const file = line.slice(6).trim();
      if (/(?:^|[/\\.])\.env(?:\.[^\\/]*)?$/.test(file) && !/\.example$|\.sample$|\.template$/i.test(file) && !isExemptPath(file)) {
        found.push(file);
      }
    }
  }
  return found;
}

/**
 * Test files legitimately contain fake secrets as fixtures (e.g. this hook's own
 * test). Exempt them by path so real secrets are still caught everywhere else —
 * this replaces value-based allowlisting, which would weaken the scan repo-wide.
 */
function isExemptPath(file) {
  return /(?:^|[/\\])__tests__[/\\]/.test(file) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/**
 * Scan diff lines (added lines only, starting with '+' but not '+++')
 * against SECRET_PATTERNS. Returns array of findings.
 */
function scanDiff(diff, allowPatterns) {
  const findings = [];
  let currentFile = '<unknown>';
  let lineNum = 0;

  for (const raw of diff.split('\n')) {
    // Track current file from diff header
    if (raw.startsWith('+++ b/')) {
      currentFile = raw.slice(6).trim();
      lineNum = 0;
      continue;
    }
    // Track line numbers from hunk headers: @@ -a,b +c,d @@
    const hunkMatch = raw.match(/^@@ [^+]*\+(\d+)/);
    if (hunkMatch) {
      lineNum = parseInt(hunkMatch[1], 10) - 1;
      continue;
    }
    // Only scan added lines
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      lineNum++;
      if (isExemptPath(currentFile)) continue; // test fixtures hold fake secrets by design
      const content = raw.slice(1); // strip leading '+'

      for (const { name, re } of SECRET_PATTERNS) {
        if (re.test(content)) {
          const finding = { file: currentFile, line: lineNum, type: name, content: content.slice(0, 120) };
          // Check against allowlist
          if (!isAllowed(finding, allowPatterns)) {
            findings.push(finding);
          }
          break; // one finding per line is enough
        }
      }
    } else if (!raw.startsWith('-') && !raw.startsWith('\\') && raw !== '') {
      lineNum++;
    }
  }

  return findings;
}

/** Check if a finding matches any allowlist pattern. */
function isAllowed(finding, allowPatterns) {
  if (!allowPatterns || allowPatterns.length === 0) return false;
  for (const pattern of allowPatterns) {
    let re;
    try {
      re = new RegExp(pattern);
    } catch {
      continue; // Invalid regex in allowlist — ignore
    }
    if (re.test(finding.content) || re.test(finding.file)) return true;
  }
  return false;
}

/** Check if a command segment is git commit or git add. */
function isGitCommitOrAdd(segment) {
  const s = segment.trim();
  return /(?:^|\s)git\s/.test(s) && /\bgit\s+(?:commit|add)\b/.test(s);
}

// ─── Exports ────────────────────────────────────────────────────────────────
// SECRET_PATTERNS is reused by resume-snapshot.cjs to scrub carry-over context.
// Guarded by require.main so requiring this file never attaches the stdin reader.
module.exports = { SECRET_PATTERNS };

// ─── Main ─────────────────────────────────────────────────────────────────────

if (require.main === module) {
let payload = '';
process.stdin.on('data', c => { payload += c; });
process.stdin.on('end', () => {
  let data;
  try { data = JSON.parse(payload || '{}'); } catch { process.exit(0); }

  // Check hook enabled
  if (!isHookEnabled('secrets-scanner-pre-commit')) process.exit(0);

  const cmd = (data?.tool_input?.command || '').toString();
  if (!cmd) process.exit(0);

  // Only trigger on git commit / git add segments
  const segments = cmd.split(/&&|\|\||;/);
  const triggered = segments.some(isGitCommitOrAdd);
  if (!triggered) process.exit(0);

  // Read allowlist from config
  const allowPatterns = getHookOption('secrets-scanner-pre-commit', 'allow', []);

  // Get staged diff
  const diff = getStagedDiff();
  if (!diff) process.exit(0); // can't read diff — fail open

  // Check for staged .env files
  const envFiles = stagedEnvFiles(diff);

  // Scan diff for secret patterns
  const findings = scanDiff(diff, allowPatterns);

  const blocked = findings.length > 0 || envFiles.length > 0;
  if (!blocked) process.exit(0);

  // Build error message
  const lines = ['[secrets-scanner] BLOCKED: staged content contains potential secrets.\n'];

  if (envFiles.length > 0) {
    lines.push('  Staged .env files (should not be committed):');
    for (const f of envFiles) lines.push(`    • ${f}`);
    lines.push('');
  }

  if (findings.length > 0) {
    lines.push('  Secret pattern matches:');
    for (const f of findings) {
      lines.push(`    • ${f.file}:${f.line}  [${f.type}]`);
      lines.push(`      ${f.content.replace(/\n/g, '\\n')}`);
    }
    lines.push('');
  }

  lines.push('  How to fix:');
  lines.push('    1. Unstage the file: git restore --staged <file>');
  lines.push('    2. Add to .gitignore if it must never be committed.');
  lines.push('    3. Remove the secret from the file, then re-stage.');
  lines.push('    4. False positive? Add a regex to .ck.json:');
  lines.push('         "hooks": { "secrets-scanner-pre-commit": { "allow": ["your-pattern"] } }');
  lines.push('    5. Disable hook entirely: set the value to false in .ck.json.');

  process.stderr.write(lines.join('\n') + '\n');
  process.exit(2);
});
}
