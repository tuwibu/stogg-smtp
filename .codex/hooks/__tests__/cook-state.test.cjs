/**
 * Characterization tests for cook-state.cjs (spawned via child_process).
 * Run: node .codex/hooks/__tests__/cook-state.test.cjs
 *
 * Purpose: lock the CURRENT behavior of cook-state.cjs as a regression
 * safety net before any later phase touches it (epicDir field in Phase 3).
 * These tests must pass on HEAD WITHOUT modifying cook-state.cjs.
 *
 * CLI shape: node cook-state.cjs <init|update|check|finalize> <plan-dir> [arg]
 * Exit codes: 0 = OK / fail-open on check; 1 = command error.
 *
 * Contract: claude/rules/phase-completion-gate.md
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'cook-state.cjs');
const STATE_FILE = '.cook-state.json';

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

function assertEquals(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`);
  }
}

function assertContains(actual, substr, msg = '') {
  if (typeof actual !== 'string' || !actual.includes(substr)) {
    throw new Error(`${msg}\n  Expected to contain: ${JSON.stringify(substr)}\n  Actual: ${JSON.stringify(actual)}`);
  }
}

/** Run cook-state.cjs with argv. Optional cwd. */
function run(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: cwd || process.cwd(),
  });
}

function tmpPlanDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cook-state-test-'));
}

function readStateFile(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8'));
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test('1. init writes state file with correct fields + stdout', () => {
  const dir = tmpPlanDir();
  try {
    const r = run(['init', dir, '3']);
    assertEquals(r.status, 0, 'exit code');
    const state = readStateFile(dir);
    assertEquals(state.totalPhases, 3, 'totalPhases');
    assertEquals(state.completedPhases, 0, 'completedPhases');
    assertEquals(state.status, 'in-progress', 'status');
    const expectedPath = path.join(path.resolve(dir), STATE_FILE);
    assertEquals(r.stdout, `initialized 3 phases at ${expectedPath}\n`, 'stdout');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('2. init with invalid total exits 1', () => {
  const dir = tmpPlanDir();
  try {
    const r = run(['init', dir, 'abc']);
    assertEquals(r.status, 1, 'exit code');
    assertContains(r.stderr, 'invalid total', 'stderr');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('3. update before init exits 1', () => {
  const dir = tmpPlanDir();
  try {
    const r = run(['update', dir, 'phase-01']);
    assertEquals(r.status, 1, 'exit code');
    assertContains(r.stderr, 'no state', 'stderr');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('4. init -> update x2 -> check reports done:2 total:3 not complete', () => {
  const dir = tmpPlanDir();
  try {
    run(['init', dir, '3']);
    run(['update', dir, 'phase-01']);
    run(['update', dir, 'phase-02']);
    const r = run(['check', dir]);
    assertEquals(r.status, 0, 'exit code');
    const out = JSON.parse(r.stdout);
    assertEquals(out.done, 2, 'done');
    assertEquals(out.total, 3, 'total');
    assertEquals(out.isComplete, false, 'isComplete');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('5. check on dir with no state is fail-open (no-state, isComplete:true)', () => {
  const dir = tmpPlanDir();
  try {
    const r = run(['check', dir]);
    assertEquals(r.status, 0, 'exit code');
    const out = JSON.parse(r.stdout);
    assertEquals(out.status, 'no-state', 'status');
    assertEquals(out.isComplete, true, 'isComplete');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('6. check on corrupt JSON is fail-open (no crash)', () => {
  const dir = tmpPlanDir();
  try {
    fs.writeFileSync(path.join(dir, STATE_FILE), '{ not valid json', 'utf8');
    const r = run(['check', dir]);
    assertEquals(r.status, 0, 'exit code');
    const out = JSON.parse(r.stdout);
    assertEquals(out.status, 'no-state', 'status');
    assertEquals(out.isComplete, true, 'isComplete');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('7. finalize sets status complete; check reports isComplete:true', () => {
  const dir = tmpPlanDir();
  try {
    run(['init', dir, '3']);
    run(['update', dir, 'phase-01']);
    const rf = run(['finalize', dir]);
    assertEquals(rf.status, 0, 'finalize exit');
    const state = readStateFile(dir);
    assertEquals(state.status, 'complete', 'status');
    const r = run(['check', dir]);
    const out = JSON.parse(r.stdout);
    assertEquals(out.isComplete, true, 'isComplete');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('8. relative plan-dir resolves same as absolute (locks path.resolve)', () => {
  const dir = tmpPlanDir();
  const parent = path.dirname(dir);
  const base = path.basename(dir);
  try {
    // init via relative path from parent cwd
    const r = run(['init', base, '2'], parent);
    assertEquals(r.status, 0, 'exit code');
    // state file must land at the resolved absolute path
    const state = readStateFile(dir);
    assertEquals(state.totalPhases, 2, 'totalPhases');
    const expectedPath = path.join(path.resolve(parent, base), STATE_FILE);
    assertEquals(r.stdout, `initialized 2 phases at ${expectedPath}\n`, 'stdout uses resolved path');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
