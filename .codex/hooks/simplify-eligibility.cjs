#!/usr/bin/env node
/**
 * simplify-eligibility.cjs — Decide whether to offer /simplify in the chain.
 *
 * Reads .codex/.ck.json -> workflow.simplifyThreshold:
 *   { "maxLoc": 30, "maxFiles": 2 }
 * If git diff HEAD --shortstat shows changes <= both thresholds, simplify is
 * skipped (small change, not worth the round-trip).
 *
 * Output (stdout, always exit 0):
 *   {"eligible": true|false, "reason": "...", "stats": {"files": N, "loc": M}}
 *
 * Fail-open: any error (no git, no repo, parse fail) -> eligible=true so the
 * chain behaves normally.
 *
 * Contract: .codex/rules/workflow-chaining.md (Conditional Skills -> simplify gate)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DEFAULT_MAX_LOC = 30;
const DEFAULT_MAX_FILES = 2;

function readConfig() {
  const root = process.env.CODEX_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const cfgPath = path.join(root, '.codex', '.ck.json');
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(raw);
    const t = (cfg.workflow && cfg.workflow.simplifyThreshold) || {};
    return {
      maxLoc: Number.isFinite(t.maxLoc) ? t.maxLoc : DEFAULT_MAX_LOC,
      maxFiles: Number.isFinite(t.maxFiles) ? t.maxFiles : DEFAULT_MAX_FILES,
    };
  } catch {
    return { maxLoc: DEFAULT_MAX_LOC, maxFiles: DEFAULT_MAX_FILES };
  }
}

function getDiffStats() {
  const out = execSync('git diff HEAD --shortstat', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (!out) return { files: 0, loc: 0 };
  const fileMatch = out.match(/(\d+)\s+files?\s+changed/);
  const insMatch = out.match(/(\d+)\s+insertions?/);
  const delMatch = out.match(/(\d+)\s+deletions?/);
  const files = fileMatch ? parseInt(fileMatch[1], 10) : 0;
  const ins = insMatch ? parseInt(insMatch[1], 10) : 0;
  const del = delMatch ? parseInt(delMatch[1], 10) : 0;
  return { files, loc: ins + del };
}

function main() {
  const { maxLoc, maxFiles } = readConfig();
  let stats;
  try {
    stats = getDiffStats();
  } catch {
    process.stdout.write(JSON.stringify({
      eligible: true,
      reason: 'git diff unavailable (fail-open)',
      stats: { files: 0, loc: 0 },
    }) + '\n');
    process.exit(0);
  }

  if (stats.files === 0 && stats.loc === 0) {
    process.stdout.write(JSON.stringify({
      eligible: false,
      reason: 'no uncommitted changes detected',
      stats,
    }) + '\n');
    process.exit(0);
  }

  const tooSmall = stats.files <= maxFiles && stats.loc <= maxLoc;
  if (tooSmall) {
    process.stdout.write(JSON.stringify({
      eligible: false,
      reason: `changes too small (${stats.files} files / ${stats.loc} LOC <= ${maxFiles}/${maxLoc})`,
      stats,
    }) + '\n');
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({
    eligible: true,
    reason: `${stats.files} files / ${stats.loc} LOC exceeds threshold`,
    stats,
  }) + '\n');
  process.exit(0);
}

main();
