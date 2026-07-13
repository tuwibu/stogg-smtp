/**
 * Tests for decision-visibility-checker.cjs
 * Run: node .claude/hooks/lib/__tests__/decision-visibility-checker.test.cjs
 *
 * Scenarios: classify named-alternative decision prompts, exempt chain/privacy/
 * short-confirm prompts, strict/minimal visibility checks, Vietnamese diacritics,
 * block message contract.
 *
 * Module API expected (implementation must satisfy these exact signatures):
 *   classifyQuestions(questions) → { gate: boolean, reason: string }
 *     - gate: true  → decision prompt, gate applies
 *     - gate: false → exempt or not a decision prompt, skip gate
 *     - reason: short description for logging
 *
 *   checkVisibility(mode, visibleText, questions) → { pass: boolean, missingLabels: string[] }
 *     - mode: 'strict' | 'minimal' (invalid value falls back to 'strict')
 *     - strict  : every named-alternative label's name-part must appear in visibleText (normalized)
 *     - minimal : visibleText.trim().length >= 100 chars  (rough presence check)
 *     - missingLabels: list of labels whose name-parts were absent (strict), or [] on pass
 *
 *   formatBlockMessage(missingLabels) → string
 *     - must contain '.claude/rules/decision-prompt-visibility.md'
 *     - must contain each label from missingLabels
 */

const {
  classifyQuestions,
  checkVisibility,
  formatBlockMessage,
} = require('../decision-visibility-checker.cjs');

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
    throw new Error(`${msg}\n  Expected string to contain: ${JSON.stringify(substr)}\n  Actual: ${JSON.stringify(actual)}`);
  }
}

function assertDeepIncludes(arr, item, msg = '') {
  if (!Array.isArray(arr) || !arr.includes(item)) {
    throw new Error(`${msg}\n  Expected array to include: ${JSON.stringify(item)}\n  Array: ${JSON.stringify(arr)}`);
  }
}

function assertNotIncludes(arr, item, msg = '') {
  if (Array.isArray(arr) && arr.includes(item)) {
    throw new Error(`${msg}\n  Expected array NOT to include: ${JSON.stringify(item)}\n  Array: ${JSON.stringify(arr)}`);
  }
}

// ---------------------------------------------------------------------------
// Helper — build a minimal question object matching AskUserQuestion tool_input shape
// ---------------------------------------------------------------------------
function mkQuestion({ header = 'Choose', question = 'Pick one', options = [], multiSelect = false } = {}) {
  return { header, question, options, multiSelect };
}

function mkOpt(label, description = '') {
  return { label, description };
}

// ---------------------------------------------------------------------------
// Case 1: Screenshot replay — options with named alternatives, visible text = ''
//   Expected: strict BLOCK, missingLabels lists all three names
// ---------------------------------------------------------------------------
console.log('\n=== Case 1: Screenshot replay block ===\n');

// Descriptions intentionally < 40 chars: these cases exercise the scenario where
// BOTH pass paths fail (no tool_input pass, no transcript match). Options with
// description >= 40 chars legitimately pass via tool_input — see Case 9.
const screenshotOptions = [
  mkOpt('A — Models-only codegen (Recommended)', 'Models from OpenAPI spec'),
  mkOpt('B — Full client codegen', 'Full HTTP client'),
  mkOpt('C — Drift-check only', 'Diff spec vs code'),
];

test('case 1: classifyQuestions gates named-alternative options', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, true, 'should gate named-alternative labels');
});

test('case 1: checkVisibility strict with empty text → pass:false', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const result = checkVisibility('strict', '', [q]);
  assertEquals(result.pass, false, 'empty visible text must fail strict check');
});

test('case 1: checkVisibility strict with empty text → missingLabels includes all three', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const { missingLabels } = checkVisibility('strict', '', [q]);
  assertDeepIncludes(missingLabels, 'A — Models-only codegen (Recommended)', 'A should be missing');
  assertDeepIncludes(missingLabels, 'B — Full client codegen', 'B should be missing');
  assertDeepIncludes(missingLabels, 'C — Drift-check only', 'C should be missing');
});

// ---------------------------------------------------------------------------
// Case 2: Same options, visible text contains all name-parts → PASS
// ---------------------------------------------------------------------------
console.log('\n=== Case 2: Full pass — all labels mentioned in visible text ===\n');

const fullVisibleText = `
### Phương án A — Models-only codegen
Generate only models from spec.

### B — Full client codegen
Generate full HTTP client.

### C — Drift-check only
Diff spec vs code.
`;

