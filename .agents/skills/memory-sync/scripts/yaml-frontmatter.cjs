'use strict';

/**
 * yaml-frontmatter.cjs — Minimal YAML frontmatter parser for memory fact files.
 *
 * Supports: string scalars, inline arrays [a, b], nested metadata.* pattern.
 * No external dependencies. Pure Node.js CJS.
 *
 * Exported: parseFrontmatter(raw), parseYamlValue(v), toSlug(text), normalize(text)
 */

// ---------------------------------------------------------------------------
// Core parser
// ---------------------------------------------------------------------------

/**
 * Parse YAML frontmatter from raw markdown string.
 * @returns {{ frontmatter: object|null, body: string }}
 */
function parseFrontmatter(raw) {
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = FM_RE.exec(raw);
  if (!match) return { frontmatter: null, body: raw };

  const yamlBlock = match[1];
  const body = (match[2] || '').trim();
  const fm = {};

  let currentParent = null;
  for (const line of yamlBlock.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Nested key (2-space indent under a mapping parent)
    const nestedMatch = /^  (\w[\w-]*):\s*(.*)$/.exec(line);
    if (nestedMatch && currentParent) {
      const [, k, v] = nestedMatch;
      fm[currentParent][k] = parseYamlValue(v);
      continue;
    }

    // Top-level key
    const topMatch = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (topMatch) {
      const [, k, v] = topMatch;
      if (v === '' || v == null) {
        fm[k] = {};
        currentParent = k;
      } else {
        fm[k] = parseYamlValue(v);
        currentParent = null;
      }
    }
  }

  return { frontmatter: fm, body };
}

/**
 * Parse a single YAML scalar or inline array value.
 * @param {string} v
 * @returns {string|string[]|boolean}
 */
function parseYamlValue(v) {
  v = String(v || '').trim();
  // Inline array: [a, b, c]
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
  }
  // Quoted string — only strip when the SAME quote char wraps both ends
  // (a character-class regex would wrongly strip mismatched 'value" pairs).
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

// ---------------------------------------------------------------------------
// String helpers used by dedup
// ---------------------------------------------------------------------------

/**
 * Derive a URL-safe slug from text (max 60 chars).
 * Used for heuristic duplicate detection by title/id similarity.
 */
function toSlug(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Normalize text for exact-duplicate comparison.
 * Collapses whitespace and lowercases.
 */
function normalize(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

module.exports = { parseFrontmatter, parseYamlValue, toSlug, normalize };
