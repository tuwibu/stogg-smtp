#!/usr/bin/env node
/**
 * epic-worker-status.cjs — Fan-in gate for PARALLEL epics.
 *
 * Usage:
 *   node epic-worker-status.cjs <epic-dir> [--git-dir <repo>]
 *
 * The main tab runs this before cooking the merge plan. It scans LOCAL git refs to
 * learn which worker plans have finished, using two conventions written by the
 * dispatch generator + `cook --worker`:
 *   - branch:      epic/<epicId>/<plan-dir>
 *   - done-marker: a commit whose message carries the trailer  Epic-Plan-Done: <plan-dir>
 *
 * Worker roles are derived from the epic's blockedBy TOPOLOGY (no new frontmatter field):
 *   - foundation: blockedBy == []
 *   - worker:     blockedBy includes the foundation dir
 *   - merge:      blockedBy has >=2 entries, none of which is the foundation
 * Only WORKERS are gated here (they carry done-markers).
 *
 * Output (stdout, JSON):
 *   { workers: [{dir, branch, done}], allDone: bool, missing: [dir, ...] }
 *
 * Fail-open: missing branch / no git / unreadable plan → that worker done:false
 * (never crash). Single-machine, local refs only — no fetch.
 *
 * Exit codes: 0 = OK / fail-open; 1 = bad args.
 *
 * Contract: .agents/skills/plan/references/epic-workflow.md → "Execution Mode".
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function die(msg) {
  process.stderr.write(`epic-worker-status: ${msg}\n`);
  process.exit(1);
}

/** Run git in the given repo; returns { status, stdout } with '' on spawn failure. */
function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  return { status: r.status == null ? 1 : r.status, stdout: (r.stdout || '').trim() };
}

/** Minimal flat-frontmatter parse of a child plan.md → { blockedBy: string[] }. */
function readBlockedBy(planMdPath) {
  try {
    const content = fs.readFileSync(planMdPath, 'utf8');
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return [];
    const m = fm[1].match(/^blockedBy:\s*(.+)$/m);
    if (!m) return [];
    const inner = m[1].trim().replace(/^\[|\]$/g, '').trim();
    if (!inner) return [];
    return inner.split(',').map(s => s.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

/** Scan plan-NN-* children of the epic. Returns [{ dir, blockedBy }]. */
function scanChildren(epicDir) {
  const abs = path.resolve(epicDir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^plan-\d+/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => ({ dir: e.name, blockedBy: readBlockedBy(path.join(abs, e.name, 'plan.md')) }))
    .filter(c => fs.existsSync(path.join(abs, c.dir, 'plan.md')));
}

/** Derive worker dirs from topology: blockedBy includes the foundation dir. */
function deriveWorkers(children) {
  const foundation = children.find(c => c.blockedBy.length === 0);
  if (!foundation) return [];
  return children
    .filter(c => c.blockedBy.includes(foundation.dir))
    .map(c => c.dir);
}

/** True if branch exists AND carries the Epic-Plan-Done trailer for dir. */
function isWorkerDone(repo, branch, dir) {
  const exists = git(repo, ['rev-parse', '--verify', '--quiet', branch]);
  if (exists.status !== 0 || !exists.stdout) return false;
  // Search the branch history for the done-marker trailer line.
  const log = git(repo, ['log', branch, '--grep', `Epic-Plan-Done: ${dir}`, '--format=%H', '-n', '1']);
  return log.status === 0 && log.stdout.length > 0;
}

function parseGitDirFlag(argv) {
  const i = argv.indexOf('--git-dir');
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

function main() {
  const argv = process.argv.slice(2);
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--git-dir') { i++; continue; }
    if (argv[i].startsWith('--')) continue;
    positional.push(argv[i]);
  }
  const epicDir = positional[0];
  if (!epicDir) {
    process.stderr.write('usage: epic-worker-status.cjs <epic-dir> [--git-dir <repo>]\n');
    process.exit(1);
  }
  if (!fs.existsSync(path.resolve(epicDir))) die(`epic-dir does not exist: ${epicDir}`);

  const repo = path.resolve(parseGitDirFlag(argv) || PROJECT_ROOT);
  const epicId = path.basename(path.resolve(epicDir));
  const workerDirs = deriveWorkers(scanChildren(epicDir));

  const workers = workerDirs.map(dir => {
    const branch = `epic/${epicId}/${dir}`;
    return { dir, branch, done: isWorkerDone(repo, branch, dir) };
  });

  const missing = workers.filter(w => !w.done).map(w => w.dir);
  const allDone = workers.length > 0 && missing.length === 0;

  process.stdout.write(JSON.stringify({ workers, allDone, missing }) + '\n');
}

try {
  main();
} catch (e) {
  die(e && e.message ? e.message : String(e));
}
