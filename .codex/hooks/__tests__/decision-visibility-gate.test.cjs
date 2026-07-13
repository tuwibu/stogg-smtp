/**
 * E2E tests for decision-visibility-gate.cjs hook entry (TDD red step — hook does not exist yet)
 * Run: node .codex/hooks/__tests__/decision-visibility-gate.test.cjs
 *
 * Covers Test Spec cases 9–12 from:
 *   plans/260610-1614-decision-visibility-gate/phase-02-gate-hook-classify-check-block.md
 *
 * Hook stdin shape (PreToolUse on AskUserQuestion):
 *   { tool_name, tool_input: { questions, ... }, transcript_path? }
 *
 * Hook reads mode via: getHookOption('decision-visibility-gate', 'mode', 'strict')
 * Config location: <cwd>/.codex/.ck.json → hooks['decision-visibility-gate']
 *
 * Exit codes:
 *   0 → allowed / fail-open
 *   2 → blocked (decision options not presented in visible text)
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.resolve(__dirname, '..', 'decision-visibility-gate.cjs');

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

function assertContains(actual, substr, msg = '') {
  if (typeof actual !== 'string' || !actual.includes(substr)) {
    throw new Error(`${msg}\n  Expected to contain: ${JSON.stringify(substr)}\n  Actual: ${JSON.stringify(actual)}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Spawn hook with JSON payload piped to stdin, run from given cwd. */
function runHook(payload, cwd) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    cwd: cwd || process.cwd(),
  });
}

/** Write a minimal transcript JSONL file with one visible assistant turn then an AskUserQuestion tool_use. */
function writeTempTranscript(entries) {
  const filePath = path.join(
    os.tmpdir(),
    `dvg-test-transcript-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`
  );
  const lines = entries.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(filePath, lines, 'utf8');
  return filePath;
}

function userMsg(text) {
  return { type: 'user', message: { content: [{ type: 'text', text }] } };
}

function assistantMsg(...blocks) {
  return { type: 'assistant', message: { content: blocks } };
}

function textBlock(text) { return { type: 'text', text }; }
function toolUseBlock(name) { return { type: 'tool_use', name, id: 'tu_1', input: {} }; }

/**
 * Create a temp project dir with .codex/.ck.json.
 * hooksConfig is the value for the `hooks` key.
 * Returns { dir, cleanup }.
 */
function makeTempProject(hooksConfig) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvg-test-proj-'));
  const codexDir = path.join(dir, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  const config = { hooks: hooksConfig };
  fs.writeFileSync(path.join(codexDir, '.ck.json'), JSON.stringify(config), 'utf8');
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** Named-alternative options that must trigger the gate. */
function blockingOptions() {
  return [
    { label: 'A — Models-only codegen (Recommended)', description: 'Generate only models from spec' },
    { label: 'B — Full client codegen', description: 'Generate full HTTP client' },
    { label: 'C — Drift-check only', description: 'Compare spec against existing code' },
  ];
}

// ---------------------------------------------------------------------------
// Case 9: No transcript_path / missing file → exit 0 (fail-open)
// ---------------------------------------------------------------------------
console.log('\n=== Case 9: Missing / absent transcript_path → fail-open exit 0 ===\n');

test('case 9a: transcript_path absent from payload → exit 0', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });
  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Choose approach',
          options: blockingOptions(),
        }],
      },
      // no transcript_path
    };
    const result = runHook(payload, dir);
    assertEquals(result.status, 0, 'missing transcript_path must exit 0 (fail-open)');
  } finally {
    cleanup();
  }
});

test('case 9b: transcript_path points to non-existent file → exit 0', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });
  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Choose approach',
          options: blockingOptions(),
        }],
      },
      transcript_path: path.join(os.tmpdir(), 'dvg-nonexistent-' + Date.now() + '.jsonl'),
    };
    const result = runHook(payload, dir);
    assertEquals(result.status, 0, 'non-existent transcript must exit 0 (fail-open)');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Case 10: Malformed stdin JSON → exit 0
// ---------------------------------------------------------------------------
console.log('\n=== Case 10: Malformed stdin JSON → exit 0 ===\n');

