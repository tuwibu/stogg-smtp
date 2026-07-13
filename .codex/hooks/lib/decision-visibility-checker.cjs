'use strict';

/**
 * decision-visibility-checker.cjs
 *
 * Pure classification and visibility-check functions for the decision-visibility gate.
 * No I/O here — all logic is unit-testable without stdin/file plumbing.
 *
 * Gate principle: when an AI presents named alternatives (Phương án A / Option B / Plan C)
 * inside AskUserQuestion without first printing them as visible markdown, the user is asked
 * to choose between things they cannot see. This checker detects that pattern and surfaces
 * the missing context so the AI must describe options before showing the popup.
 *
 * Exports:
 *   classifyQuestions(questions)         → { gate: boolean, reason: string }
 *   checkVisibility(mode, text, qs)      → { pass: boolean, missingLabels: string[] }
 *   formatBlockMessage(missingLabels)    → string
 *
 * checkVisibility two-path design:
 *   PRIMARY   — tool_input pass (harness-independent): an option passes if its
 *               `description` field is a string with length >= 40 chars, OR its
 *               `preview` field is a non-whitespace-only string. This works in
 *               headless / API harnesses where there is no CLI transcript at all.
 *   SECONDARY — transcript fallback (CLI harnesses): if tool_input doesn't pass,
 *               the option still passes if its name-part appears as a substring
 *               in the normalized visible text from the assistant turn.
 *   An option only goes into missingLabels when BOTH paths fail.
 */

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

/**
 * Named-alternative pattern: labels like "Phương án A", "Phương án 1", "Plan B",
 * "Approach C", "Design X", or any label containing em-dash (—).
 * These are the decision-prompt signals that require prior visible explanation.
 * English "option N" / "plan N" (numbered) are excluded: that style is how
 * clarifying questions enumerate choices ("option 1: src/api/users.ts") and
 * gating them produces false blocks; real numbered design ballots carry an
 * em-dash or rich descriptions, which the other signals still catch.
 * "(Recommended)" alone is NOT a signal: the AskUserQuestion tool convention
 * appends it to the suggested option of ANY question — including plain
 * clarifying questions — so treating it as a design-ballot marker gates
 * ordinary prompts like "BPM nhập tay (Recommended)".
 */
const NAMED_ALTERNATIVE_RE = /^(phương án|approach|option(?!\s+\d)|plan(?!\s+\d)|design)\s+\S/i;

/**
 * Workflow-chain pattern: labels that are self-describing navigation actions,
 * never named design alternatives. Exempt from the gate.
 */
const CHAIN_LABEL_RE = /^(proceed to \/|skip to \/|stop here|cook now|write tests first|end session|continue|cancel|yes\b|no\b)/i;

/**
 * Headers that identify known-exempt question types:
 * - "Next step": workflow chain navigation
 * - "File Access": privacy-block approval
 * - "Plan Dependency" / "Planning Operation": planner internal
 */
const EXEMPT_HEADERS = new Set(['Next step', 'File Access', 'Plan Dependency', 'Planning Operation']);

/**
 * Returns true when an option label signals a named alternative.
 * Signals: matches NAMED_ALTERNATIVE_RE or contains em-dash (—).
 *
 * @param {string} label
 * @returns {boolean}
 */
function isNamedAlternative(label) {
  if (typeof label !== 'string') return false;
  if (NAMED_ALTERNATIVE_RE.test(label)) return true;
  if (label.includes('—')) return true;
  return false;
}

/**
 * Returns true when EVERY option label matches the chain pattern.
 * A mix (some chain, some not) is not exempt — the named alternatives still need visibility.
 *
 * @param {Array<{label:string}>} options
 * @returns {boolean}
 */
function allChainLabels(options) {
  return options.every(o => CHAIN_LABEL_RE.test((o.label || '').trim()));
}

/**
 * Returns true for a "short confirm" pattern: exactly 2 options, both labels ≤ 25 chars,
 * neither contains an em-dash. These are binary yes/no prompts, not design decisions.
 *
 * @param {Array<{label:string}>} options
 * @returns {boolean}
 */
function isShortConfirm(options) {
  if (options.length !== 2) return false;
  return options.every(o => {
    const label = o.label || '';
    return label.length <= 25 && !label.includes('—');
  });
}

