#!/usr/bin/env node
/**
 * PostToolUse hook: after Write/Edit/MultiEdit, run incremental typecheck on the
 * written file and warn (fail-soft) if errors are found.
 *
 * Supported checkers:
 *   .ts/.tsx  → tsc --noEmit (nearest tsconfig.json, incremental preferred)
 *   .py       → mypy or pyright (whichever is on PATH)
 *   .go       → go vet ./... scoped to the module dir (nearest go.mod)
 *
 * Fail-soft: always exits 0. Warnings printed to stderr.
 * Missing tool → silent skip.
 * No nearby config (tsconfig/go.mod/mypy config) → silent skip (latency guard).
 * Bypass: CK_TYPECHECK_DISABLED=1 or .ck.json hooks['post-write-typecheck']=false
 */

'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { isHookEnabled } = require('./lib/ck-config-utils.cjs');

const HOOK_NAME = 'post-write-typecheck';
const MAX_WALK_DEPTH = 10;
const CHECKER_TIMEOUT_MS = 15000;

// ---- stdin parse ----

function readPayload() {
  try {
    const raw = fs.readFileSync(0, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ---- path extraction from tool_input ----

/**
 * Extract the primary written file path from the hook event.
 * Handles Write (file_path), Edit (file_path), MultiEdit (edits[0].file_path).
 */
function extractFilePath(payload) {
  const ti = payload?.tool_input || {};
  // Write / Edit
  if (ti.file_path) return String(ti.file_path);
  // MultiEdit
  if (Array.isArray(ti.edits) && ti.edits.length > 0) {
    const first = ti.edits[0];
    if (first?.file_path) return String(first.file_path);
  }
  return null;
}

// ---- config/tool walk helpers ----

/**
 * Walk directories upward from startDir, up to MAX_WALK_DEPTH levels,
 * returning the first directory containing filename, or null.
 */
function findNearest(startDir, filename) {
  let dir = startDir;
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    if (fs.existsSync(path.join(dir, filename))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

/**
 * Return true if a command is on PATH by attempting a --version probe.
 */
function commandExists(cmd) {
  // spawnSync does NOT throw on ENOENT — it returns { error } with status null.
  // Probe and treat any spawn error (missing binary / timeout) as "not available"
  // so the latency guard's silent-skip path actually fires.
  const r = spawnSync(cmd, ['--version'], { stdio: 'ignore', timeout: 2000, windowsHide: true });
  return !r.error;
}

// ---- checkers ----

function warn(msg) {
  process.stderr.write(`[post-write-typecheck] WARNING: ${msg}\n`);
}

/**
 * TypeScript: find nearest tsconfig, run tsc --noEmit on the specific file.
 * Uses --incremental when a tsconfig that already has composite/incremental set is found;
 * otherwise falls back to --noEmit only on the single file for speed.
 */
function checkTypeScript(filePath) {
  const dir = path.dirname(filePath);
  const tsconfigDir = findNearest(dir, 'tsconfig.json');
  if (!tsconfigDir) return; // latency guard: no config nearby

  if (!commandExists('tsc')) return; // silent skip if tsc missing

  // Run tsc --noEmit; scope to project by cwd=tsconfigDir so it picks up tsconfig.json
  // Pass the file path relative to tsconfigDir for single-file scope where possible.
  const relFile = path.relative(tsconfigDir, filePath);

  const result = spawnSync(
    'tsc',
    ['--noEmit', '--pretty', 'false'],
    {
      cwd: tsconfigDir,
      encoding: 'utf8',
      timeout: CHECKER_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );

  if (result.status !== 0) {
    const output = (result.stdout || '') + (result.stderr || '');
    // Filter lines relevant to the written file to reduce noise.
    const lines = output.split('\n').filter(l => {
      // Keep lines mentioning the file or lines that are error summaries.
      return l.includes(relFile) || l.includes(path.basename(filePath)) ||
             /error TS\d+/.test(l) || /Found \d+ error/.test(l);
    });
    const relevant = lines.length ? lines.join('\n') : output.trim();
    if (relevant.trim()) {
      warn(`TypeScript errors in ${filePath}:\n${relevant.trim()}`);
    }
  }
}

/**
 * Python: try mypy first, then pyright. Runs on the specific file only.
 */
function checkPython(filePath) {
  const dir = path.dirname(filePath);

  // Latency guard: only run if a mypy.ini / setup.cfg / pyproject.toml / .mypy.ini exists
  const configFiles = ['mypy.ini', '.mypy.ini', 'pyproject.toml', 'setup.cfg', 'pyrightconfig.json'];
  const hasConfig = configFiles.some(f => findNearest(dir, f) !== null);
  if (!hasConfig) return;

  // Try mypy first
  if (commandExists('mypy')) {
    const result = spawnSync('mypy', [filePath, '--no-error-summary'], {
      encoding: 'utf8',
      timeout: CHECKER_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0) {
      const output = (result.stdout || result.stderr || '').trim();
      if (output) warn(`mypy errors in ${filePath}:\n${output}`);
    }
    return;
  }

  // Fall back to pyright
  if (commandExists('pyright')) {
    const result = spawnSync('pyright', [filePath], {
      encoding: 'utf8',
      timeout: CHECKER_TIMEOUT_MS,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    if (result.status !== 0) {
      const output = (result.stdout || result.stderr || '').trim();
      if (output) warn(`pyright errors in ${filePath}:\n${output}`);
    }
    return;
  }

  // Neither installed — silent skip
}

/**
 * Go: find nearest go.mod, run `go vet ./...` in that directory.
 */
function checkGo(filePath) {
  const dir = path.dirname(filePath);
  const modDir = findNearest(dir, 'go.mod');
  if (!modDir) return; // latency guard

  if (!commandExists('go')) return; // silent skip

  const result = spawnSync('go', ['vet', './...'], {
    cwd: modDir,
    encoding: 'utf8',
    timeout: CHECKER_TIMEOUT_MS,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.status !== 0) {
    const output = (result.stderr || result.stdout || '').trim();
    if (output) warn(`go vet errors (module: ${modDir}):\n${output}`);
  }
}

// ---- dispatch ----

const EXTENSION_MAP = {
  '.ts': checkTypeScript,
  '.tsx': checkTypeScript,
  '.py': checkPython,
  '.go': checkGo,
};

function main() {
  // Bypass env var (mirrors simplify-gate pattern)
  if (process.env.CK_TYPECHECK_DISABLED === '1') process.exit(0);

  // Bypass via .ck.json
  if (!isHookEnabled(HOOK_NAME)) process.exit(0);

  const payload = readPayload();
  const filePath = extractFilePath(payload);
  if (!filePath) process.exit(0);

  const ext = path.extname(filePath).toLowerCase();
  const checker = EXTENSION_MAP[ext];
  if (!checker) process.exit(0); // unsupported extension — skip

  try {
    checker(filePath);
  } catch {
    // Fail-soft: any unexpected error in the hook → silent skip, never block workflow
  }

  process.exit(0);
}

main();
