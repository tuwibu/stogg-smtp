/**
 * Tests for resume-snapshot.cjs — spawned via child_process (mirrors epic-state.test.cjs).
 * Run: node .codex/hooks/__tests__/resume-snapshot.test.cjs
 *
 * resume-snapshot.cjs <epic-dir> <done-plan> [--out <dir>]
 *   - reads optional carry-over context from stdin (scrubbed for secrets/DSN)
 *   - derives the next READY plan via epic-state.cjs next (live, not stale)
 *   - writes a snapshot markdown into <out> (default session-state/resume/)
 *
 * Scenarios (per phase-03 Test Spec):
 * 1. snapshot contains the resume command pointing at the next ready plan + --resume
 * 2. a DSN / secret in stdin context is scrubbed (no postgresql://user:pass@ leaks)
 * 3. snapshot file is written under --out and persists after read
 * 4. epic fully completed → snapshot reports done, no resume command
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'resume-snapshot.cjs');
const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'sample-epic');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function assertContains(actual, substr, msg = '') {
  if (typeof actual !== 'string' || !actual.includes(substr)) {
    throw new Error(`${msg}\n  Expected to contain: ${JSON.stringify(substr)}\n  Actual: ${JSON.stringify(actual)}`);
  }
}

function assertNotContains(actual, substr, msg = '') {
  if (typeof actual === 'string' && actual.includes(substr)) {
    throw new Error(`${msg}\n  Expected NOT to contain: ${JSON.stringify(substr)}`);
  }
}

function assertEquals(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
  }
}

function run(args, input) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    input: input || '',
  });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function tmpEpicDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-snap-epic-'));
  copyDir(FIXTURE_DIR, tmp);
  return tmp;
}

function tmpOutDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'resume-snap-out-'));
}

/** Read the single snapshot .md written into out dir. */
function readSnapshot(outDir) {
  const files = fs.readdirSync(outDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) throw new Error('no snapshot file written');
  return fs.readFileSync(path.join(outDir, files[0]), 'utf8');
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test('1. snapshot has resume command for next ready plan (plan-02) + --resume', () => {
  const epic = tmpEpicDir();
  const out = tmpOutDir();
  try {
    // fixture: plan-01 completed, plan-02 pending (ready), plan-03 blocked
    const r = run([epic, 'plan-01-foundation', '--out', out]);
    assertEquals(r.status, 0, `exit code (stderr: ${r.stderr})`);
    const snap = readSnapshot(out);
    assertContains(snap, 'plan-02-feature', 'points at next ready plan');
    assertContains(snap, '--resume', 'includes --resume flag');
    assertContains(snap, '/cook', 'includes cook resume command');
  } finally {
    fs.rmSync(epic, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('2. DSN/secret in stdin context is scrubbed', () => {
  const epic = tmpEpicDir();
  const out = tmpOutDir();
  try {
    const ctx = 'DB connected at postgresql://admin:s3cretP@db.internal:5432/prod and TOKEN=abcdef123456';
    const r = run([epic, 'plan-01-foundation', '--out', out], ctx);
    assertEquals(r.status, 0, `exit code (stderr: ${r.stderr})`);
    const snap = readSnapshot(out);
    assertNotContains(snap, 's3cretP', 'DSN password not leaked');
    assertNotContains(snap, 'admin:s3cretP', 'DSN credentials scrubbed');
    assertNotContains(snap, 'abcdef123456', 'TOKEN value scrubbed');
    assertContains(snap, '[REDACTED]', 'redaction marker present');
  } finally {
    fs.rmSync(epic, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('2b. passwordless-user DSN (redis://:pass@) is scrubbed', () => {
  const epic = tmpEpicDir();
  const out = tmpOutDir();
  try {
    const ctx = 'cache at redis://:s3cretRedis@redis:6379/0 and amqp://:mqpass@rabbit:5672';
    const r = run([epic, 'plan-01-foundation', '--out', out], ctx);
    assertEquals(r.status, 0, `exit code (stderr: ${r.stderr})`);
    const snap = readSnapshot(out);
    assertNotContains(snap, 's3cretRedis', 'redis password not leaked');
    assertNotContains(snap, 'mqpass', 'amqp password not leaked');
  } finally {
    fs.rmSync(epic, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('3. snapshot file persists under --out after being read', () => {
  const epic = tmpEpicDir();
  const out = tmpOutDir();
  try {
    run([epic, 'plan-01-foundation', '--out', out]);
    const files = fs.readdirSync(out).filter(f => f.endsWith('.md'));
    assertEquals(files.length >= 1, true, 'at least one snapshot written');
    // still exists on a second read
    const again = fs.readdirSync(out).filter(f => f.endsWith('.md'));
    assertEquals(again.length, files.length, 'snapshot persists');
  } finally {
    fs.rmSync(epic, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('4. fully completed epic → snapshot reports done, no resume command', () => {
  const epic = tmpEpicDir();
  const out = tmpOutDir();
  try {
    // mark plan-02 and plan-03 completed so no plan is ready
    for (const p of ['plan-02-feature', 'plan-03-extra']) {
      const md = path.join(epic, p, 'plan.md');
      fs.writeFileSync(md, fs.readFileSync(md, 'utf8').replace('status: pending', 'status: completed'));
    }
    const r = run([epic, 'plan-03-extra', '--out', out]);
    assertEquals(r.status, 0, `exit code (stderr: ${r.stderr})`);
    const snap = readSnapshot(out);
    assertNotContains(snap, '--resume', 'no resume command when epic complete');
  } finally {
    fs.rmSync(epic, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
