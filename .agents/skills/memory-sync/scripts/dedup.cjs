'use strict';

/**
 * dedup.cjs — Fact deduplication + supersede resolution for memory-sync.
 *
 * Split out of parse-memory.cjs to keep each file focused (< 200 LOC). The CLI
 * entry point stays in parse-memory.cjs (`parse-memory.cjs dedup <json>`), which
 * delegates here.
 *
 * No external dependencies. Pure Node.js CJS.
 */

const { toSlug, normalize } = require('./yaml-frontmatter.cjs');

/** Coerce a frontmatter supersedes value (string | array | undefined) to a string[]. */
function toIdArray(value) {
  if (value == null) return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map((v) => String(v).trim()).filter(Boolean);
}

/** Strip a trailing version suffix (`-v2`, `-3`) so `pricing-v1` and `pricing-v2` share a root. */
function idRoot(id) {
  return String(id || '').replace(/-v?\d+$/i, '');
}

/** Stable key for an unordered pair of fact ids (dedupe possibleDupes across signals). */
function pairKey(a, b) {
  return [String(a), String(b)].sort().join('::');
}

function cmdDedup(jsonStr) {
  let facts;
  try {
    facts = JSON.parse(jsonStr);
  } catch (e) {
    return { error: `Invalid JSON input: ${e.message}` };
  }

  if (!Array.isArray(facts)) return { error: 'Input must be a JSON array' };

  // --- Resolve supersedes: a present fact retires any fact it supersedes ---
  // Runs BEFORE exact-dedup so a superseded copy never wins the "keep newest"
  // comparison. Dangling refs (supersedes an id nobody carries) are surfaced,
  // never used to drop a fact — memory shrinks only on explicit, resolvable intent.
  const presentIds = new Set(facts.map((f) => f.id).filter(Boolean));
  const supersededIds = new Set();
  const danglingSupersedes = [];
  for (const f of facts) {
    for (const ref of toIdArray(f.supersedes)) {
      if (presentIds.has(ref)) supersededIds.add(ref);
      else danglingSupersedes.push({ id: f.id || '?', missingRef: ref });
    }
  }
  const supersededRemovedIds = facts
    .filter((f) => f.id && supersededIds.has(f.id))
    .map((f) => f.id);
  facts = facts.filter((f) => !(f.id && supersededIds.has(f.id)));

  // --- Exact dedup: normalize content, keep most-recently updated copy ---
  const exactSeen = new Map(); // normalizedContent -> index of best
  const exactRemoved = [];

  // Facts with no content can't be deduplicated by content — keep them as-is
  // (never silently drop a real fact; that would violate the fail-open contract).
  const keptNoContent = new Set();

  for (let i = 0; i < facts.length; i++) {
    const f = facts[i];
    const key = normalize(f.content || '');
    if (!key) { keptNoContent.add(i); continue; }

    if (exactSeen.has(key)) {
      const prevIdx = exactSeen.get(key);
      const prev = facts[prevIdx];
      if ((f.updated || '') > (prev.updated || '')) {
        exactRemoved.push(prev.id || prevIdx);
        exactSeen.set(key, i);
      } else {
        exactRemoved.push(f.id || i);
      }
    } else {
      exactSeen.set(key, i);
    }
  }

  const keptIndices = new Set([...exactSeen.values(), ...keptNoContent]);
  const deduped = facts.filter((_, i) => keptIndices.has(i));

  // --- Heuristic dedup: flag possible duplicates, do NOT remove ---
  const possibleDupes = [];
  const flaggedPairs = new Set();
  const flag = (a, b, slug, reason) => {
    const key = pairKey(a, b);
    if (flaggedPairs.has(key)) return;
    flaggedPairs.add(key);
    possibleDupes.push({ slug, a, b, reason });
  };

  // Signal 1: same id/title slug.
  const slugMap = new Map();
  for (const f of deduped) {
    const slug = toSlug(f.id || (f.content || '').split('\n')[0]);
    if (!slugMap.has(slug)) slugMap.set(slug, []);
    slugMap.get(slug).push(f);
  }
  for (const [slug, group] of slugMap.entries()) {
    for (let a = 0; a < group.length - 1; a++)
      for (let b = a + 1; b < group.length; b++)
        flag(group[a].id || '?', group[b].id || '?', slug, 'same title slug');
  }

  // Signal 2: same id-root (version-suffix stripped) — catches conflicting
  // facts whose first lines differ (e.g. flow-checkout-2 vs flow-checkout-3).
  const rootMap = new Map();
  for (const f of deduped) {
    const root = idRoot(f.id || (f.content || '').split('\n')[0]);
    if (!root) continue;
    if (!rootMap.has(root)) rootMap.set(root, []);
    rootMap.get(root).push(f);
  }
  for (const [root, group] of rootMap.entries()) {
    for (let a = 0; a < group.length - 1; a++)
      for (let b = a + 1; b < group.length; b++)
        flag(group[a].id || '?', group[b].id || '?', toSlug(root), 'id-root');
  }

  // Signal 3: >=2 shared tags — reworded contradictions on the same topic.
  for (let a = 0; a < deduped.length - 1; a++) {
    const tagsA = new Set((deduped[a].tags || []).map((t) => String(t).toLowerCase()));
    if (tagsA.size < 2) continue;
    for (let b = a + 1; b < deduped.length; b++) {
      const shared = (deduped[b].tags || [])
        .map((t) => String(t).toLowerCase())
        .filter((t) => tagsA.has(t));
      if (shared.length >= 2)
        flag(deduped[a].id || '?', deduped[b].id || '?', shared.slice(0, 3).join(','), 'shared-tags');
    }
  }

  return {
    facts: deduped,
    exactRemoved: exactRemoved.length,
    // removedIds = every id dropped (exact-dupe + superseded) so a downstream
    // consumer reading only this field still treats superseded facts as gone.
    removedIds: [...exactRemoved, ...supersededRemovedIds],
    supersededRemoved: supersededRemovedIds.length,
    supersededRemovedIds,
    danglingSupersedes,
    possibleDupes,
  };
}

module.exports = { cmdDedup, toIdArray, idRoot, pairKey };
