#!/usr/bin/env node
/**
 * resume-snapshot.cjs — Epic-boundary checkpoint generator for the /cook skill.
 *
 * Usage:
 *   node resume-snapshot.cjs <epic-dir> <done-plan> [--out <dir>]
 *   (optional carry-over context piped on stdin — scrubbed for secrets/DSN)
 *
 * When a child plan of an epic finishes, cook stops instead of auto-chaining and
 * calls this to write a fresh-chat resume checkpoint:
 *   - derives the NEXT ready plan via `epic-state.cjs next` (live, not stale),
 *   - emits a copy-paste `/cook <epic>/<next> --resume` command,
 *   - carries over scrubbed context (no DSN / API keys / tokens),
 *   - persists the file under session-state/resume/ (gitignored, survives restart).
 *
 * The snapshot's next-plan pointer is a HINT only; `--resume` re-derives the next
 * plan from the live epic to defend against staleness.
 *
 * Exit codes: 0 = OK; 1 = bad args / write failure.
 *
 * Contract: plans/.../phase-03-auto-break-resume.md
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { SECRET_PATTERNS } = require('./secrets-scanner-pre-commit.cjs');

const EPIC_STATE = path.resolve(__dirname, 'epic-state.cjs');
// Anchor to project root (hooks live at <root>/.codex/hooks/) so the snapshot
// always lands inside the gitignored session-state/, regardless of CWD.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_OUT = path.join(PROJECT_ROOT, 'session-state', 'resume');
const REDACTION = '[REDACTED]';

function die(msg) {
  process.stderr.write(`resume-snapshot: ${msg}\n`);
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Scrub secrets from free-text context before persisting it.
 * Reuses SECRET_PATTERNS (DRY) plus a credentialed-URL/DSN pattern that the
 * commit scanner doesn't need but a resume snapshot must catch.
 */
function scrub(text) {
  if (!text) return '';
  let out = text;
  // Credentialed URLs / DSNs: scheme://[user]:pass@host → redact the credentials.
  // Username is optional (`*`) so passwordless-user forms like redis://:pass@host
  // and amqp://:pass@host are also caught.
  out = out.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]*:[^/\s@]+@/gi, `$1${REDACTION}@`);
  for (const { re } of SECRET_PATTERNS) {
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    out = out.replace(new RegExp(re.source, flags), REDACTION);
  }
  return out;
}

/** Read all of stdin synchronously (returns '' if no piped input). */
function readStdin() {
  try {
    if (process.stdin.isTTY) return ''; // avoid blocking an interactive terminal
    return fs.readFileSync(0, 'utf8');
  } catch (_) {
    return '';
  }
}

/** Derive next ready plan dir from the LIVE epic. Returns dir name or null. */
function deriveNextPlan(epicDir) {
  const r = spawnSync(process.execPath, [EPIC_STATE, 'next', epicDir], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const out = (r.stdout || '').trim();
  return out && out !== 'no-ready-plan' ? out : null;
}

function buildSnapshot(epicDir, donePlan, nextPlan, contextScrubbed) {
  const epicId = path.basename(path.resolve(epicDir));
  const ctxBlock = contextScrubbed.trim() || '(none)';
  const lines = [
    `# Resume snapshot — ${epicId}`,
    '',
    `> Checkpoint sau khi xong \`${donePlan}\`. Mở chat mới + dán lệnh resume bên dưới.`,
    '',
  ];

  if (nextPlan) {
    lines.push(
      '## Lệnh resume (copy)',
      '```',
      `/cook ${epicDir}/${nextPlan} --resume`,
      '```',
      '',
      '## Plan kế (tham khảo — cook --resume re-derive từ live epic)',
      `- Next ready (snapshot-time): \`${nextPlan}\``,
      '- `--resume` gọi lại `epic-state.cjs next` để lấy plan ready THỰC (chống stale).',
      '',
    );
  } else {
    lines.push(
      '## Epic hoàn tất',
      'Tất cả plan đã completed — không còn plan kế. Không cần resume.',
      '',
    );
  }

  lines.push(
    '## Context carried over (scrubbed)',
    ctxBlock,
    '',
    `<!-- generated ${nowIso()} -->`,
    '',
  );
  return lines.join('\n');
}

function parseOutFlag(argv) {
  const i = argv.indexOf('--out');
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') { i++; continue; }
    positional.push(argv[i]);
  }
  const [epicDir, donePlan] = positional;
  if (!epicDir || !donePlan) {
    process.stderr.write('usage: resume-snapshot.cjs <epic-dir> <done-plan> [--out <dir>]\n');
    process.exit(1);
  }
  if (!fs.existsSync(path.resolve(epicDir))) die(`epic-dir does not exist: ${epicDir}`);

  const outDir = path.resolve(parseOutFlag(argv) || DEFAULT_OUT);
  const nextPlan = deriveNextPlan(epicDir);
  const contextScrubbed = scrub(readStdin());

  const epicId = path.basename(path.resolve(epicDir));
  const content = buildSnapshot(epicDir, donePlan, nextPlan, contextScrubbed);

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `resume-${epicId}.md`);
  fs.writeFileSync(outPath, content, 'utf8');

  process.stdout.write(`snapshot written: ${outPath}\n`);
  if (nextPlan) process.stdout.write(`resume: /cook ${epicDir}/${nextPlan} --resume\n`);
  else process.stdout.write('epic complete — no resume needed\n');
}

try {
  main();
} catch (e) {
  die(e && e.message ? e.message : String(e));
}
