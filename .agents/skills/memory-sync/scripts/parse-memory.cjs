'use strict';

/**
 * parse-memory.cjs — Frontmatter parser + CLI for the memory-sync skill.
 *
 * CLI usage:
 *   node parse-memory.cjs parse <file-path>
 *     → JSON: { id, type, created, updated, tags, supersedes, content } | { error }
 *
 *   node parse-memory.cjs dedup <json-string-of-fact-array>
 *     → JSON: { facts, exactRemoved, removedIds, supersededRemoved, ... } (see dedup.cjs)
 *
 *   node parse-memory.cjs find <keyword> [--dir <memory-dir>] [--type <t>] [--top N]
 *     → JSON: { keyword, memoryDir, matches: [{ id, file, score, type, updated }] }
 *       Similarity search for the update-over-create capture gate
 *       (see .codex/rules/business-fact-capture.md).
 *
 * No external dependencies. Pure Node.js CJS.
 */

const fs = require('fs');
const path = require('path');
const { parseFrontmatter, toSlug } = require('./yaml-frontmatter.cjs');
const { cmdDedup, toIdArray } = require('./dedup.cjs');

// ---------------------------------------------------------------------------
// Parse command — read one memory file, extract typed fact
// ---------------------------------------------------------------------------

function cmdParse(filePath) {
  const resolved = path.resolve(filePath);
  let raw;
  try {
    raw = fs.readFileSync(resolved, 'utf8');
  } catch (e) {
    return { error: `Cannot read file: ${e.message}` };
  }

  let frontmatter, body;
  try {
    ({ frontmatter, body } = parseFrontmatter(raw));
  } catch (e) {
    return { error: `Frontmatter parse failed: ${e.message}` };
  }

  if (!frontmatter) return { error: 'No frontmatter found' };

  const meta = frontmatter.metadata || {};
  const type = meta.type || frontmatter.type || null;
  if (!type) return { error: 'Missing metadata.type' };

  return {
    id: meta.id || path.basename(resolved, '.md'),
    type,
    created: meta.created || frontmatter.created || null,
    updated: meta.updated || frontmatter.updated || null,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    supersedes: toIdArray(meta.supersedes ?? frontmatter.supersedes),
    content: body,
  };
}

// ---------------------------------------------------------------------------
// Find command — similarity search for the update-over-create capture gate
// ---------------------------------------------------------------------------

/** Recursively collect *.md files under dir (returns [] if dir is missing). */
function walkMd(dir) {
  let out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walkMd(full));
    else if (e.isFile() && e.name.endsWith('.md') && e.name !== 'MEMORY.md') out.push(full);
  }
  return out;
}

const slugTokens = (text) => new Set(toSlug(text).split('-').filter(Boolean));

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Deterministic similarity in [0,1]: 0.5 slug-overlap + 0.3 tag-overlap + 0.2 substring. */
function scoreFact(keyword, fact) {
  const kwTokens = slugTokens(keyword);
  const idTokens = slugTokens(fact.id || (fact.content || '').split('\n')[0]);
  const slugScore = jaccard(kwTokens, idTokens);

  const kwTagged = new Set([...kwTokens]);
  const factTags = new Set((fact.tags || []).map((t) => toSlug(t)));
  let tagInter = 0;
  for (const t of factTags) if (kwTagged.has(t)) tagInter++;
  const tagScore = factTags.size ? tagInter / factTags.size : 0;

  const kwNorm = keyword.trim().toLowerCase();
  const substr = kwNorm && (fact.content || '').toLowerCase().includes(kwNorm) ? 1 : 0;

  return Math.round((0.5 * slugScore + 0.3 * tagScore + 0.2 * substr) * 1000) / 1000;
}

function cmdFind(keyword, opts = {}) {
  const memoryDir = path.resolve(opts.dir || path.join(process.cwd(), 'docs', 'memory'));
  const top = Number.isFinite(opts.top) ? opts.top : 5;
  const matches = [];
  for (const file of walkMd(memoryDir)) {
    const fact = cmdParse(file);
    if (fact.error || !fact.type) continue;
    if (opts.type && fact.type !== opts.type) continue;
    matches.push({ id: fact.id, file, score: scoreFact(keyword, fact), type: fact.type, updated: fact.updated });
  }
  matches.sort((a, b) => b.score - a.score);
  return { keyword, memoryDir, matches: matches.slice(0, top) };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function parseFlags(rest) {
  const out = { _: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--dir') out.dir = rest[++i];
    else if (a === '--type') out.type = rest[++i];
    else if (a === '--top') out.top = parseInt(rest[++i], 10);
    else out._.push(a);
  }
  return out;
}

function emit(result) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result && result.error) process.exit(1);
}

function main() {
  const [, , cmd, ...rest] = process.argv;

  if (cmd === 'parse') {
    if (!rest[0]) { process.stderr.write('Usage: parse-memory.cjs parse <file-path>\n'); process.exit(1); }
    emit(cmdParse(rest[0]));
    return;
  }

  if (cmd === 'dedup') {
    if (!rest[0]) { process.stderr.write('Usage: parse-memory.cjs dedup <json-facts-array>\n'); process.exit(1); }
    emit(cmdDedup(rest[0]));
    return;
  }

  if (cmd === 'find') {
    const flags = parseFlags(rest);
    if (!flags._[0]) { process.stderr.write('Usage: parse-memory.cjs find <keyword> [--dir d] [--type t] [--top N]\n'); process.exit(1); }
    emit(cmdFind(flags._[0], flags));
    return;
  }

  process.stderr.write('Usage: parse-memory.cjs <parse|dedup|find> <args>\n');
  process.exit(1);
}

module.exports = { cmdParse, cmdDedup, cmdFind, scoreFact };
if (require.main === module) main();
