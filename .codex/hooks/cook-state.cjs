#!/usr/bin/env node
/**
 * cook-state.cjs — Multi-phase plan progress tracker for the /cook skill.
 *
 * State file: <plan-dir>/.cook-state.json
 *
 * Commands:
 *   init <plan-dir> <total>           Create state, status=in-progress.
 *   update <plan-dir> <phase-name>    Mark a phase done.
 *   check <plan-dir>                  Print {status, done, total, isComplete} JSON to stdout.
 *   finalize <plan-dir>               Set status=complete.
 *
 * Exit codes:
 *   0 = OK (or fail-open: missing/corrupt state on `check`)
 *   1 = command error (bad args, write failure, etc.)
 *
 * Fail-open philosophy: missing state file on `check` returns
 *   {"status":"no-state","done":0,"total":0,"isComplete":true}
 * so callers treat "no plan context" the same as "completed" and proceed
 * with normal workflow-chain logic. Cook should only call `check` when
 * it KNOWS it ran with a plan-dir.
 *
 * Contract: .codex/rules/phase-completion-gate.md
 */

'use strict';

const fs = require('fs');
const path = require('path');

const STATE_FILE = '.cook-state.json';

function die(msg) {
  process.stderr.write(`cook-state: ${msg}\n`);
  process.exit(1);
}

function statePath(planDir) {
  return path.join(path.resolve(planDir), STATE_FILE);
}

function readState(planDir) {
  const p = statePath(planDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

function writeState(planDir, state) {
  const p = statePath(planDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

function cmdInit(planDir, totalRaw, epicDir) {
  const total = parseInt(totalRaw, 10);
  if (!Number.isFinite(total) || total < 1) die(`init: invalid total "${totalRaw}"`);
  if (!fs.existsSync(path.resolve(planDir))) die(`init: plan-dir does not exist: ${planDir}`);
  const state = {
    totalPhases: total,
    completedPhases: 0,
    status: 'in-progress',
    currentPhase: null,
    completedPhaseNames: [],
    // Set when this plan is a child of an epic (--epic <epic-dir>). Lets cook
    // detect the epic-boundary path on completion (snapshot + stop, no chain).
    epicDir: epicDir || null,
    lastUpdated: nowIso(),
  };
  writeState(planDir, state);
  process.stdout.write(`initialized ${total} phases at ${statePath(planDir)}\n`);
}

function cmdUpdate(planDir, phaseName) {
  if (!phaseName) die('update: missing <phase-name>');
  const state = readState(planDir);
  if (!state) die(`update: no state at ${statePath(planDir)} — run init first`);
  if (state.status === 'complete') die('update: state already complete — cannot update');
  if (!state.completedPhaseNames.includes(phaseName)) {
    state.completedPhaseNames.push(phaseName);
    state.completedPhases = state.completedPhaseNames.length;
  }
  state.currentPhase = null;
  state.lastUpdated = nowIso();
  writeState(planDir, state);
  process.stdout.write(`${state.completedPhases}/${state.totalPhases} phases done\n`);
}

function cmdCheck(planDir) {
  const state = readState(planDir);
  if (!state) {
    process.stdout.write(
      JSON.stringify({ status: 'no-state', done: 0, total: 0, isComplete: true }) + '\n',
    );
    return;
  }
  const isComplete =
    state.status === 'complete' || state.completedPhases >= state.totalPhases;
  process.stdout.write(
    JSON.stringify({
      status: state.status,
      done: state.completedPhases,
      total: state.totalPhases,
      isComplete,
      epicDir: state.epicDir || null,
    }) + '\n',
  );
}

function cmdFinalize(planDir) {
  const state = readState(planDir);
  if (!state) die(`finalize: no state at ${statePath(planDir)}`);
  state.status = 'complete';
  state.currentPhase = null;
  state.lastUpdated = nowIso();
  writeState(planDir, state);
  process.stdout.write(`finalized: ${state.completedPhases}/${state.totalPhases}\n`);
}

/** Extract `--epic <dir>` from argv; returns the value or null. */
function parseEpicFlag(argv) {
  const i = argv.indexOf('--epic');
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
}

function main() {
  const argv = process.argv.slice(2);
  // Positional args, skipping any --flag and its value so flags can appear anywhere.
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--epic') { i++; continue; }
    positional.push(argv[i]);
  }
  const [cmd, planDir, arg] = positional;
  if (!cmd || !planDir) {
    process.stderr.write(
      'usage: cook-state.cjs <init|update|check|finalize> <plan-dir> [arg] [--epic <epic-dir>]\n',
    );
    process.exit(1);
  }
  switch (cmd) {
    case 'init':
      return cmdInit(planDir, arg, parseEpicFlag(argv));
    case 'update':
      return cmdUpdate(planDir, arg);
    case 'check':
      return cmdCheck(planDir);
    case 'finalize':
      return cmdFinalize(planDir);
    default:
      die(`unknown command "${cmd}"`);
  }
}

try {
  main();
} catch (e) {
  die(e && e.message ? e.message : String(e));
}
