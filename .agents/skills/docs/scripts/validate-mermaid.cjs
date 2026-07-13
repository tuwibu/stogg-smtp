#!/usr/bin/env node
// Deterministic syntax guard for mermaid blocks inside generated docs (flows.md, *-flow.md).
// Catches the two recurring parse-error classes the LLM produces when hand-writing diagrams:
//   1. Unbalanced double-quotes on a label line  -> "Parse error ... got 'STR'"
//   2. Mismatched node bracket shapes ({...], [...}, (...] ...) in flowchart/graph
//      -> "Expecting 'DIAMOND_STOP' ... got 'SQE'"
// It does NOT try to be a full mermaid parser — only flags these high-confidence,
// low-false-positive structural defects so the generator can fix them before the file ships.
//
// Usage:  node validate-mermaid.cjs <file.md> [<file2.md> ...]
// Exit:   0 = clean, 1 = problems found (each printed as  <file>:<line>: <message>)

'use strict';
const fs = require('fs');

const CLOSE_TO_OPEN = { '}': '{', ']': '[', ')': '(' };
const OPENERS = new Set(['{', '[', '(']);

// Remove balanced "..." segments so brackets/pipes inside label text are ignored.
function stripQuoted(line) {
  return line.replace(/"[^"]*"/g, '');
}

function checkBrackets(line) {
  const stack = [];
  for (const ch of stripQuoted(line)) {
    if (OPENERS.has(ch)) {
      stack.push(ch);
    } else if (ch in CLOSE_TO_OPEN) {
      if (stack.length === 0 || stack.pop() !== CLOSE_TO_OPEN[ch]) {
        return `mismatched node bracket near '${ch}' (opener/closer shapes must match: {} [] ())`;
      }
    }
  }
  if (stack.length > 0) {
    return `unclosed node bracket '${stack[stack.length - 1]}' on this line`;
  }
  return null;
}

function blockType(contentLines) {
  for (const l of contentLines) {
    const t = l.trim().toLowerCase();
    if (t) return t;
  }
  return '';
}

function validateFile(file) {
  const problems = [];
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    return [{ line: 0, msg: `cannot read file: ${e.message}` }];
  }
  const lines = text.split(/\r?\n/);

  let inBlock = false;
  let blockStart = 0;
  let blockLines = [];
  let blockAbsStart = 0;

  const flushBlock = () => {
    const type = blockType(blockLines);
    const isFlowchart = type.startsWith('flowchart') || type.startsWith('graph');
    blockLines.forEach((raw, i) => {
      const absLine = blockAbsStart + i; // 1-based file line
      const line = raw.trim();
      if (!line || line.startsWith('%%')) return; // skip blank + mermaid comments
      // 1) quote parity — applies to every diagram type
      const quoteCount = (raw.match(/"/g) || []).length;
      if (quoteCount % 2 !== 0) {
        problems.push({ line: absLine, msg: `unbalanced double-quotes (${quoteCount} quote chars — must be even)` });
      }
      // 2) bracket matching — flowchart/graph only (sequence/ER/class/state use brackets differently or span lines)
      if (isFlowchart) {
        const b = checkBrackets(raw);
        if (b) problems.push({ line: absLine, msg: b });
      }
    });
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!inBlock && /^```\s*mermaid\s*$/i.test(trimmed)) {
      inBlock = true;
      blockStart = i;
      blockLines = [];
      blockAbsStart = i + 2; // first content line is the next file line (1-based)
      continue;
    }
    if (inBlock && /^```\s*$/.test(trimmed)) {
      flushBlock();
      inBlock = false;
      continue;
    }
    if (inBlock) blockLines.push(lines[i]);
  }
  if (inBlock) {
    problems.push({ line: blockAbsStart, msg: 'unterminated ```mermaid block (missing closing ```)' });
    flushBlock();
  }
  return problems;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('usage: node validate-mermaid.cjs <file.md> [...]');
    process.exit(2);
  }
  let total = 0;
  for (const file of files) {
    const problems = validateFile(file);
    for (const p of problems) {
      console.log(`${file}:${p.line}: ${p.msg}`);
    }
    total += problems.length;
  }
  if (total === 0) {
    console.log('OK — no mermaid syntax problems found');
    process.exit(0);
  }
  console.log(`\n${total} mermaid syntax problem(s) found — fix and re-run.`);
  process.exit(1);
}

main();