/**
 * Classify a flat list of questions (from tool_input.questions).
 * Returns { gate: false } when the questions are exempt or not decision prompts.
 * Returns { gate: true }  when at least one question contains named alternatives
 * that require prior visible explanation.
 *
 * A single question is a decision prompt when:
 *   (a) Any option label is a named alternative (has em-dash, or matches
 *       the phương án/approach/option/plan/design prefix pattern), OR
 *   (b) ≥3 options AND average description length > 40 chars (design-like ballot)
 *
 * Exempt (gate:false) when:
 *   - question.header is in EXEMPT_HEADERS
 *   - every option label matches CHAIN_LABEL_RE
 *   - exactly 2 options, both ≤25 chars, no em-dash (short confirm)
 *
 * @param {Array<object>} questions - AskUserQuestion tool_input.questions array
 * @returns {{ gate: boolean, reason: string }}
 */
function classifyQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { gate: false, reason: 'no questions' };
  }

  for (const q of questions) {
    const header = q.header || '';
    const options = Array.isArray(q.options) ? q.options : [];

    // Exempt: known-safe header
    if (EXEMPT_HEADERS.has(header)) {
      continue;
    }

    // Exempt: all options are workflow chain labels
    if (options.length > 0 && allChainLabels(options)) {
      continue;
    }

    // Exempt: short confirm (2 options, both short, no em-dash)
    if (isShortConfirm(options)) {
      continue;
    }

    // Gate signal (a): any option is a named alternative
    const hasNamedAlternative = options.some(o => isNamedAlternative(o.label || ''));
    if (hasNamedAlternative) {
      return { gate: true, reason: 'named-alternative labels detected' };
    }

    // Gate signal (b): ≥3 options with long descriptions (design ballot)
    if (options.length >= 3) {
      const totalDescLen = options.reduce((sum, o) => sum + (o.description || '').length, 0);
      const avgDescLen = totalDescLen / options.length;
      if (avgDescLen > 40) {
        return { gate: true, reason: 'design-like ballot (≥3 options, avg desc >40 chars)' };
      }
    }
  }

  return { gate: false, reason: 'not a decision prompt or all questions exempt' };
}

// ---------------------------------------------------------------------------
// Visibility check helpers
// ---------------------------------------------------------------------------

/**
 * Normalize text for substring matching:
 * - Lowercase (preserving Unicode diacritics — Vietnamese ăắặ etc. survive toLowerCase())
 * - Collapse consecutive whitespace to single space
 *
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return (text || '').toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Extract the "name-part" from an option label for visibility matching.
 *
 * Algorithm:
 *   1. Take the segment before the first em-dash (—) or opening parenthesis '(', trimmed.
 *   2. Normalize (lowercase, collapse whitespace).
 *   3. If the result is ≥ 3 chars → use it (e.g. "phương án a", "models-only").
 *   4. If the result is < 3 chars (e.g. single letter "a", "b") → fall back to the
 *      normalized full label, which is longer and still matchable. This covers labels
 *      like "A — Models-only codegen" where the human-assigned letter alone is too
 *      short to be a reliable substring, but the full label is present in visible text
 *      (e.g. the text contains "a — models-only").
 *
 * Returns null only when the normalized full label is also < 3 chars.
 *
 * @param {string} label
 * @returns {string|null}
 */
function extractNamePart(label) {
  if (typeof label !== 'string') return null;
  // Prefer the short segment before — or (
  const cut = label.split(/[—(]/)[0];
  const shortPart = normalize(cut).trim();
  if (shortPart.length >= 3) return shortPart;
  // Fallback: full label stripped of parentheticals then normalized.
  // Strip (...) suffixes like "(Recommended)" before normalizing so the
  // fallback matches text that omits those parentheticals.
  // Limitation: this fallback keeps the em-dash, so the visible text must use
  // the same em-dash (—) as the label; en-dash (–) or colon variants of the
  // same heading will not match and the gate will still block.
  const stripped = label.replace(/\([^)]*\)\s*/g, '').trim();
  const fullPart = normalize(stripped).trim();
  return fullPart.length >= 3 ? fullPart : null;
}

/**
 * Returns true when an option passes via tool_input fields alone (harness-independent).
 * Pass when:
 *   - description is a string with length >= 40, OR
 *   - preview is a string with non-whitespace content (trim().length > 0)
 *
 * @param {{ description?: unknown, preview?: unknown }} opt
 * @returns {boolean}
 */
function passesByToolInput(opt) {
  // Note: the 40 here (per-option pass threshold) and the avgDescLen > 40 in
  // classifyQuestions signal (b) (ballot detection) are independent guard-rails
  // that coincidentally share a value. Changing one does NOT require changing
  // the other.
  if (typeof opt.description === 'string' && opt.description.length >= 40) return true;
  if (typeof opt.preview === 'string' && opt.preview.trim().length > 0) return true;
  return false;
}

