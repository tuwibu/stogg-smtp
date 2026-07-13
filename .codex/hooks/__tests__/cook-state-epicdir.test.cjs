/**
 * Tests for the Phase-3 epicDir extension of cook-state.cjs (spawned via child_process).
 * Run: node .codex/hooks/__tests__/cook-state-epicdir.test.cjs
 *
 * The baseline characterization suite (cook-state.test.cjs) locks the PRE-epicDir
 * behavior and must remain green. This suite covers ONLY the additive epicDir field:
 *   - `init <plan-dir> <total> --epic <epic-dir>` persists epicDir.
 *   - `check` surfaces epicDir so the cook skill can detect the epic-boundary path.
 *   - no --epic → epicDir is null (old chain flow unaffected).
 *
 * Contract: claude/rules/phase-completion-gate.md (epic-boundary exception)
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

function run(args, cwd) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    cwd: cwd || process.cwd(),
  });
}

function tmpPlanDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cook-state-epic-'));
}

function readStateFile(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), 'utf8'));
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test('1. init --epic persists epicDir in state file', () => {
  const dir = tmpPlanDir();
  try {
    const r = run(['init', dir, '2', '--epic', '/some/epic-dir']);
    assertEquals(r.status, 0, 'exit code');
    const state = readStateFile(dir);
    assertEquals(state.epicDir, '/some/epic-dir', 'epicDir persisted');
    assertEquals(state.totalPhases, 2, 'totalPhases unchanged');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('2. init without --epic leaves epicDir null', () => {
  const dir = tmpPlanDir();
  try {
    run(['init', dir, '2']);
    const state = readStateFile(dir);
    assertEquals(state.epicDir, null, 'epicDir null when not in epic');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('3. check surfaces epicDir (epic-boundary detectable) when complete', () => {
  const dir = tmpPlanDir();
  try {
    run(['init', dir, '1', '--epic', '/some/epic-dir']);
    run(['update', dir, 'phase-01']);
    run(['finalize', dir]);
    const r = run(['check', dir]);
    const out = JSON.parse(r.stdout);
    assertEquals(out.isComplete, true, 'isComplete');
    assertEquals(out.epicDir, '/some/epic-dir', 'check exposes epicDir');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('4. check exposes epicDir:null for a non-epic plan (regression-safe)', () => {
  const dir = tmpPlanDir();
  try {
    run(['init', dir, '1']);
    const r = run(['check', dir]);
    const out = JSON.parse(r.stdout);
    assertEquals(out.epicDir, null, 'non-epic plan reports epicDir null');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