test('case 10a: completely invalid JSON → exit 0', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });
  try {
    const result = spawnSync(process.execPath, [HOOK], {
      input: 'NOT VALID JSON AT ALL {{{',
      encoding: 'utf8',
      cwd: dir,
    });
    assertEquals(result.status, 0, 'malformed stdin must exit 0 (fail-open)');
  } finally {
    cleanup();
  }
});

test('case 10b: empty stdin → exit 0', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });
  try {
    const result = spawnSync(process.execPath, [HOOK], {
      input: '',
      encoding: 'utf8',
      cwd: dir,
    });
    assertEquals(result.status, 0, 'empty stdin must exit 0 (fail-open)');
  } finally {
    cleanup();
  }
});

test('case 10c: stdin is valid JSON but missing tool_input → exit 0', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });
  try {
    const result = runHook({ tool_name: 'AskUserQuestion' }, dir);
    assertEquals(result.status, 0, 'missing tool_input must exit 0 (fail-open)');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Case 11: Hook disabled via config → exit 0
// ---------------------------------------------------------------------------
console.log('\n=== Case 11: Hook disabled via config → exit 0 ===\n');

test('case 11a: hooks["decision-visibility-gate"] = false → exit 0', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': false });
  const transcriptPath = writeTempTranscript([
    userMsg('Pick an approach'),
    assistantMsg(
      // NO visible text — intentionally empty to ensure gate would block if enabled
      toolUseBlock('AskUserQuestion')
    ),
  ]);
  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Choose approach',
          options: blockingOptions(),
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    assertEquals(result.status, 0, 'disabled hook must exit 0 regardless of content');
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    cleanup();
  }
});

test('case 11b: no config file at all → gate active by default (blocking scenario exits 2)', () => {
  // The hook is default-enabled like every other hook; absence of config must NOT
  // silently disable enforcement — that was the gap that let black-box prompts ship.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvg-no-config-'));
  const transcriptPath = writeTempTranscript([
    userMsg('Pick something'),
    assistantMsg(toolUseBlock('AskUserQuestion')),
  ]);
  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Choose',
          options: blockingOptions(),
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    assertEquals(result.status, 2, 'default-enabled gate must block when options are not visible');
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Case 12: Full block path → exit 2 + stderr contains rule path and missing labels
// ---------------------------------------------------------------------------
console.log('\n=== Case 12: Full block — exit 2 + stderr with rule path + missing labels ===\n');

test('case 12: decision options not in visible text → exit 2', () => {
  // Hook enabled, strict mode (default)
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });

  // Transcript: assistant turn has NO visible text before the AskUserQuestion call
  const transcriptPath = writeTempTranscript([
    userMsg('Please decide on an architecture approach'),
    assistantMsg(
      // thinking block only — nothing visible
      { type: 'thinking', thinking: 'I am picking an approach silently' },
      toolUseBlock('AskUserQuestion')
    ),
  ]);

  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture Choice',
          question: 'Which approach?',
          options: blockingOptions(),
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    assertEquals(result.status, 2, 'hook must exit 2 when options not presented in visible text');
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    cleanup();
  }
});

test('case 12: stderr contains rule file path', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });
  const transcriptPath = writeTempTranscript([
    userMsg('Pick approach'),
    assistantMsg(
      { type: 'thinking', thinking: 'silent decision' },
      toolUseBlock('AskUserQuestion')
    ),
  ]);
  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Which?',
          options: blockingOptions(),
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    assertContains(
      result.stderr,
      '.claude/rules/decision-prompt-visibility.md',
      'stderr must contain the rule file path'
    );
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    cleanup();
  }
});

test('case 12: stderr contains missing label name-parts', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });
  const transcriptPath = writeTempTranscript([
    userMsg('Pick approach'),
    assistantMsg(
      { type: 'thinking', thinking: 'silent' },
      toolUseBlock('AskUserQuestion')
    ),
  ]);
  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Which?',
          options: blockingOptions(),
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    // At minimum one of the missing labels must appear in stderr
    const hasMissingLabel = (
      result.stderr.includes('A — Models-only codegen') ||
      result.stderr.includes('B — Full client codegen') ||
      result.stderr.includes('C — Drift-check only')
    );
    if (!hasMissingLabel) {
      throw new Error(
        `stderr must contain at least one missing label\nstderr: ${result.stderr}`
      );
    }
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    cleanup();
  }
});

