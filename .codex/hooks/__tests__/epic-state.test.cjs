/**
 * Tests for epic-state.cjs — spawned via child_process (mirrors cook-state.test.cjs).
 * Run: node .codex/hooks/__tests__/epic-state.test.cjs
 *
 * Scenarios (per phase-02 spec):
 * 1. init creates epic-state.json + epic.md, status=draft
 * 2. rollup reflects child plan statuses in epic-state.json
 * 3. next returns plan with no blockers first (plan-01); after plan-01 completed → plan-02
 * 4. next returns no-ready-plan when no plan is ready, exit 0
 * 5. child plan.md frontmatter malformed → fail-open, check does not crash
 * 6. corrupt epic-state.json → fail-open (like cook-state pattern)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'epic-state.cjs');
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

/** Run epic-state.cjs with given args. */
function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

/** Copy fixture epic into a fresh tmp dir so tests are isolated. */
function tmpEpicDir() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-state-test-'));
  copyDir(FIXTURE_DIR, tmp);
  return tmp;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test('1. init creates epic-state.json and epic.md with status=draft', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-init-test-'));
  try {
    const r = run(['init', tmp]);
    assertEquals(r.status, 0, 'exit code');

    const stateFile = path.join(tmp, 'epic-state.json');
    const epicMd = path.join(tmp, 'epic.md');

    assertEquals(fs.existsSync(stateFile), true, 'epic-state.json exists');
    assertEquals(fs.existsSync(epicMd), true, 'epic.md exists');

    const state = readJson(stateFile);
    assertEquals(state.status, 'draft', 'status=draft');
    assertEquals(Array.isArray(state.plans), true, 'plans is array');
    assertEquals(state.detailMode, 'sequential', 'default detailMode=sequential');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('2. rollup reflects child plan statuses in epic-state.json', () => {
  const tmp = tmpEpicDir();
  try {
    // plan-01: completed, plan-02: pending, plan-03: pending
    const r = run(['rollup', tmp]);
    assertEquals(r.status, 0, 'exit code');

    const state = readJson(path.join(tmp, 'epic-state.json'));
    assertEquals(Array.isArray(state.plans), true, 'plans array');

    const plan01 = state.plans.find(p => p.dir.includes('plan-01-foundation'));
    const plan02 = state.plans.find(p => p.dir.includes('plan-02-feature'));
    assertEquals(plan01 !== undefined, true, 'plan-01 in state');
    assertEquals(plan02 !== undefined, true, 'plan-02 in state');
    assertEquals(plan01.status, 'completed', 'plan-01 status=completed');
    assertEquals(plan02.status, 'pending', 'plan-02 status=pending');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('3a. next with no blockers (plan-01 pending, no blockedBy) returns plan-01', () => {
  // Create fresh epic with plan-01 pending and no blockers, plan-02 blocked by plan-01
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-next-test-'));
  try {
    fs.mkdirSync(path.join(tmp, 'plan-01-foundation'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'plan-01-foundation', 'plan.md'),
      '---\nstatus: pending\nblockedBy: []\n---\n# Plan 01\n',
    );
    fs.mkdirSync(path.join(tmp, 'plan-02-feature'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'plan-02-feature', 'plan.md'),
      '---\nstatus: pending\nblockedBy: [plan-01-foundation]\n---\n# Plan 02\n',
    );

    const r = run(['next', tmp]);
    assertEquals(r.status, 0, 'exit code');
    assertContains(r.stdout, 'plan-01-foundation', 'returns plan-01');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('3b. next after plan-01 completed returns plan-02 (blockedBy satisfied)', () => {
  // plan-01: completed, plan-02: pending, blockedBy plan-01
  const tmp = tmpEpicDir();
  try {
    // plan-01 is already completed in fixture
    const r = run(['next', tmp]);
    assertEquals(r.status, 0, 'exit code');
    assertContains(r.stdout, 'plan-02-feature', 'returns plan-02 when plan-01 completed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('4. next returns no-ready-plan when all plans are blocked/completed, exit 0', () => {
  // All pending plans have unsatisfied blockers
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-noready-test-'));
  try {
    fs.mkdirSync(path.join(tmp, 'plan-01-base'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'plan-01-base', 'plan.md'),
      '---\nstatus: pending\nblockedBy: [plan-02-other]\n---\n# Plan 01\n',
    );
    fs.mkdirSync(path.join(tmp, 'plan-02-other'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'plan-02-other', 'plan.md'),
      '---\nstatus: pending\nblockedBy: [plan-01-base]\n---\n# Plan 02\n',
    );

    const r = run(['next', tmp]);
    assertEquals(r.status, 0, 'exit code — fail-open');
    assertContains(r.stdout, 'no-ready-plan', 'prints no-ready-plan');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('5. malformed child plan.md frontmatter → fail-open, check does not crash', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-malformed-test-'));
  try {
    fs.mkdirSync(path.join(tmp, 'plan-01-bad'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'plan-01-bad', 'plan.md'),
      'not frontmatter at all\njust random text\n',
    );

    const r = run(['check', tmp]);
    assertEquals(r.status, 0, 'exit code — no crash');
    // Should return valid JSON
    const out = JSON.parse(r.stdout);
    assertEquals(typeof out.status, 'string', 'status is string');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('6. corrupt epic-state.json → fail-open (like cook-state pattern)', () => {
  const tmp = tmpEpicDir();
  try {
    fs.writeFileSync(path.join(tmp, 'epic-state.json'), '{ invalid json {{', 'utf8');
    const r = run(['check', tmp]);
    assertEquals(r.status, 0, 'exit code — no crash on corrupt state');
    const out = JSON.parse(r.stdout);
    assertEquals(typeof out.status, 'string', 'returns valid JSON with status field');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenarios — detailMode + next-to-detail
// ---------------------------------------------------------------------------

/** Write a child plan.md (+ optional phase file to mark it "detailed"). */
function writePlan(epicDir, dir, status, blockedBy, withPhase) {
  const d = path.join(epicDir, dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(
    path.join(d, 'plan.md'),
    `---\nstatus: ${status}\nblockedBy: [${blockedBy.join(', ')}]\n---\n# ${dir}\n`,
  );
  if (withPhase) {
    fs.writeFileSync(path.join(d, 'phase-01-x.md'), '---\nphase: 1\n---\n# Phase 1\n');
  }
}

test('7. init --detail-mode upfront sets detailMode=upfront', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-dm-up-'));
  try {
    assertEquals(run(['init', tmp, '--detail-mode', 'upfront']).status, 0, 'exit code');
    assertEquals(readJson(path.join(tmp, 'epic-state.json')).detailMode, 'upfront', 'detailMode');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('8. init without flag defaults detailMode=sequential', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-dm-def-'));
  try {
    run(['init', tmp]);
    assertEquals(readJson(path.join(tmp, 'epic-state.json')).detailMode, 'sequential', 'default');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('9. init --detail-mode bogus → fallback sequential', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-dm-bog-'));
  try {
    run(['init', tmp, '--detail-mode', 'banana']);
    assertEquals(readJson(path.join(tmp, 'epic-state.json')).detailMode, 'sequential', 'fallback');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('10. rollup preserves detailMode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-dm-roll-'));
  try {
    run(['init', tmp, '--detail-mode', 'upfront']);
    writePlan(tmp, 'plan-01-a', 'pending', [], false);
    run(['rollup', tmp]);
    assertEquals(readJson(path.join(tmp, 'epic-state.json')).detailMode, 'upfront', 'preserved');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('11. next-to-detail upfront returns all stubs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-ntd-up-'));
  try {
    run(['init', tmp, '--detail-mode', 'upfront']);
    writePlan(tmp, 'plan-01-a', 'pending', [], false);
    writePlan(tmp, 'plan-02-b', 'pending', ['plan-01-a'], false);
    writePlan(tmp, 'plan-03-c', 'pending', ['plan-02-b'], false);
    const r = run(['next-to-detail', tmp]);
    assertEquals(r.status, 0, 'exit code');
    const lines = r.stdout.trim().split('\n');
    assertEquals(lines.length, 3, 'all 3 stubs');
    assertContains(r.stdout, 'plan-03-c', 'includes blocked stub in upfront');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('12. next-to-detail sequential gates on blockedBy completion', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-ntd-seq-'));
  try {
    run(['init', tmp, '--detail-mode', 'sequential']);
    writePlan(tmp, 'plan-01-a', 'completed', [], true); // detailed + completed
    writePlan(tmp, 'plan-02-b', 'pending', ['plan-01-a'], false); // stub, dep done → ready
    writePlan(tmp, 'plan-03-c', 'pending', ['plan-02-b'], false); // stub, dep pending → not ready
    const r = run(['next-to-detail', tmp]);
    assertEquals(r.status, 0, 'exit code');
    assertContains(r.stdout, 'plan-02-b', 'plan-02 ready to detail');
    assertEquals(r.stdout.includes('plan-03-c'), false, 'plan-03 not ready (dep pending)');
    assertEquals(r.stdout.includes('plan-01-a'), false, 'plan-01 not a stub (has phase file)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('13. next-to-detail excludes already-detailed plans', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-ntd-det-'));
  try {
    run(['init', tmp, '--detail-mode', 'upfront']);
    writePlan(tmp, 'plan-01-a', 'pending', [], true); // has phase file → not stub
    const r = run(['next-to-detail', tmp]);
    assertContains(r.stdout, 'no-plan-to-detail', 'no stub left');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('14. check exposes detailMode + plansToDetail', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-chk-dm-'));
  try {
    run(['init', tmp, '--detail-mode', 'upfront']);
    writePlan(tmp, 'plan-01-a', 'pending', [], false);
    const out = JSON.parse(run(['check', tmp]).stdout);
    assertEquals(out.detailMode, 'upfront', 'detailMode in check');
    assertEquals(out.plansToDetail, 1, 'plansToDetail count');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Scenarios — executionMode + ready-set (parallel epic)
// ---------------------------------------------------------------------------

test('15. init --execution-mode parallel sets executionMode=parallel', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-em-par-'));
  try {
    assertEquals(run(['init', tmp, '--execution-mode', 'parallel']).status, 0, 'exit code');
    assertEquals(
      readJson(path.join(tmp, 'epic-state.json')).executionMode,
      'parallel',
      'executionMode',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('16. init without flag defaults executionMode=sequential', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-em-def-'));
  try {
    run(['init', tmp]);
    assertEquals(
      readJson(path.join(tmp, 'epic-state.json')).executionMode,
      'sequential',
      'default',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('17. init --execution-mode bogus → fallback sequential', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-em-bog-'));
  try {
    run(['init', tmp, '--execution-mode', 'banana']);
    assertEquals(
      readJson(path.join(tmp, 'epic-state.json')).executionMode,
      'sequential',
      'fallback',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('18. rollup preserves executionMode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-em-roll-'));
  try {
    run(['init', tmp, '--execution-mode', 'parallel']);
    writePlan(tmp, 'plan-01-a', 'pending', [], false);
    run(['rollup', tmp]);
    assertEquals(
      readJson(path.join(tmp, 'epic-state.json')).executionMode,
      'parallel',
      'preserved',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('19. check exposes executionMode', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-em-chk-'));
  try {
    run(['init', tmp, '--execution-mode', 'parallel']);
    writePlan(tmp, 'plan-01-a', 'pending', [], false);
    const out = JSON.parse(run(['check', tmp]).stdout);
    assertEquals(out.executionMode, 'parallel', 'executionMode in check');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('20. ready-set returns the whole worker wave after foundation completed', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-rs-wave-'));
  try {
    run(['init', tmp, '--execution-mode', 'parallel']);
    writePlan(tmp, 'plan-01-foundation', 'completed', [], true);
    writePlan(tmp, 'plan-02-users', 'pending', ['plan-01-foundation'], true);
    writePlan(tmp, 'plan-03-orders', 'pending', ['plan-01-foundation'], true);
    writePlan(tmp, 'plan-99-merge', 'pending', ['plan-02-users', 'plan-03-orders'], true);
    const r = run(['ready-set', tmp]);
    assertEquals(r.status, 0, 'exit code');
    const lines = r.stdout.trim().split('\n');
    assertEquals(lines.length, 2, 'both workers ready');
    assertContains(r.stdout, 'plan-02-users', 'worker 02 ready');
    assertContains(r.stdout, 'plan-03-orders', 'worker 03 ready');
    assertEquals(r.stdout.includes('plan-99-merge'), false, 'merge not ready (workers pending)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('21. ready-set prints no-ready-plan when nothing ready (foundation pending)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-rs-none-'));
  try {
    run(['init', tmp, '--execution-mode', 'parallel']);
    writePlan(tmp, 'plan-01-foundation', 'in-progress', [], true);
    writePlan(tmp, 'plan-02-users', 'pending', ['plan-01-foundation'], true);
    const r = run(['ready-set', tmp]);
    assertEquals(r.status, 0, 'exit code — fail-open');
    assertContains(r.stdout, 'no-ready-plan', 'no ready plan');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('22. next tie-break unchanged after computeReadyPlans refactor (regression)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'epic-next-reg-'));
  try {
    run(['init', tmp]);
    // two ready plans; plan-03 has fewer phase files → wins tie-break
    writePlan(tmp, 'plan-02-big', 'pending', [], true);
    fs.writeFileSync(
      path.join(tmp, 'plan-02-big', 'phase-02-y.md'),
      '---\nphase: 2\n---\n# Phase 2\n',
    );
    writePlan(tmp, 'plan-03-small', 'pending', [], true);
    const r = run(['next', tmp]);
    assertContains(r.stdout, 'plan-03-small', 'fewest phase files wins');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
