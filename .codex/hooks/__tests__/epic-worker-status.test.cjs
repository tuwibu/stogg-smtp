/**
 * Tests for epic-worker-status.cjs — uses a REAL temp git repo (deterministic, no mock).
 * Run: node .codex/hooks/__tests__/epic-worker-status.test.cjs
 *
 * Scenarios:
 * 1. all workers have done-marker trailer → allDone true, missing empty
 * 2. one worker missing branch → allDone false, listed in missing
 * 3. branch exists but no trailer → done false
 * 4. merge plan is not counted as a worker
 * 5. no workers (topology has no foundation) → allDone false
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'epic-worker-status.cjs');

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

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function git(repo, args) {
  return spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
}

/** Create a temp git repo with an initial commit; returns repo path. */
function initRepo() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'ews-repo-'));
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 't@t.io']);
  git(repo, ['config', 'user.name', 'Test']);
  git(repo, ['config', 'commit.gpgsign', 'false']);
  fs.writeFileSync(path.join(repo, 'README.md'), '# base\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'base']);
  return repo;
}

/** Create a branch and (optionally) a done-marker commit for a worker dir. */
function makeWorkerBranch(repo, epicId, dir, withMarker) {
  const branch = `epic/${epicId}/${dir}`;
  git(repo, ['branch', branch]);
  if (withMarker) {
    git(repo, ['checkout', '-q', branch]);
    git(repo, [
      'commit', '--allow-empty', '-q',
      '-m', `chore(epic): mark ${dir} done`,
      '-m', `Epic-Plan-Done: ${dir}`,
    ]);
    git(repo, ['checkout', '-q', 'master']);
    // some git defaults to 'main'
    const cur = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim();
    if (cur !== 'master') git(repo, ['checkout', '-q', '-']);
  }
}

/** Write epic children (plan.md with blockedBy) inside a plans/<epic> dir of repo. */
function writeEpic(repo, epicId, specs) {
  const epicDir = path.join(repo, 'plans', epicId);
  fs.mkdirSync(epicDir, { recursive: true });
  for (const s of specs) {
    const d = path.join(epicDir, s.dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(
      path.join(d, 'plan.md'),
      `---\nstatus: pending\nblockedBy: [${s.blockedBy.join(', ')}]\n---\n# ${s.dir}\n`,
    );
  }
  return epicDir;
}

const CANON = [
  { dir: 'plan-01-foundation', blockedBy: [] },
  { dir: 'plan-02-users', blockedBy: ['plan-01-foundation'] },
  { dir: 'plan-03-orders', blockedBy: ['plan-01-foundation'] },
  { dir: 'plan-99-merge', blockedBy: ['plan-02-users', 'plan-03-orders'] },
];

// ---------------------------------------------------------------------------

test('1. all workers done → allDone true, missing empty', () => {
  const repo = initRepo();
  try {
    const epicId = 'ep1';
    const epicDir = writeEpic(repo, epicId, CANON);
    makeWorkerBranch(repo, epicId, 'plan-02-users', true);
    makeWorkerBranch(repo, epicId, 'plan-03-orders', true);
    const out = JSON.parse(run([epicDir, '--git-dir', repo]).stdout);
    assertEquals(out.allDone, true, 'allDone');
    assertEquals(out.missing.length, 0, 'no missing');
    assertEquals(out.workers.length, 2, 'two workers');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('2. one worker missing branch → allDone false, in missing', () => {
  const repo = initRepo();
  try {
    const epicId = 'ep2';
    const epicDir = writeEpic(repo, epicId, CANON);
    makeWorkerBranch(repo, epicId, 'plan-02-users', true);
    // plan-03 has no branch at all
    const out = JSON.parse(run([epicDir, '--git-dir', repo]).stdout);
    assertEquals(out.allDone, false, 'not all done');
    assertEquals(out.missing.includes('plan-03-orders'), true, 'orders missing');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('3. branch exists but no trailer → done false', () => {
  const repo = initRepo();
  try {
    const epicId = 'ep3';
    const epicDir = writeEpic(repo, epicId, CANON);
    makeWorkerBranch(repo, epicId, 'plan-02-users', true);
    makeWorkerBranch(repo, epicId, 'plan-03-orders', false); // branch, no marker
    const out = JSON.parse(run([epicDir, '--git-dir', repo]).stdout);
    const orders = out.workers.find(w => w.dir === 'plan-03-orders');
    assertEquals(orders.done, false, 'no trailer → not done');
    assertEquals(out.allDone, false, 'not all done');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('4. merge plan is not counted as a worker', () => {
  const repo = initRepo();
  try {
    const epicId = 'ep4';
    const epicDir = writeEpic(repo, epicId, CANON);
    makeWorkerBranch(repo, epicId, 'plan-02-users', true);
    makeWorkerBranch(repo, epicId, 'plan-03-orders', true);
    const out = JSON.parse(run([epicDir, '--git-dir', repo]).stdout);
    assertEquals(out.workers.some(w => w.dir === 'plan-99-merge'), false, 'merge excluded');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('5. no foundation → no workers, allDone false', () => {
  const repo = initRepo();
  try {
    const epicId = 'ep5';
    const epicDir = writeEpic(repo, epicId, [
      { dir: 'plan-01-a', blockedBy: ['plan-02-b'] },
      { dir: 'plan-02-b', blockedBy: ['plan-01-a'] },
    ]);
    const out = JSON.parse(run([epicDir, '--git-dir', repo]).stdout);
    assertEquals(out.workers.length, 0, 'no workers derived');
    assertEquals(out.allDone, false, 'allDone false when no workers');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
