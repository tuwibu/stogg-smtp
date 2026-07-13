/**
 * Tests for epic-parallel-dispatch.cjs — spawned via child_process.
 * Run: node .codex/hooks/__tests__/epic-parallel-dispatch.test.cjs
 *
 * Scenarios:
 * 1. parallel epic, foundation completed, 2 workers ready → 2 blocks with worktree+cook+trailer
 * 2. branch name = epic/<epicId>/<plan-dir>, abs plan path present
 * 3. sequential epic → warns, no worker blocks
 * 4. no ready worker (foundation pending) → no-ready-plan message
 * 5. missing epic-dir → exit 1
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'epic-parallel-dispatch.cjs');
const EPIC_STATE = path.resolve(__dirname, '..', 'epic-state.cjs');

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
    throw new Error(
      `${msg}\n  Expected: ${JSON.stringify(expected)}\n  Actual:   ${JSON.stringify(actual)}`,
    );
  }
}

function assertContains(actual, substr, msg = '') {
  if (typeof actual !== 'string' || !actual.includes(substr)) {
    throw new Error(
      `${msg}\n  Expected to contain: ${JSON.stringify(substr)}\n  Actual: ${JSON.stringify(actual)}`,
    );
  }
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function epicState(args) {
  return spawnSync(process.execPath, [EPIC_STATE, ...args], { encoding: 'utf8' });
}

/** Write a child plan.md (+ optional phase file). */
function writePlan(epicDir, dir, status, blockedBy, title) {
  const d = path.join(epicDir, dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, 'plan.md'),
    `---\ntitle: "${title || dir}"\nstatus: ${status}\nblockedBy: [${blockedBy.join(', ')}]\n---\n# ${dir}\n`,
  );
  fs.writeFileSync(path.join(d, 'phase-01-x.md'), '---\nphase: 1\n---\n# Phase 1\n');
}

/** Build a parallel epic fixture: foundation completed, 2 workers, 1 merge. */
function parallelEpic() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-dispatch-'));
  epicState(['init', tmp, '--execution-mode', 'parallel']);
  writePlan(tmp, 'plan-01-foundation', 'completed', [], 'Foundation');
  writePlan(tmp, 'plan-02-users', 'pending', ['plan-01-foundation'], 'Users API');
  writePlan(tmp, 'plan-03-orders', 'pending', ['plan-01-foundation'], 'Orders API');
  writePlan(tmp, 'plan-99-merge', 'pending', ['plan-02-users', 'plan-03-orders'], 'Merge');
  return tmp;
}

// ---------------------------------------------------------------------------

test('1. parallel epic → one dispatch block per ready worker', () => {
  const tmp = parallelEpic();
  try {
    const r = run([tmp]);
    assertEquals(r.status, 0, 'exit code');
    assertContains(r.stdout, 'Worker 1/2', 'first worker block');
    assertContains(r.stdout, 'Worker 2/2', 'second worker block');
    assertContains(r.stdout, 'plan-02-users', 'worker 02 named');
    assertContains(r.stdout, 'plan-03-orders', 'worker 03 named');
    assertEquals(r.stdout.includes('plan-99-merge'), false, 'merge not dispatched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('2. block has worktree branch, abs cook path, --worker, done-marker trailer', () => {
  const tmp = parallelEpic();
  try {
    const epicId = path.basename(tmp);
    const r = run([tmp]);
    assertContains(r.stdout, `/worktree create epic/${epicId}/plan-02-users`, 'branch convention');
    assertContains(r.stdout, `--epic ${path.resolve(tmp)} --worker`, 'cook --worker with abs epic');
    assertContains(r.stdout, path.join(path.resolve(tmp), 'plan-02-users'), 'abs plan path');
    assertContains(r.stdout, 'Epic-Plan-Done: plan-02-users', 'done-marker trailer reminder');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('3. sequential epic → warns, no worker blocks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-dispatch-seq-'));
  try {
    epicState(['init', tmp, '--execution-mode', 'sequential']);
    writePlan(tmp, 'plan-01-a', 'completed', [], 'A');
    writePlan(tmp, 'plan-02-b', 'pending', ['plan-01-a'], 'B');
    const r = run([tmp]);
    assertEquals(r.status, 0, 'exit code');
    assertContains(r.stdout, 'không phải parallel', 'warns sequential');
    assertEquals(r.stdout.includes('Worker 1'), false, 'no worker block');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('4. no ready worker (foundation pending) → no-ready-plan message', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-dispatch-none-'));
  try {
    epicState(['init', tmp, '--execution-mode', 'parallel']);
    writePlan(tmp, 'plan-01-foundation', 'in-progress', [], 'Foundation');
    writePlan(tmp, 'plan-02-users', 'pending', ['plan-01-foundation'], 'Users');
    const r = run([tmp]);
    assertEquals(r.status, 0, 'exit code');
    assertContains(r.stdout, 'no-ready-plan', 'no ready worker message');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('5. missing epic-dir → exit 1', () => {
  const r = run([path.join(os.tmpdir(), 'does-not-exist-epic-xyz')]);
  assertEquals(r.status, 1, 'exit 1 on missing dir');
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