test('case 12: minimal mode config honored — long visible text passes', () => {
  // When mode = 'minimal' and visible text >= 100 chars, hook must exit 0
  const { dir, cleanup } = makeTempProject({
    'decision-visibility-gate': { mode: 'minimal' },
  });

  const longVisibleText = 'Đây là nội dung mô tả rất chi tiết về các phương án. '.repeat(5); // > 100 chars

  const transcriptPath = writeTempTranscript([
    userMsg('Pick one'),
    assistantMsg(
      textBlock(longVisibleText),
      toolUseBlock('AskUserQuestion')
    ),
  ]);
  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Which?',
          options: blockingOptions(),
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    assertEquals(result.status, 0, 'minimal mode with long visible text must exit 0');
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Case 13 (spec 10): ballot with desc >= 40 chars/option + transcript with only user msg
//   (zero assistant text blocks) → exit 0 (tool_input pass)
// ---------------------------------------------------------------------------
console.log('\n=== Case 13 (spec 10): rich descriptions, no assistant text → exit 0 ===\n');

/** Options where every desc >= 40 chars — no transcript text needed. */
function richDescOptions() {
  return [
    { label: 'A — Models-only codegen (Recommended)', description: 'Generate only models from the OpenAPI spec, ignoring services' },
    { label: 'B — Full client codegen', description: 'Generate full HTTP client with both models and service classes' },
    { label: 'C — Drift-check only', description: 'Compare existing code against the spec and produce a diff report' },
  ];
}

test('spec 10: ballot desc >= 40 per option, transcript has user msg but zero assistant text → exit 0', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });

  // Transcript: one user message only — no assistant text blocks at all
  const transcriptPath = writeTempTranscript([
    userMsg('Please choose an architecture approach'),
  ]);

  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Which approach?',
          options: richDescOptions(),
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    assertEquals(result.status, 0, 'rich descriptions must pass (tool_input pass) even with zero assistant text in transcript');
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Case 14 (spec 11): short desc + no preview + same zero-text transcript → exit 2
//   stderr must contain "description" and "preview"
// ---------------------------------------------------------------------------
console.log('\n=== Case 14 (spec 11): short desc, no preview, no assistant text → exit 2 ===\n');

test('spec 11: short desc, no preview, zero assistant text → exit 2', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });

  const transcriptPath = writeTempTranscript([
    userMsg('Please choose an architecture approach'),
  ]);

  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Which approach?',
          options: blockingOptions(),  // short descriptions (< 40 chars), no preview
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    assertEquals(result.status, 2, 'short desc + no preview + empty transcript must exit 2');
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    cleanup();
  }
});

test('spec 11: stderr contains "description" when blocked', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });

  const transcriptPath = writeTempTranscript([
    userMsg('Please choose an architecture approach'),
  ]);

  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Which approach?',
          options: blockingOptions(),
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    assertContains(result.stderr, 'description', 'stderr must contain "description"');
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    cleanup();
  }
});

test('spec 11: stderr contains "preview" when blocked', () => {
  const { dir, cleanup } = makeTempProject({ 'decision-visibility-gate': true });

  const transcriptPath = writeTempTranscript([
    userMsg('Please choose an architecture approach'),
  ]);

  try {
    const payload = {
      tool_name: 'AskUserQuestion',
      tool_input: {
        questions: [{
          header: 'Architecture',
          question: 'Which approach?',
          options: blockingOptions(),
        }],
      },
      transcript_path: transcriptPath,
    };
    const result = runHook(payload, dir);
    assertContains(result.stderr, 'preview', 'stderr must contain "preview"');
  } finally {
    try { fs.unlinkSync(transcriptPath); } catch (e) {}
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n=== Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
  process.exitCode = 1;
}
