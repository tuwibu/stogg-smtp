#!/usr/bin/env node
/**
 * epic-state.cjs — Epic container state manager for the /plan epic subcommand.
 *
 * State file: <epic-dir>/epic-state.json
 * Index file: <epic-dir>/epic.md  (human-readable markdown, flat frontmatter only)
 *
 * Commands:
 *   init <epic-dir> [--detail-mode sequential|upfront] [--execution-mode sequential|parallel]
 *                          Create epic-state.json + scaffold epic.md, status=draft.
 *                          detailMode + executionMode default to "sequential" (classify-first: skill
 *                          passes the chosen mode in; no separate set-mode command).
 *   rollup <epic-dir>      Scan plan-NN-* children, aggregate status, refresh epic.md table.
 *                          Preserves detailMode + executionMode from prior state.
 *   next <epic-dir>        Print dir of next READY-TO-COOK plan (pending + all blockedBy completed).
 *                          Tie-break: fewest phase files first. Prints "no-ready-plan" if none.
 *   ready-set <epic-dir>   Print EVERY ready-to-cook plan (fan-out primitive for parallel epics),
 *                          one dir per line. Prints "no-ready-plan" if none.
 *   next-to-detail <epic-dir>
 *                          Print dirs of stub plans (0 phase files) READY-TO-DETAIL, one per line.
 *                          upfront → all stubs; sequential → stubs whose blockedBy are completed.
 *                          Prints "no-plan-to-detail" if none.
 *   check <epic-dir>       Print {status, totalPlans, readyPlans, plansToDetail, detailMode,
 *                          executionMode, isComplete} JSON to stdout.
 *
 * Exit codes:
 *   0 = OK (or fail-open on malformed state)
 *   1 = bad args / write failure
 *
 * Fail-open: corrupt epic-state.json or malformed child plan.md → treat as no-state,
 * continue gracefully. Mirrors cook-state.cjs philosophy.
 *
 * Self-contained: no shared lib imports. JSON via JSON.parse; frontmatter via flat key:value
 * parse (reuses validate-kit.cjs lines 47-60 pattern).
 *
 * Contract: .agents/skills/plan/references/epic-workflow.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = 'epic-state.json';
const INDEX_FILE = 'epic.md';
const DETAIL_MODES = ['sequential', 'upfront'];
const DEFAULT_DETAIL_MODE = 'sequential';
const EXECUTION_MODES = ['sequential', 'parallel'];
const DEFAULT_EXECUTION_MODE = 'sequential';

/** Coerce any value to a valid detail mode; unknown/empty → sequential (safe default). */
function normalizeDetailMode(v) {
  return DETAIL_MODES.includes(v) ? v : DEFAULT_DETAIL_MODE;
}

