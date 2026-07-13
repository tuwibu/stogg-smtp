#!/usr/bin/env node
/**
 * epic-parallel-dispatch.cjs — Fan-out prompt generator for PARALLEL epics.
 *
 * Usage:
 *   node epic-parallel-dispatch.cjs <epic-dir>
 *
 * After the foundation plan of a parallel epic is cooked, the main tab runs this to
 * emit one copy-paste block PER ready worker plan. The user opens N fresh chats and
 * pastes one block each — every worker cooks on its own git worktree + branch, in
 * parallel. This is the "many prompts" half of the fan-out/fan-in model.
 *
 * What it does (SINGLE-MACHINE, solo):
 *   - reads executionMode via `epic-state.cjs check` (only meaningful for parallel),
 *   - reads the ready worker wave via `epic-state.cjs ready-set`,
 *   - for each worker prints: /worktree create + /cook --worker + absolute plan path
 *     + a reminder to end with the `Epic-Plan-Done: <dir>` commit trailer.
 *
 * It only GENERATES TEXT — it never creates worktrees, branches, or commits. The user
 * drives those by pasting the emitted `/worktree` + `/cook` commands into worker chats.
 *
 * Branch convention (must match epic-worker-status.cjs + cook worker mode):
 *   epic/<epicId>/<plan-dir>
 * Done-marker (must match epic-worker-status.cjs):
 *   commit trailer  Epic-Plan-Done: <plan-dir>
 *
 * Exit codes: 0 = OK / fail-open; 1 = bad args.
 *
 * Contract: .agents/skills/plan/references/epic-workflow.md → "Execution Mode".
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const EPIC_STATE = path.resolve(__dirname, 'epic-state.cjs');
// Anchor to project root (hooks live at <root>/.codex/hooks/) so emitted absolute
// paths are stable regardless of CWD.
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function die(msg) {
  process.stderr.write(`epic-parallel-dispatch: ${msg}\n`);
  process.exit(1);
}

/** Run epic-state.cjs and return trimmed stdout ('' on failure). */
function epicState(args) {
  const r = spawnSync(process.execPath, [EPIC_STATE, ...args], { encoding: 'utf8' });
  if (r.status !== 0) return '';
  return (r.stdout || '').trim();
}

/** Read executionMode from `check` JSON; defaults to 'sequential' on any error. */
function getExecutionMode(epicDir) {
  try {
    return JSON.parse(epicState(['check', epicDir])).executionMode || 'sequential';
  } catch (_) {
    return 'sequential';
  }
}

/** Return ready worker dirs (array); [] when none / no-ready-plan. */
function getReadySet(epicDir) {
  const out = epicState(['ready-set', epicDir]);
  if (!out || out === 'no-ready-plan') return [];
  return out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

/** Minimal flat-frontmatter title + first summary line from a worker plan.md. */
function readWorkerSummary(epicDir, dir) {
  try {
    const content = fs.readFileSync(path.join(epicDir, dir, 'plan.md'), 'utf8');
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    let title = dir;
    if (fm) {
      const m = fm[1].match(/^title:\s*(.+)$/m);
      if (m) title = m[1].trim().replace(/^["']|["']$/g, '');
    }
    return title;
  } catch (_) {
    return dir;
  }
}

function buildDispatch(epicDir, epicId, workers) {
  const absEpic = path.resolve(epicDir);
  const lines = [
    `# Parallel dispatch — epic ${epicId}`,
    '',
    `> Foundation đã cook xong. Mở ${workers.length} chat mới, mỗi chat dán 1 block bên dưới.`,
    '> Mỗi worker chạy trên worktree + branch riêng, SONG SONG. Xong hết → quay lại chat chính chạy merge plan.',
    '',
    '## Checklist worker',
    ...workers.map(d => `- [ ] ${d}`),
    '',
  ];

  workers.forEach((dir, i) => {
    const title = readWorkerSummary(epicDir, dir);
    const branch = `epic/${epicId}/${dir}`;
    const absPlan = path.join(absEpic, dir);
    lines.push(
      `## Worker ${i + 1}/${workers.length}: ${dir}`,
      `_${title}_`,
      '',
      '```',
      `/worktree create ${branch}`,
      `/cook ${absPlan}/ --epic ${absEpic} --worker`,
      '```',
      '',
      `- Phase files đọc qua đường dẫn tuyệt đối trên (không copy sang worktree).`,
      `- Khi cook xong, commit cuối PHẢI có trailer: \`Epic-Plan-Done: ${dir}\` (cook --worker tự thêm).`,
      '',
    );
  });

  return lines.join('\n');
}

function main() {
  const epicDir = process.argv[2];
  if (!epicDir) {
    process.stderr.write('usage: epic-parallel-dispatch.cjs <epic-dir>\n');
    process.exit(1);
  }
  if (!fs.existsSync(path.resolve(epicDir))) die(`epic-dir does not exist: ${epicDir}`);

  const epicId = path.basename(path.resolve(epicDir));
  const mode = getExecutionMode(epicDir);
  if (mode !== 'parallel') {
    process.stdout.write(
      `epic "${epicId}" là executionMode=${mode}, không phải parallel.\n` +
        'Dùng resume-snapshot.cjs cho epic sequential.\n',
    );
    return;
  }

  const workers = getReadySet(epicDir);
  if (workers.length === 0) {
    process.stdout.write(
      'no-ready-plan — chưa có worker nào sẵn sàng. ' +
        'Foundation đã cook + rollup chưa? (epic-state.cjs rollup)\n',
    );
    return;
  }

  process.stdout.write(buildDispatch(epicDir, epicId, workers) + '\n');
}

try {
  main();
} catch (e) {
  die(e && e.message ? e.message : String(e));
}