test('case 2: checkVisibility strict → pass:true when all name-parts present', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const result = checkVisibility('strict', fullVisibleText, [q]);
  assertEquals(result.pass, true, 'should pass when all name-parts present in visible text');
});

test('case 2: checkVisibility strict pass → missingLabels is empty', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const { missingLabels } = checkVisibility('strict', fullVisibleText, [q]);
  assertEquals(missingLabels.length, 0, 'missingLabels must be empty on pass');
});

// ---------------------------------------------------------------------------
// Case 3: Partial — A and B present but C absent → strict BLOCK with only C missing
// ---------------------------------------------------------------------------
console.log('\n=== Case 3: Partial — only C missing ===\n');

const partialVisibleText = `
### A — Models-only codegen (Recommended)
Some content here.

### B — Full client codegen
More content.
`;

test('case 3: checkVisibility strict → pass:false when one name-part absent', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const result = checkVisibility('strict', partialVisibleText, [q]);
  assertEquals(result.pass, false, 'should fail when C is absent');
});

test('case 3: missingLabels contains only C, not A or B', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const { missingLabels } = checkVisibility('strict', partialVisibleText, [q]);
  assertDeepIncludes(missingLabels, 'C — Drift-check only', 'C should be in missingLabels');
  assertNotIncludes(missingLabels, 'A — Models-only codegen (Recommended)', 'A should NOT be missing');
  assertNotIncludes(missingLabels, 'B — Full client codegen', 'B should NOT be missing');
});

// ---------------------------------------------------------------------------
// Case 4a: Half-hearted violation — strict BLOCK
// Case 4b: minimal mode, short text → BLOCK (< 100 chars)
// Case 4c: minimal mode, text >= 100 chars → PASS (documented limitation)
// ---------------------------------------------------------------------------
console.log('\n=== Case 4: Half-hearted text ===\n');

const halfHeartedText = 'Tôi đề xuất 3 phương án.'; // < 100 chars, no label content

test('case 4a: strict mode, half-hearted text → pass:false', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const result = checkVisibility('strict', halfHeartedText, [q]);
  assertEquals(result.pass, false, 'half-hearted text must fail strict check');
});

test('case 4b: minimal mode, text < 100 chars → pass:false', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const result = checkVisibility('minimal', halfHeartedText, [q]);
  assertEquals(result.pass, false, 'minimal mode must fail when text < 100 chars');
});

test('case 4c: minimal mode, text >= 100 chars → pass:true (documented limitation)', () => {
  // Minimal mode only checks length, not label presence
  const longEnoughText = 'Tôi đề xuất 3 phương án cho vấn đề này. '.repeat(5); // >100 chars, no labels
  const q = mkQuestion({ options: screenshotOptions });
  const result = checkVisibility('minimal', longEnoughText, [q]);
  assertEquals(result.pass, true, 'minimal mode passes when text.trim().length >= 100 (known limitation)');
});

// ---------------------------------------------------------------------------
// Case 5: Exempts — various patterns that must NOT gate
// ---------------------------------------------------------------------------
console.log('\n=== Case 5: Exempt headers and chain labels ===\n');

test('case 5a: header "Next step" → gate:false', () => {
  const q = mkQuestion({
    header: 'Next step',
    options: [
      mkOpt('Proceed to /cook', 'Run implementation'),
      mkOpt('Skip to /git', 'Skip ahead'),
      mkOpt('Stop here', 'End workflow'),
    ],
  });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, false, 'Next step header must be exempt');
});

test('case 5b: header "File Access" yes/no → gate:false', () => {
  const q = mkQuestion({
    header: 'File Access',
    options: [
      mkOpt('Yes, approve access', 'Allow reading .env this time'),
      mkOpt('No, skip this file', 'Continue without accessing this file'),
    ],
  });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, false, 'File Access header must be exempt');
});

test('case 5c: 2 short options with no em-dash → gate:false (short confirm)', () => {
  // Exactly 2 options, both labels ≤ 25 chars, no "—"
  const q = mkQuestion({
    header: 'Confirm',
    options: [
      mkOpt('Yes, approve access'),  // 18 chars
      mkOpt('No, skip this file'),   // 18 chars
    ],
  });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, false, '2 short options without em-dash must be exempt short confirm');
});

test('case 5d: all options are chain-pattern labels → gate:false', () => {
  const q = mkQuestion({
    header: 'workflow',
    options: [
      mkOpt('Proceed to /test'),
      mkOpt('Skip to /simplify'),
      mkOpt('Stop here'),
    ],
  });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, false, 'chain-pattern labels must be exempt');
});

