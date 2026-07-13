/**
 * Tests for transcript-visible-text.cjs (TDD red step — module does not exist yet)
 * Run: node .claude/hooks/lib/__tests__/transcript-visible-text.test.cjs
 *
 * Transcript JSONL shape (Claude Code sessions):
 *   { type: 'user'|'assistant', message: { content: [ {type:'text'|'thinking'|'tool_use'|'tool_result', ...} ] } }
 *   user entries whose content is solely tool_result blocks are NOT real turn boundaries.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { extractCurrentTurnVisibleText } = require('../transcript-visible-text.cjs');

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
    throw new Error(`${msg}\n  Expected: ${JSON.stringify(expected)}\n  Actual: ${JSON.stringify(actual)}`);
  }
}

function assertContains(actual, substr, msg = '') {
  if (typeof actual !== 'string' || !actual.includes(substr)) {
    throw new Error(`${msg}\n  Expected string containing: ${JSON.stringify(substr)}\n  Actual: ${JSON.stringify(actual)}`);
  }
}

/** Write JSONL lines to a temp file, return path. */
function writeTempTranscript(entries) {
  const filePath = path.join(os.tmpdir(), `ck-test-transcript-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
  const lines = entries.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(filePath, lines, 'utf8');
  return filePath;
}

/** Build a user entry with real content (text blocks etc.) */
function userMsg(...contentBlocks) {
  return { type: 'user', message: { content: contentBlocks } };
}

/** Build a user entry whose content is ONLY tool_result blocks (machine-generated, not a real turn boundary). */
function toolResultUserMsg(...toolResultBlocks) {
  return { type: 'user', message: { content: toolResultBlocks } };
}

function assistantMsg(...contentBlocks) {
  return { type: 'assistant', message: { content: contentBlocks } };
}

function textBlock(text) { return { type: 'text', text }; }
function thinkingBlock(thinking) { return { type: 'thinking', thinking }; }
function toolUseBlock(name) { return { type: 'tool_use', name, id: 'tu_1', input: {} }; }
function toolResultBlock(toolUseId, content) {
  return { type: 'tool_result', tool_use_id: toolUseId || 'tu_1', content };
}

// ---------------------------------------------------------------------------

console.log('\n=== Case 1: Normal turn — thinking + tool_use + tool_result + visible text ===\n');

test('case 1: returns visible text block, skips thinking/tool_use', () => {
  const transcript = [
    userMsg(textBlock('What is your plan?')),
    assistantMsg(
      thinkingBlock('internal reasoning here'),
      toolUseBlock('Bash'),
      textBlock('Phương án A — đây là kế hoạch chi tiết')
    ),
    toolResultUserMsg(toolResultBlock('tu_1', 'output')),
    assistantMsg(
      toolUseBlock('AskUserQuestion'),
    )
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(result.found, true, 'found should be true');
    assertContains(result.text, 'Phương án A', 'text should contain visible assistant text');
    // must NOT include thinking content
    assertEquals(result.text.includes('internal reasoning'), false, 'should not include thinking');
  } finally {
    fs.unlinkSync(p);
  }
});

test('case 1: text property is a string', () => {
  const transcript = [
    userMsg(textBlock('Hello')),
    assistantMsg(textBlock('World'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(typeof result.text, 'string', 'text must be a string');
  } finally {
    fs.unlinkSync(p);
  }
});

// ---------------------------------------------------------------------------

console.log('\n=== Case 2: Turn ends with only thinking — zero visible text (screenshot bug case) ===\n');

test('case 2: turn located but no visible text → { text: "", found: true }', () => {
  const transcript = [
    userMsg(textBlock('Decide something')),
    assistantMsg(
      thinkingBlock('I am thinking deeply but not saying anything visible')
    )
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(result.found, true, 'found should be true — turn was located');
    assertEquals(result.text, '', 'text should be empty — only thinking, no visible text');
  } finally {
    fs.unlinkSync(p);
  }
});

// ---------------------------------------------------------------------------

console.log('\n=== Case 3: tool_result user-role entries do NOT reset the turn boundary ===\n');

test('case 3: text printed before a tool_result in the same turn still counts', () => {
  const transcript = [
    userMsg(textBlock('Run this')),
    assistantMsg(
      textBlock('Here is what I found:'),
      toolUseBlock('Read')
    ),
    toolResultUserMsg(toolResultBlock('tu_1', 'file content')),
    assistantMsg(
      textBlock(' — summary of results')
    )
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(result.found, true);
    assertContains(result.text, 'Here is what I found:', 'pre-tool text should be included');
    assertContains(result.text, 'summary of results', 'post-tool text should also be included');
  } finally {
    fs.unlinkSync(p);
  }
});

test('case 3: tool_result user entry alone does not start a new turn', () => {
  const transcript = [
    userMsg(textBlock('Do task')),
    assistantMsg(textBlock('Starting...')),
    toolResultUserMsg(toolResultBlock('tu_1', 'result data')),
    // No new real user message after this — still same turn
    assistantMsg(textBlock('Done.'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(result.found, true);
    // Both assistant blocks belong to same turn
    assertContains(result.text, 'Starting...', 'first assistant block should be included');
    assertContains(result.text, 'Done.', 'last assistant block should be included');
  } finally {
    fs.unlinkSync(p);
  }
});

// ---------------------------------------------------------------------------

console.log('\n=== Case 4: Multiple user messages — only text after LAST real user message counts ===\n');

test('case 4: only assistant text after last real user message is returned', () => {
  const transcript = [
    userMsg(textBlock('First question')),
    assistantMsg(textBlock('First answer — should NOT appear')),
    userMsg(textBlock('Second question')),
    assistantMsg(textBlock('Second answer — should appear'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(result.found, true);
    assertEquals(result.text.includes('First answer'), false, 'old turn text must be excluded');
    assertContains(result.text, 'Second answer', 'current turn text must be included');
  } finally {
    fs.unlinkSync(p);
  }
});

test('case 4: three user messages — only last turn counts', () => {
  const transcript = [
    userMsg(textBlock('Q1')),
    assistantMsg(textBlock('A1')),
    userMsg(textBlock('Q2')),
    assistantMsg(textBlock('A2')),
    userMsg(textBlock('Q3')),
    assistantMsg(textBlock('A3'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(result.found, true);
    assertEquals(result.text.includes('A1'), false, 'A1 should not be in result');
    assertEquals(result.text.includes('A2'), false, 'A2 should not be in result');
    assertContains(result.text, 'A3', 'A3 should be in result');
  } finally {
    fs.unlinkSync(p);
  }
});

test('case 4: tool_result user entries between real user messages do not count as last real user', () => {
  const transcript = [
    userMsg(textBlock('Real question')),
    assistantMsg(textBlock('Visible answer')),
    toolResultUserMsg(toolResultBlock('tu_1', 'tool output')),
    // No new real user message — tool_result does not reset turn
    assistantMsg(textBlock('Continuation'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(result.found, true);
    // Both assistant blocks are in the same turn
    assertContains(result.text, 'Visible answer');
    assertContains(result.text, 'Continuation');
  } finally {
    fs.unlinkSync(p);
  }
});

// ---------------------------------------------------------------------------

console.log('\n=== Case 4b: lookbackTurns — include recent prior turns ===\n');

test('case 4b: lookbackTurns=3 includes text from the last 3 turns', () => {
  const transcript = [
    userMsg(textBlock('Q1')),
    assistantMsg(textBlock('A1')),
    userMsg(textBlock('Q2')),
    assistantMsg(textBlock('A2')),
    userMsg(textBlock('Q3')),
    assistantMsg(textBlock('A3'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p, 3);
    assertEquals(result.found, true);
    assertContains(result.text, 'A1', 'A1 within 3-turn lookback');
    assertContains(result.text, 'A2', 'A2 within 3-turn lookback');
    assertContains(result.text, 'A3', 'A3 within 3-turn lookback');
  } finally {
    fs.unlinkSync(p);
  }
});

test('case 4b: lookbackTurns=2 excludes turns older than the window', () => {
  const transcript = [
    userMsg(textBlock('Q1')),
    assistantMsg(textBlock('A1')),
    userMsg(textBlock('Q2')),
    assistantMsg(textBlock('A2')),
    userMsg(textBlock('Q3')),
    assistantMsg(textBlock('A3'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p, 2);
    assertEquals(result.text.includes('A1'), false, 'A1 outside 2-turn lookback');
    assertContains(result.text, 'A2', 'A2 within window');
    assertContains(result.text, 'A3', 'A3 within window');
  } finally {
    fs.unlinkSync(p);
  }
});

test('case 4b: lookbackTurns larger than turn count clamps to oldest turn', () => {
  const transcript = [
    userMsg(textBlock('Q1')),
    assistantMsg(textBlock('A1'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p, 10);
    assertEquals(result.found, true);
    assertContains(result.text, 'A1', 'single turn still returned');
  } finally {
    fs.unlinkSync(p);
  }
});

test('case 4b: omitted/invalid lookbackTurns defaults to current turn only', () => {
  const transcript = [
    userMsg(textBlock('Q1')),
    assistantMsg(textBlock('A1')),
    userMsg(textBlock('Q2')),
    assistantMsg(textBlock('A2'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const omitted = extractCurrentTurnVisibleText(p);
    assertEquals(omitted.text.includes('A1'), false, 'default must stay current-turn only');
    const invalid = extractCurrentTurnVisibleText(p, 0);
    assertEquals(invalid.text.includes('A1'), false, 'lookbackTurns=0 must fall back to 1');
  } finally {
    fs.unlinkSync(p);
  }
});

// ---------------------------------------------------------------------------

console.log('\n=== Case 5: Error handling — missing file / corrupt JSON ===\n');

test('case 5: missing file → { text: "", found: false }, no throw', () => {
  const nonExistent = path.join(os.tmpdir(), 'ck-test-does-not-exist-' + Date.now() + '.jsonl');
  let result;
  let threw = false;
  try {
    result = extractCurrentTurnVisibleText(nonExistent);
  } catch (e) {
    threw = true;
  }
  assertEquals(threw, false, 'should not throw on missing file');
  assertEquals(result.text, '', 'text should be empty');
  assertEquals(result.found, false, 'found should be false');
});

test('case 5: corrupt JSON lines → { text: "", found: false }, no throw', () => {
  const p = path.join(os.tmpdir(), `ck-test-corrupt-${Date.now()}.jsonl`);
  fs.writeFileSync(p, 'NOT VALID JSON\n{broken: json\n', 'utf8');
  let result;
  let threw = false;
  try {
    result = extractCurrentTurnVisibleText(p);
  } catch (e) {
    threw = true;
  }
  try { fs.unlinkSync(p); } catch (e) {}
  assertEquals(threw, false, 'should not throw on corrupt JSON');
  assertEquals(result.text, '', 'text should be empty');
  assertEquals(result.found, false, 'found should be false');
});

test('case 5: empty file → { text: "", found: false }, no throw', () => {
  const p = path.join(os.tmpdir(), `ck-test-empty-${Date.now()}.jsonl`);
  fs.writeFileSync(p, '', 'utf8');
  let result;
  let threw = false;
  try {
    result = extractCurrentTurnVisibleText(p);
  } catch (e) {
    threw = true;
  }
  try { fs.unlinkSync(p); } catch (e) {}
  assertEquals(threw, false, 'should not throw on empty file');
  assertEquals(result.text, '', 'text should be empty');
  assertEquals(result.found, false, 'found should be false');
});

test('case 5: mixed valid + corrupt lines — graceful degradation, no throw', () => {
  const transcript = [
    userMsg(textBlock('Hello')),
  ];
  const validLine = JSON.stringify(transcript[0]);
  const p = path.join(os.tmpdir(), `ck-test-mixed-${Date.now()}.jsonl`);
  fs.writeFileSync(p, validLine + '\nBAD JSON LINE\n', 'utf8');
  let threw = false;
  try {
    extractCurrentTurnVisibleText(p);
  } catch (e) {
    threw = true;
  }
  try { fs.unlinkSync(p); } catch (e) {}
  assertEquals(threw, false, 'should not throw when some lines are invalid');
});

// ---------------------------------------------------------------------------

console.log('\n=== Return shape contract ===\n');

test('return value always has { text, found } shape', () => {
  const transcript = [
    userMsg(textBlock('Hi')),
    assistantMsg(textBlock('Hello'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(typeof result, 'object', 'result must be object');
    assertEquals('text' in result, true, 'result must have text field');
    assertEquals('found' in result, true, 'result must have found field');
    assertEquals(typeof result.text, 'string', 'text must be string');
    assertEquals(typeof result.found, 'boolean', 'found must be boolean');
  } finally {
    fs.unlinkSync(p);
  }
});

test('no assistant messages after last user → found true, text empty', () => {
  const transcript = [
    userMsg(textBlock('Question with no answer yet'))
  ];
  const p = writeTempTranscript(transcript);
  try {
    const result = extractCurrentTurnVisibleText(p);
    assertEquals(result.found, true, 'turn was found');
    assertEquals(result.text, '', 'no assistant text yet');
  } finally {
    fs.unlinkSync(p);
  }
});

// ---------------------------------------------------------------------------

console.log('\n=== Summary ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  process.exitCode = 1;
}