/** Coerce any value to a valid execution mode; unknown/empty → sequential (safe default). */
function normalizeExecutionMode(v) {
  return EXECUTION_MODES.includes(v) ? v : DEFAULT_EXECUTION_MODE;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg) {
  process.stderr.write(`epic-state: ${msg}\n`);
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

function statePath(epicDir) {
  return path.join(path.resolve(epicDir), STATE_FILE);
}

function indexPath(epicDir) {
  return path.join(path.resolve(epicDir), INDEX_FILE);
}

function readState(epicDir) {
  const p = statePath(epicDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function writeState(epicDir, state) {
  const p = statePath(epicDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/**
 * Minimal flat frontmatter parser — mirrors validate-kit.cjs lines 47-60.
 * Returns null if no frontmatter block found.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const val = line.slice(sep + 1).trim();
    if (key) fm[key] = val;
  }
  return fm;
}

/**
 * Parse blockedBy from flat frontmatter value.
 * Handles: "[]", "[plan-01, plan-02]", "plan-01" (bare string).
 * Returns string[].
 */
function parseBlockedBy(raw) {
  if (!raw || raw === '[]') return [];
  // Strip surrounding brackets if present
  const inner = raw.replace(/^\[|\]$/g, '').trim();
  if (!inner) return [];
  return inner.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Scan epic-dir for plan-NN-* child directories that contain plan.md.
 * Returns array of { dir (basename), absDir, planMdPath }.
 */
function scanChildPlans(epicDir) {
  const abs = path.resolve(epicDir);
  if (!fs.existsSync(abs)) return [];
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && /^plan-\d+/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => ({
      dir: e.name,
      absDir: path.join(abs, e.name),
      planMdPath: path.join(abs, e.name, 'plan.md'),
    }))
    .filter(c => fs.existsSync(c.planMdPath));
}

/**
 * Read child plan.md and extract { status, blockedBy }.
 * Fail-open: returns { status: 'unknown', blockedBy: [] } on any error.
 */
function readChildPlan(planMdPath) {
  try {
    const content = fs.readFileSync(planMdPath, 'utf8');
    const fm = parseFrontmatter(content);
    if (!fm) return { status: 'unknown', blockedBy: [] };
    return {
      status: fm.status || 'unknown',
      blockedBy: parseBlockedBy(fm.blockedBy || ''),
    };
  } catch (_) {
    return { status: 'unknown', blockedBy: [] };
  }
}

/** Count phase files (phase-*.md) in a plan dir to compute blast radius. */
function countPhaseFiles(planAbsDir) {
  try {
    return fs.readdirSync(planAbsDir).filter(f => /^phase-.*\.md$/.test(f)).length;
  } catch (_) {
    return 0;
  }
}

/**
 * Derive epic status from child plan statuses.
 * - all completed → passed
 * - any blocked → blocked
 * - any in-progress/pending → running
 * - else → draft
 */
function deriveEpicStatus(plans) {
  if (plans.length === 0) return 'draft';
  const statuses = plans.map(p => p.status);
  if (statuses.every(s => s === 'completed')) return 'passed';
  if (statuses.some(s => s === 'blocked')) return 'blocked';
  if (statuses.some(s => s === 'in-progress' || s === 'pending')) return 'running';
  return 'draft';
}

/** Build the epic.md content (human-readable index, flat frontmatter only). */
function buildEpicMd(epicDir, epicId, plans, epicStatus) {
  const now = nowIso().slice(0, 10);
  const rows = plans.length === 0
    ? '| — | (no child plans found) | — | — |\n'
    : plans.map((p, i) => {
        const num = String(i + 1).padStart(2, '0');
        const blockedByStr = p.blockedBy.length ? p.blockedBy.join(', ') : '—';
        return `| ${num} | [${p.dir}](${p.dir}/plan.md) | ${p.status} | ${blockedByStr} |`;
      }).join('\n') + '\n';

  return `---
status: ${epicStatus}
created: ${now}
---

# Epic: ${epicId}

## Child Plans

| # | Plan | Status | Blocked By |
|---|------|--------|-----------|
${rows}
`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdInit(epicDir, detailMode, executionMode) {
  const abs = path.resolve(epicDir);
  fs.mkdirSync(abs, { recursive: true });

  const epicId = path.basename(abs);
  const state = {
    epicId,
    plans: [],
    status: 'draft',
    detailMode: normalizeDetailMode(detailMode),
    executionMode: normalizeExecutionMode(executionMode),
    createdAt: nowIso(),
    lastUpdated: nowIso(),
  };
  writeState(epicDir, state);

  // Scaffold epic.md only if it doesn't exist (preserve existing human edits)
  const mdPath = indexPath(epicDir);
  if (!fs.existsSync(mdPath)) {
    fs.writeFileSync(mdPath, buildEpicMd(epicDir, epicId, [], 'draft'), 'utf8');
  }

  process.stdout.write(
    `initialized epic "${epicId}" (detailMode=${state.detailMode}, ` +
      `executionMode=${state.executionMode}) at ${statePath(epicDir)}\n`,
  );
}

function cmdRollup(epicDir) {
  const children = scanChildPlans(epicDir);
  const plans = children.map(c => {
    const { status, blockedBy } = readChildPlan(c.planMdPath);
    return { dir: c.dir, status, blockedBy };
  });

  const epicStatus = deriveEpicStatus(plans);
  const prev = readState(epicDir);
  const epicId = prev?.epicId || path.basename(path.resolve(epicDir));

  const state = {
    epicId,
    plans,
    status: epicStatus,
    detailMode: normalizeDetailMode(prev?.detailMode),
    executionMode: normalizeExecutionMode(prev?.executionMode),
    createdAt: prev?.createdAt || nowIso(),
    lastUpdated: nowIso(),
  };
  writeState(epicDir, state);

  // Refresh epic.md — machine-managed index, fully regenerated on every rollup.
  // Human notes belong in child plan-NN-*/plan.md, NOT in epic.md (see epic-workflow.md).
  const mdPath = indexPath(epicDir);
  fs.writeFileSync(mdPath, buildEpicMd(epicDir, epicId, plans, epicStatus), 'utf8');

  process.stdout.write(`rollup: ${plans.length} plans, status=${epicStatus}\n`);
}

/**
 * Compute ALL ready-to-cook plans (pending AND all blockedBy completed).
 * Returns array of { dir, absDir } in plan-NN order. Shared by `next` (tie-break
 * to one) and `ready-set` (return the whole wave) — DRY.
 */
function computeReadyPlans(epicDir) {
  const children = scanChildPlans(epicDir);
  if (children.length === 0) return [];

  const statusMap = {};
  const planData = children.map(c => {
    const { status, blockedBy } = readChildPlan(c.planMdPath);
    statusMap[c.dir] = status;
    return { dir: c.dir, absDir: c.absDir, status, blockedBy };
  });

  return planData.filter(p => {
    if (p.status !== 'pending') return false;
    return p.blockedBy.every(dep => statusMap[dep] === 'completed');
  });
}

function cmdNext(epicDir) {
  const ready = computeReadyPlans(epicDir);
  if (ready.length === 0) {
    process.stdout.write('no-ready-plan\n');
    return;
  }

  // Tie-break: fewest phase files (blast radius)
  ready.sort((a, b) => countPhaseFiles(a.absDir) - countPhaseFiles(b.absDir));

  process.stdout.write(ready[0].dir + '\n');
}

/**
 * Print EVERY ready-to-cook plan, one dir per line, in plan-NN order.
 * The fan-out primitive for parallel epics: after foundation completes, the whole
 * worker wave becomes ready at once. Prints "no-ready-plan" (exit 0) when none.
 */
function cmdReadySet(epicDir) {
  const ready = computeReadyPlans(epicDir);
  if (ready.length === 0) {
    process.stdout.write('no-ready-plan\n');
    return;
  }
  process.stdout.write(ready.map(p => p.dir).join('\n') + '\n');
}

/**
 * Filter pre-scanned plans down to stubs READY TO DETAIL, per detailMode.
 * Stub = plan dir with 0 phase-*.md files (not yet detailed) — detection is
 * status-independent; `blockedBy` completion is the only sequential gate.
 * - upfront: every stub (all children can be detailed immediately).
 * - sequential: stubs whose blockedBy are all completed (need upstream OUTPUT first).
 * Pure over (planData, statusMap, detailMode) so cmdCheck can reuse one scan.
 */
function filterStubsToDetail(planData, statusMap, detailMode) {
  const stubs = planData.filter(p => countPhaseFiles(p.absDir) === 0);
  if (detailMode === 'upfront') return stubs.map(p => p.dir);
  return stubs
    .filter(p => p.blockedBy.every(dep => statusMap[dep] === 'completed'))
    .map(p => p.dir);
}

/**
 * Compute stub dirs ready to DETAIL for an epic (scans children once).
 * Returns array of dir names in plan-NN order (deterministic).
 */
function computeStubsToDetail(epicDir) {
  const children = scanChildPlans(epicDir);
  if (children.length === 0) return [];

  const statusMap = {};
  const planData = children.map(c => {
    const { status, blockedBy } = readChildPlan(c.planMdPath);
    statusMap[c.dir] = status;
    return { dir: c.dir, absDir: c.absDir, status, blockedBy };
  });

  const detailMode = normalizeDetailMode(readState(epicDir)?.detailMode);
  return filterStubsToDetail(planData, statusMap, detailMode);
}

function cmdNextToDetail(epicDir) {
  const dirs = computeStubsToDetail(epicDir);
  if (dirs.length === 0) {
    process.stdout.write('no-plan-to-detail\n');
    return;
  }
  process.stdout.write(dirs.join('\n') + '\n');
}

function cmdCheck(epicDir) {
  // Fail-open: always derive from LIVE children (never trust stale epic-state.json),
  // so `status` and `isComplete` cannot disagree. Read each child once.
  const children = scanChildPlans(epicDir);
  const statusMap = {};
  const planData = children.map(c => {
    const { status, blockedBy } = readChildPlan(c.planMdPath);
    statusMap[c.dir] = status;
    return { dir: c.dir, absDir: c.absDir, status, blockedBy };
  });
  // Second pass: isReady needs the fully-built statusMap (forward deps), no re-read.
  planData.forEach(p => {
    p.isReady = p.status === 'pending' && p.blockedBy.every(dep => statusMap[dep] === 'completed');
  });

  const readyPlans = planData.filter(p => p.isReady).length;

  const epicStatus = deriveEpicStatus(planData.map(p => ({ status: p.status })));

  const isComplete = planData.length > 0 && planData.every(p => p.status === 'completed');

  const prevState = readState(epicDir);
  const detailMode = normalizeDetailMode(prevState?.detailMode);
  const executionMode = normalizeExecutionMode(prevState?.executionMode);
  const plansToDetail = filterStubsToDetail(planData, statusMap, detailMode).length;

  process.stdout.write(
    JSON.stringify({
      status: epicStatus,
      totalPlans: planData.length,
      readyPlans,
      plansToDetail,
      detailMode,
      executionMode,
      isComplete,
    }) + '\n',
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/** Parse `--detail-mode <value>` from an argv tail; returns undefined if absent. */
function parseDetailModeFlag(argv) {
  const i = argv.indexOf('--detail-mode');
  return i !== -1 ? argv[i + 1] : undefined;
}

/** Parse `--execution-mode <value>` from an argv tail; returns undefined if absent. */
function parseExecutionModeFlag(argv) {
  const i = argv.indexOf('--execution-mode');
  return i !== -1 ? argv[i + 1] : undefined;
}

function main() {
  const [, , cmd, epicDir] = process.argv;
  if (!cmd || !epicDir) {
    process.stderr.write(
      'usage: epic-state.cjs <init|rollup|next|ready-set|next-to-detail|check> <epic-dir> ' +
        '[--detail-mode sequential|upfront] [--execution-mode sequential|parallel]\n',
    );
    process.exit(1);
  }
  switch (cmd) {
    case 'init': {
      const tail = process.argv.slice(4);
      return cmdInit(epicDir, parseDetailModeFlag(tail), parseExecutionModeFlag(tail));
    }
    case 'rollup':
      return cmdRollup(epicDir);
    case 'next':
      return cmdNext(epicDir);
    case 'ready-set':
      return cmdReadySet(epicDir);
    case 'next-to-detail':
      return cmdNextToDetail(epicDir);
    case 'check':
      return cmdCheck(epicDir);
    default:
      die(`unknown command "${cmd}"`);
  }
}

try {
  main();
} catch (e) {
  die(e && e.message ? e.message : String(e));
}
