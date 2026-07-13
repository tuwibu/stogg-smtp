'use strict';

/**
 * Transcript Visible Text - Extract current-turn visible assistant text from session JSONL
 * @module transcript-visible-text
 *
 * Reads a Claude Code transcript JSONL file synchronously, locates the last real user
 * message (non-tool_result), then concatenates all 'text' blocks from assistant entries
 * that follow it. Thinking, tool_use, and redacted_thinking blocks are excluded.
 *
 * Returns { text: string, found: boolean }. Never throws — on any error returns
 * { text: '', found: false } so callers can fail open.
 */

const fs = require('fs');

/**
 * Determine whether a user-role entry is a "real" turn boundary (human typed it)
 * vs a machine-generated tool_result entry (user-role but not human input).
 *
 * A user entry is real when its content is:
 *   - a string (raw text), OR
 *   - an array that contains at least one block that is NOT type 'tool_result'
 *
 * @param {object} entry - Parsed JSONL entry
 * @returns {boolean}
 */
function isRealUserMessage(entry) {
  if (!entry || entry.type !== 'user') return false;
  const content = entry.message && entry.message.content;
  if (typeof content === 'string') return true;
  if (!Array.isArray(content)) return false;
  // Real user message has at least one non-tool_result block
  return content.some(block => block && block.type !== 'tool_result');
}

/**
 * Extract all visible text from an assistant entry's content array.
 * Includes only type='text' blocks; skips thinking, tool_use, redacted_thinking.
 *
 * @param {object} entry - Parsed JSONL entry with type='assistant'
 * @returns {string} Concatenated visible text (may be empty)
 */
function extractAssistantVisibleText(entry) {
  const content = entry.message && entry.message.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(block => block && block.type === 'text')
    .map(block => (typeof block.text === 'string' ? block.text : ''))
    .join('');
}

/**
 * Extract visible assistant text for the current turn from a transcript JSONL file.
 *
 * Algorithm:
 *   1. Read and parse the JSONL file line by line (skip bad lines defensively).
 *   2. Walk entries to find the boundary: the Nth-from-last real user message index
 *      (N = lookbackTurns, default 1 = current turn only).
 *   3. Concatenate text from all assistant entries after that index.
 *
 * lookbackTurns > 1 lets callers accept content the user already saw in recent
 * turns (e.g. options printed last turn, user replied "ok", AI now asks) instead
 * of demanding a reprint every turn.
 *
 * @param {string} transcriptPath - Absolute path to the JSONL transcript file
 * @param {number} [lookbackTurns=1] - How many real user turns to look back
 * @returns {{ text: string, found: boolean }}
 *   found=true  → a real user message was located (text may still be empty)
 *   found=false → file missing, unreadable, corrupt, or no real user message exists
 */
function extractCurrentTurnVisibleText(transcriptPath, lookbackTurns) {
  try {
    const raw = fs.readFileSync(transcriptPath, 'utf8');
    const lines = raw.split('\n');

    // Parse entries defensively — skip lines that are empty or unparseable
    const entries = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed));
      } catch (_) {
        // Skip corrupt line; continue processing the rest
      }
    }

    // Find the boundary: the Nth-from-last real user message index
    const turns = Number.isInteger(lookbackTurns) && lookbackTurns > 0 ? lookbackTurns : 1;
    const realUserIndexes = [];
    for (let i = 0; i < entries.length; i++) {
      if (isRealUserMessage(entries[i])) {
        realUserIndexes.push(i);
      }
    }
    const lastRealUserIdx = realUserIndexes.length > 0
      ? realUserIndexes[Math.max(0, realUserIndexes.length - turns)]
      : -1;

    if (lastRealUserIdx === -1) {
      // No real user message found (empty file, all entries are tool_results, etc.)
      return { text: '', found: false };
    }

    // Collect visible text from all assistant entries after the last real user message
    let text = '';
    for (let i = lastRealUserIdx + 1; i < entries.length; i++) {
      const entry = entries[i];
      if (entry && entry.type === 'assistant') {
        text += extractAssistantVisibleText(entry);
      }
    }

    return { text, found: true };
  } catch (_) {
    // Any I/O or unexpected error → fail open
    return { text: '', found: false };
  }
}

module.exports = { extractCurrentTurnVisibleText };