test('case 5e: "Cook now" and "Write tests first" are chain labels → gate:false', () => {
  const q = mkQuestion({
    header: 'Next step',
    options: [
      mkOpt('Cook now'),
      mkOpt('Write tests first'),
      mkOpt('Stop here'),
    ],
  });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, false, 'Cook now / Write tests first must be exempt chain labels');
});

// ---------------------------------------------------------------------------
// Case 6: Clarifying question — 2 short self-explanatory labels, no em-dash → NOT a decision prompt
// ---------------------------------------------------------------------------
console.log('\n=== Case 6: Non-decision clarifying question ===\n');

test('case 6: short yes/no clarifying question → gate:false', () => {
  // e.g. "Endpoint in src/api/users.ts or new src/api/profile/?" → 2 short options, no named alternatives
  const q = mkQuestion({
    header: 'Location',
    question: 'Endpoint in src/api/users.ts or new src/api/profile/?',
    options: [
      mkOpt('src/api/users.ts'),   // 14 chars, no em-dash
      mkOpt('src/api/profile/'),   // 15 chars, no em-dash
    ],
  });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, false, 'short clarifying question must not trigger gate');
});

test('case 6b: numbered "option N:" enumeration with 3 short choices → gate:false', () => {
  // Clarifying-question style: numbered file-location choices are not design ballots
  const q = mkQuestion({
    header: 'Location',
    question: 'Where should the endpoint live?',
    options: [
      mkOpt('option 1: src/api/users.ts'),
      mkOpt('option 2: src/api/profile.ts'),
      mkOpt('option 3: new module'),
    ],
  });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, false, 'numbered option enumeration must not trigger gate');
});

test('case 6c: numbered ballot WITH em-dash summaries still gated', () => {
  // A real numbered design ballot carries em-dash summaries — em-dash signal must win
  const q = mkQuestion({
    header: 'Architecture',
    question: 'Chọn phương án?',
    options: [
      mkOpt('Option 1 — Models-only codegen'),
      mkOpt('Option 2 — Full client codegen'),
    ],
  });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, true, 'em-dash ballot must stay gated even when numbered');
});

test('case 6d: "(Recommended)" alone does NOT gate — standard AskUserQuestion convention', () => {
  // Screenshot regression: brainstorm clarifying battery where each question's
  // suggested option carries "(Recommended)" per the tool's own convention.
  const qs = [
    mkQuestion({ header: 'BPM', options: [mkOpt('BPM nhập tay (Recommended)', 'User types BPM'), mkOpt('Auto-detect')] }),
    mkQuestion({ header: 'Stack', options: [mkOpt('React + TS + Tailwind (Recommended)', 'Default FE stack'), mkOpt('Svelte')] }),
    mkQuestion({ header: 'Provider', options: [mkOpt('fal.ai only (Recommended)', 'Single provider'), mkOpt('Multi-provider')] }),
  ];
  const result = classifyQuestions(qs);
  assertEquals(result.gate, false, '(Recommended) suffix alone must not trigger the gate');
});

test('case 6e: "(Recommended)" + em-dash still gated', () => {
  const q = mkQuestion({
    options: [
      mkOpt('A — Models-only codegen (Recommended)'),
      mkOpt('B — Full client codegen'),
    ],
  });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, true, 'em-dash signal must still gate even with (Recommended)');
});

// ---------------------------------------------------------------------------
// Case 7: Vietnamese diacritics survive normalization
// ---------------------------------------------------------------------------
console.log('\n=== Case 7: Vietnamese diacritics ===\n');

const viOptions = [
  mkOpt('Phương án A — Tái cấu trúc toàn bộ', 'Refactor everything'),
  mkOpt('Phương án B — Sửa từng bước', 'Incremental fix'),
];

test('case 7: classifyQuestions gates Vietnamese labeled options', () => {
  const q = mkQuestion({ options: viOptions });
  const result = classifyQuestions([q]);
  assertEquals(result.gate, true, 'Vietnamese named alternatives must be gated');
});

test('case 7: visible text with lowercase "phương án a" matches label "Phương án A …"', () => {
  // name-part of "Phương án A — Tái cấu trúc toàn bộ" = "phương án a"
  // visible text has lowercase form → must still match (case-insensitive, diacritics preserved)
  const visibleText = `
Tôi trình bày hai phương án:

**phương án a** — tái cấu trúc toàn bộ hệ thống.
**phương án b** — sửa từng bước nhỏ.
`;
  const q = mkQuestion({ options: viOptions });
  const result = checkVisibility('strict', visibleText, [q]);
  assertEquals(result.pass, true, 'Vietnamese diacritics must survive normalization and match');
});

