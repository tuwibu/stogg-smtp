#!/usr/bin/env node
/**
 * decision-visibility-gate.cjs — PreToolUse hook for AskUserQuestion
 *
 * Blocks AskUserQuestion calls where the AI presents named design alternatives
 * (Phương án A / Option B / Plan C) without first printing them as visible markdown
 * in the response text. This enforces the rule that users must be able to see what
 * they are being asked to choose between before the popup appears.
 *
 * Exit codes:
 *   0 → allowed (pass, exempt, fail-open on any error)
 *   2 → blocked (named alternatives not described in visible text)
 *
 * Rule: .claude/rules/decision-prompt-visibility.md
 */

// Outer crash wrapper — catches require() failures, always fails open
try {
  const fs = require('fs');
  const { isHookEnabled, getHookOption } = require('./lib/ck-config-utils.cjs');
  const { createHookTimer, logHookCrash } = require('./lib/hook-logger.cjs');
  const { extractCurrentTurnVisibleText } = require('./lib/transcript-visible-text.cjs');
  const {
    classifyQuestions,
    checkVisibility,
    formatBlockMessage,
  } = require('./lib/decision-visibility-checker.cjs');

  // Default-enabled like every other hook; disable with hooks['decision-visibility-gate']: false,
  // or soften to minimal mode with { "mode": "minimal" }.
  if (!isHookEnabled('decision-visibility-gate')) {
    process.exit(0);
  }

  const timer = createHookTimer('decision-visibility-gate', { event: 'PreToolUse' });

  try {
    // Read mode before processing — allows per-project override to 'minimal'
    const mode = getHookOption('decision-visibility-gate', 'mode', 'strict');

    // Read stdin synchronously (fd 0)
    let raw;
    try {
      raw = fs.readFileSync(0, 'utf8');
    } catch (_) {
      // Stdin unreadable — fail open
      timer.end({ status: 'warn', exit: 0, note: 'stdin-unreadable' });
      process.exit(0);
    }

    // Parse JSON — fail open on malformed input
    let data;
    try {
      data = JSON.parse(raw);
    } catch (_) {
      timer.end({ status: 'warn', exit: 0, note: 'json-parse-failed' });
      process.exit(0);
    }

    // Validate structure — fail open when tool_input or questions missing
    const questions = data && data.tool_input && Array.isArray(data.tool_input.questions)
      ? data.tool_input.questions
      : null;

    if (!questions) {
      timer.end({ status: 'warn', exit: 0, note: 'no-questions' });
      process.exit(0);
    }

    // Classify: is this a decision prompt that requires prior visible explanation?
    const { gate } = classifyQuestions(questions);
    if (!gate) {
      timer.end({ status: 'ok', exit: 0, note: 'not-gated' });
      process.exit(0);
    }

    // Resolve transcript path — fail open when absent or unreadable
    const transcriptPath = typeof data.transcript_path === 'string' && data.transcript_path
      ? data.transcript_path
      : null;

    if (!transcriptPath) {
      timer.end({ status: 'warn', exit: 0, note: 'no-transcript-path' });
      process.exit(0);
    }

    // Look back 3 real user turns: options printed in a recent turn (user replied
    // "ok" in between) count as seen — no forced reprint every turn.
    const { text, found } = extractCurrentTurnVisibleText(transcriptPath, 3);
    if (!found) {
      // Transcript missing / no real user turn yet — fail open
      timer.end({ status: 'warn', exit: 0, note: 'transcript-not-found' });
      process.exit(0);
    }

    // Check whether every named alternative was described in visible text
    const { pass, missingLabels } = checkVisibility(mode, text, questions);

    if (pass) {
      timer.end({ status: 'ok', exit: 0 });
      process.exit(0);
    }

    // Block: options were not described before the popup
    const message = formatBlockMessage(missingLabels);
    console.error(message);
    timer.end({ status: 'block', exit: 2, note: `missing:${missingLabels.length}` });
    process.exit(2);

  } catch (err) {
    // Inner unexpected error — fail open so the gate never disrupts normal workflow
    logHookCrash('decision-visibility-gate', err, { event: 'PreToolUse' });
    process.exit(0);
  }
} catch (e) {
  // Outer crash (require failed) — fail open
  try {
    const { logHookCrash } = require('./lib/hook-logger.cjs');
    logHookCrash('decision-visibility-gate', e, { event: 'PreToolUse' });
  } catch (_) {}
  process.exit(0);
}