/**
 * Check whether each named-alternative option is sufficiently described, either
 * via tool_input fields (primary, harness-independent) or visible transcript text
 * (secondary fallback for CLI harnesses).
 *
 * Strict mode:
 *   For each named-alternative option, it passes if:
 *     (a) passesByToolInput(opt) — description >= 40 chars OR non-empty preview, OR
 *     (b) the option's name-part appears as a substring in the normalized visible text.
 *   Options failing BOTH go into missingLabels.
 *
 * Minimal mode:
 *   pass = (visibleText.trim().length >= 100) OR (every named-alternative option
 *   across all questions passes passesByToolInput).
 *   missingLabels stays [] in minimal mode (existing contract).
 *
 * Invalid mode: treated as strict.
 *
 * @param {string} mode - 'strict' | 'minimal' (anything else → 'strict')
 * @param {string} visibleText - Concatenated visible assistant text for this turn
 * @param {Array<object>} questions - AskUserQuestion tool_input.questions array
 * @returns {{ pass: boolean, missingLabels: string[] }}
 */
function checkVisibility(mode, visibleText, questions) {
  const resolvedMode = mode === 'minimal' ? 'minimal' : 'strict';

  if (resolvedMode === 'minimal') {
    // Primary: text length >= 100
    if ((visibleText || '').trim().length >= 100) {
      return { pass: true, missingLabels: [] };
    }
    // Secondary: all named-alternative options pass via tool_input
    const allQs = questions || [];
    const allNamedOpts = allQs.flatMap(q => (q.options || []).filter(o => isNamedAlternative(o.label || '')));
    if (allNamedOpts.length > 0 && allNamedOpts.every(o => passesByToolInput(o))) {
      return { pass: true, missingLabels: [] };
    }
    return { pass: false, missingLabels: [] };
  }

  // Strict mode: two-path check per named-alternative option
  const normalizedText = normalize(visibleText);
  const missingLabels = [];

  for (const q of (questions || [])) {
    for (const opt of (q.options || [])) {
      const label = opt.label || '';
      if (!isNamedAlternative(label)) continue; // skip non-named-alternative options

      // PRIMARY: tool_input pass
      if (passesByToolInput(opt)) continue;

      // SECONDARY: transcript fallback
      const namePart = extractNamePart(label);
      if (namePart && normalizedText.includes(namePart)) continue;

      missingLabels.push(label);
    }
  }

  return { pass: missingLabels.length === 0, missingLabels };
}

// ---------------------------------------------------------------------------
// Block message
// ---------------------------------------------------------------------------

/**
 * Format the corrective stderr message when the gate blocks.
 * The message tells the AI exactly what to do to self-correct:
 * print the missing option descriptions as VISIBLE response text (not thinking),
 * including each label's name-part VERBATIM, then re-call AskUserQuestion.
 *
 * @param {string[]} missingLabels - Labels whose name-parts were absent from visible text
 * @returns {string}
 */
function formatBlockMessage(missingLabels) {
  const labelList = missingLabels.map(l => `  - ${l}`).join('\n');
  const namePartList = missingLabels
    .map(l => {
      const part = extractNamePart(l);
      return part ? `  - "${part}"` : null;
    })
    .filter(Boolean)
    .join('\n');
  return [
    '[decision-visibility-gate] Options chưa được trình bày cho user.',
    'Rule: .claude/rules/decision-prompt-visibility.md',
    'Cách tự sửa (làm đúng thứ tự, ĐỪNG retry ngay):',
    '  CÁCH 1 (ưu tiên — harness-independent): Thêm `description` >= 40 ký tự HOẶC `preview` (markdown)',
    '  vào mỗi option trong lời gọi AskUserQuestion. Ví dụ:',
    '    { "label": "A — Example", "description": "Mô tả đủ dài >= 40 ký tự giải thích phương án A..." }',
    '    hoặc: { "label": "A — Example", "preview": "## Phương án A\\nNội dung chi tiết..." }',
    '  CÁCH 2 (fallback — chỉ cần khi KHÔNG dùng CÁCH 1; không tin cậy trên harness nuốt mid-turn text):',
    '     Viết trong RESPONSE TEXT THƯỜNG (markdown user nhìn thấy — KHÔNG phải thinking):',
    '     mỗi phương án gồm tên + nội dung + 1-3 trade-off bullets, kèm phương án bạn recommend và lý do.',
    '     Text đó PHẢI chứa NGUYÊN VĂN các cụm sau (checker so khớp substring, không phân biệt hoa/thường):',
    namePartList || '  (n/a)',
    '  Sau khi đã sửa xong, gọi lại AskUserQuestion với CÙNG các options.',
    `Missing labels:\n${labelList}`,
  ].join('\n');
}

module.exports = { classifyQuestions, checkVisibility, formatBlockMessage };