test('case 7: missing Vietnamese label detected correctly', () => {
  // Only phương án a present, B missing
  const visibleText = 'Chúng ta có phương án a ở đây.';
  const q = mkQuestion({ options: viOptions });
  const { pass, missingLabels } = checkVisibility('strict', visibleText, [q]);
  assertEquals(pass, false, 'should fail when B is missing');
  assertDeepIncludes(missingLabels, 'Phương án B — Sửa từng bước', 'B must be listed as missing');
});

// ---------------------------------------------------------------------------
// Case 8: Mode handling — config object honored; invalid mode fallback to strict
// ---------------------------------------------------------------------------
console.log('\n=== Case 8: Mode handling ===\n');

test('case 8a: mode "minimal" with long text → pass (via minimal logic)', () => {
  const longText = 'x'.repeat(120); // definitely >= 100 chars
  const q = mkQuestion({ options: screenshotOptions });
  const result = checkVisibility('minimal', longText, [q]);
  assertEquals(result.pass, true, 'minimal mode should pass on text >= 100 chars regardless of labels');
});

test('case 8b: invalid mode string fallback to strict → fails on empty text', () => {
  // Invalid mode should be treated as 'strict'
  const q = mkQuestion({ options: screenshotOptions });
  const result = checkVisibility('garbage-mode', '', [q]);
  assertEquals(result.pass, false, 'invalid mode must fall back to strict, which fails on empty text');
});

test('case 8c: invalid mode fallback to strict → missingLabels populated', () => {
  const q = mkQuestion({ options: screenshotOptions });
  const { missingLabels } = checkVisibility('invalid', '', [q]);
  assertEquals(missingLabels.length > 0, true, 'invalid mode fallback to strict must list missing labels');
});

// ---------------------------------------------------------------------------
// formatBlockMessage shape
// ---------------------------------------------------------------------------
console.log('\n=== formatBlockMessage contract ===\n');

test('formatBlockMessage contains rule path', () => {
  const msg = formatBlockMessage(['A — Models-only codegen (Recommended)']);
  assertContains(msg, '.claude/rules/decision-prompt-visibility.md', 'must reference the rule file');
});

test('formatBlockMessage contains missing label', () => {
  const missing = ['A — Models-only codegen (Recommended)', 'C — Drift-check only'];
  const msg = formatBlockMessage(missing);
  assertContains(msg, 'A — Models-only codegen (Recommended)', 'must list missing label A');
  assertContains(msg, 'C — Drift-check only', 'must list missing label C');
});

test('formatBlockMessage contains hook identifier', () => {
  const msg = formatBlockMessage(['Some label']);
  assertContains(msg, 'decision-visibility-gate', 'block message must identify the gate');
});

test('formatBlockMessage instructs verbatim name-parts in visible text', () => {
  const msg = formatBlockMessage(['Phương án A — Tái cấu trúc toàn bộ']);
  assertContains(msg, 'NGUYÊN VĂN', 'must demand verbatim phrases');
  assertContains(msg, '"phương án a"', 'must list the exact name-part to print');
  assertContains(msg, 'KHÔNG phải thinking', 'must clarify visible text vs thinking');
});

// ---------------------------------------------------------------------------
// Case 9/10: tool_input pass — description >= 40 chars OR preview non-empty
// ---------------------------------------------------------------------------
console.log('\n=== Case 9/10: tool_input pass (description/preview) ===\n');

// Helper: build option with optional preview field
function mkOptFull(label, description = '', preview = undefined) {
  const opt = { label, description };
  if (preview !== undefined) opt.preview = preview;
  return opt;
}

const emDashOptsLongDesc = [
  mkOptFull('A — Models-only codegen', 'x'.repeat(40)),   // exactly 40 chars → pass
  mkOptFull('B — Full client codegen', 'y'.repeat(45)),   // > 40 → pass
  mkOptFull('C — Drift-check only',    'z'.repeat(50)),   // > 40 → pass
];

test('spec 1: em-dash ballot, empty transcript, all desc >= 40 → pass:true, missingLabels []', () => {
  const q = mkQuestion({ options: emDashOptsLongDesc });
  const result = checkVisibility('strict', '', [q]);
  assertEquals(result.pass, true, 'all desc >= 40 must pass even with empty text');
  assertEquals(result.missingLabels.length, 0, 'missingLabels must be empty');
});

test('spec 2: em-dash ballot, empty transcript, short desc but preview non-empty → pass:true', () => {
  const opts = [
    mkOptFull('A — Models-only codegen', 'short', '## Nội dung phương án A'),
    mkOptFull('B — Full client codegen', 'short', '## Nội dung phương án B'),
  ];
  const q = mkQuestion({ options: opts });
  const result = checkVisibility('strict', '', [q]);
  assertEquals(result.pass, true, 'non-empty preview must pass even with short desc and empty text');
});

test('spec 3: em-dash ballot, empty transcript, desc 39 chars, no preview → pass:false, label in missingLabels', () => {
  const opts = [
    mkOptFull('A — Models-only codegen', 'x'.repeat(39)),  // boundary: 39 < 40 → fail
  ];
  const q = mkQuestion({ options: opts });
  const result = checkVisibility('strict', '', [q]);
  assertEquals(result.pass, false, 'desc 39 chars must NOT pass (boundary)');
  assertDeepIncludes(result.missingLabels, 'A — Models-only codegen', 'label must be in missingLabels');
});

test('spec 4: desc exactly 40 chars → pass', () => {
  const opts = [
    mkOptFull('A — Models-only codegen', 'x'.repeat(40)),  // boundary: exactly 40 → pass
  ];
  const q = mkQuestion({ options: opts });
  const result = checkVisibility('strict', '', [q]);
  assertEquals(result.pass, true, 'desc exactly 40 chars must pass');
  assertEquals(result.missingLabels.length, 0, 'missingLabels must be empty');
});

test('spec 5: preview whitespace-only → NOT counted as preview → fail if desc short + text empty', () => {
  const opts = [
    mkOptFull('A — Models-only codegen', 'short', '   '),  // whitespace-only preview
  ];
  const q = mkQuestion({ options: opts });
  const result = checkVisibility('strict', '', [q]);
  assertEquals(result.pass, false, 'whitespace-only preview must NOT count');
  assertDeepIncludes(result.missingLabels, 'A — Models-only codegen', 'label must be missing');
});

test('spec 6: mixed — A pass via desc, B pass via transcript, C fail → missingLabels=[C]', () => {
  const opts = [
    mkOptFull('A — Models-only codegen', 'x'.repeat(40)),  // pass tool_input
    mkOptFull('B — Full client codegen', 'short'),          // pass transcript (name-part in text)
    mkOptFull('C — Drift-check only', 'short'),             // fail both
  ];
  const visibleText = 'B — Full client codegen is described here.';
  const q = mkQuestion({ options: opts });
  const result = checkVisibility('strict', visibleText, [q]);
  assertEquals(result.pass, false, 'must fail because C is not covered');
  assertNotIncludes(result.missingLabels, 'A — Models-only codegen', 'A must NOT be missing');
  assertNotIncludes(result.missingLabels, 'B — Full client codegen', 'B must NOT be missing');
  assertDeepIncludes(result.missingLabels, 'C — Drift-check only', 'C must be missing');
});

test('spec 7: transcript-only pass still works — desc short, text has all name-parts → pass', () => {
  // regression: old behavior must not break
  const opts = [
    mkOptFull('A — Models-only codegen', 'short'),
    mkOptFull('B — Full client codegen', 'short'),
  ];
  const visibleText = 'a — models-only codegen and b — full client codegen are both here.';
  const q = mkQuestion({ options: opts });
  const result = checkVisibility('strict', visibleText, [q]);
  assertEquals(result.pass, true, 'transcript name-part match must still pass as fallback');
  assertEquals(result.missingLabels.length, 0, 'missingLabels must be empty');
});

test('spec 8: minimal mode, text 50 chars (<100) but tool_input pass for all → pass:true', () => {
  const opts = [
    mkOptFull('A — Models-only codegen', 'x'.repeat(40)),
    mkOptFull('B — Full client codegen', 'y'.repeat(40)),
  ];
  const shortText = 'x'.repeat(50);  // < 100 chars so old minimal path would fail
  const q = mkQuestion({ options: opts });
  const result = checkVisibility('minimal', shortText, [q]);
  assertEquals(result.pass, true, 'minimal mode: tool_input pass for all → overall pass even if text < 100');
});

test('spec 9: formatBlockMessage mentions description, preview, and "40"', () => {
  const msg = formatBlockMessage(['A — Models-only codegen']);
  assertContains(msg, 'description', 'must mention "description"');
  assertContains(msg, 'preview', 'must mention "preview"');
  assertContains(msg, '40', 'must mention the 40-char threshold');
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
