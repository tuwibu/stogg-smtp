---
name: memory-sync
description: "Read MEMORY.md index + per-fact memory files, group by metadata.type, deduplicate (exact + heuristic), and emit a structured consolidated summary ready for business-doc generation."
user-invocable: true
when_to_use: "Invoke before generating or reconciling business docs to produce a clean, deduplicated memory snapshot. Feed output into /docs business-sync."
category: utilities
keywords: [memory, consolidate, dedup, summary, business-docs, fact-merge]
argument-hint: "[memory-dir] [--json] [--dry-run]"
metadata:
  author: claudekit
  version: "1.0.0"
---

# Memory Sync

Read the Codex memory index (`MEMORY.md`) and per-fact files in a given memory directory,
group facts by `metadata.type`, deduplicate entries, and emit a structured summary.

Output feeds directly into `/docs business-sync` (see
`.codex/skills/docs/references/business-sync-workflow.md`).

---

## Arguments

| Argument | Default | Description |
|---|---|---|
| `memory-dir` | auto-detected (see Detection below) | Path to the memory directory containing `MEMORY.md` |
| `--json` | off | Emit JSON summary instead of markdown prose |
| `--dry-run` | off | Show what would be consolidated; write nothing |

---

## Memory System Convention

Per-fact memory files use YAML frontmatter:

```yaml
---
metadata:
  type: user | feedback | project | reference
  id: <slug>
  created: <ISO date>
  updated: <ISO date>
  tags: [...]
  supersedes: <id> | [<id>, ...]   # optional — retires the referenced fact(s)
---
<fact content in markdown>
```

`MEMORY.md` is the index file listing each per-fact file with a one-line description.

`supersedes` marks that this fact **replaces** an older one: consolidate drops the referenced fact
from output (it never reaches business docs). A `supersedes` pointing at a missing id is surfaced as
`danglingSupersedes`, never used to delete anything.

## Capture (update-over-create)

Before creating a **new** `project`/`reference` fact, you MUST run the similarity search and prefer
updating an existing file over spawning a divergent copy — the gate is defined in
`.codex/rules/business-fact-capture.md`:

```bash
node scripts/parse-memory.cjs find "<keyword>" --dir <memory-dir> --type project --top 5
```

Top match `score ≥ 0.6` → edit that file (bump `updated`, set `supersedes` if meaning changes);
`< 0.6` → create new. This is the write-side counterpart to the reconcile the consolidate/dedup
pipeline does on the read-side.

---

## Workflow

### Step 1 — Detect memory directory

Search in order:

Two sources, split by fact **type** — read BOTH and merge:

- **Business facts** (`type: project | reference`) → repo-local **`<project-root>/docs/memory/`**
  (override via `.ck.json` → `memory.businessDir`, default `docs/memory`). Under `docs/` (NOT
  `.codex/`, which is wiped on claudekit re-init) so business-rule changes are versioned and survive
  kit updates.
- **Personal facts** (`type: user | feedback`) → machine-local
  `~/.codex/projects/<project-slug>/memory/`.

Explicit `memory-dir` argument overrides detection and is read as a single source (both buckets).

If neither source has `MEMORY.md` / any fact file → print one-line warning and emit an empty
consolidated summary (do not abort — `business-sync` must handle the empty case gracefully). A repo
with no `docs/memory/` yet is normal (code-only path still runs).

### Step 2 — Parse MEMORY.md index

Read `MEMORY.md` line by line. Extract references to per-fact files (lines starting with `-`,
containing a relative path). Build an ordered list of `{ path, label }` pairs.

If `MEMORY.md` is absent → use `scripts/parse-memory.cjs` to glob all `*.md` files in the
memory directory that contain `metadata.type` frontmatter.

### Step 3 — Read per-fact files

For each entry from Step 2:

1. Read the file.
2. Parse YAML frontmatter (use `scripts/parse-memory.cjs`).
3. Extract: `{ id, type, created, updated, tags, supersedes, content }`.
4. Skip files where frontmatter is missing or `type` is absent — log a warning per file.

### Step 4 — Group by type

Group facts into four buckets:

```
user        — facts about the user's preferences, habits, identity
feedback    — past feedback on Codex outputs (quality, style, corrections)
project     — project-specific facts (stack, decisions, constraints, goals)
reference   — external references (docs, URLs, spec links, third-party context)
```

Unknown `type` values → place in `other` bucket, log warning.

### Step 5 — Deduplicate (exact + heuristic)

Run `scripts/parse-memory.cjs dedup` on each bucket:

**Exact dedup:** normalize each entry (strip leading/trailing whitespace, collapse internal
whitespace, lowercase) → compute string identity → drop exact duplicates, keep the most recently
`updated` copy.

**Heuristic dedup:** within each bucket, compare entry titles/first lines after normalization.
If two entries share the same slug (derived from the first line: lowercase, non-alphanumeric →
`-`, max 60 chars) → treat as near-duplicate. Surface the pair for human review in the summary
`## Possible Duplicates` section. Do NOT auto-merge heuristic duplicates.

### Step 6 — Emit consolidated summary

#### Markdown output (default)

```markdown
# Consolidated Memory Summary

> Generated: <ISO timestamp>
> Memory dir: <path>
> Facts read: <N> | Exact dupes removed: <N> | Possible dupes flagged: <N>

## User
- **<id>** (`updated: <date>`): <first 120 chars of content>
...

## Feedback
...

## Project
...

## Reference
...

## Possible Duplicates (human review required)
| Bucket | Entry A | Entry B | Similarity |
|---|---|---|---|
| project | <slug-a> | <slug-b> | same title |
...

## Skipped
- <file>: <reason>
```

#### JSON output (`--json`)

```json
{
  "generated": "<ISO>",
  "memoryDir": "<path>",
  "stats": { "read": N, "exactDupesRemoved": N, "heuristicDupesFlagged": N },
  "groups": {
    "user": [{ "id": "", "type": "", "created": "", "updated": "", "tags": [], "content": "" }],
    "feedback": [...],
    "project": [...],
    "reference": [...],
    "other": [...]
  },
  "possibleDuplicates": [{ "bucket": "", "a": "", "b": "", "reason": "" }],
  "skipped": [{ "file": "", "reason": "" }]
}
```

---

## Dedup Script

`scripts/parse-memory.cjs` handles frontmatter parsing and dedup logic. It is a plain Node.js
CJS module (no external deps) callable as:

```bash
node .codex/skills/memory-sync/scripts/parse-memory.cjs parse <file>
node .codex/skills/memory-sync/scripts/parse-memory.cjs dedup <json-facts-array>
node .codex/skills/memory-sync/scripts/parse-memory.cjs find <keyword> [--dir d] [--type t] [--top N]
```

Dedup logic (supersede resolution + exact + widened heuristic) lives in `scripts/dedup.cjs`;
`parse-memory.cjs` is the CLI + parse + find. `dedup` output adds `supersededRemoved`,
`supersededRemovedIds`, `danglingSupersedes` alongside the existing `facts`/`removedIds`/`possibleDupes`.

See the script for exact I/O contract.

---

## Integration with `/docs business-sync`

After `memory-sync` emits its summary, pass the output path (or pipe JSON) to
`/docs business-sync`:

```
/docs business-sync --memory-summary <path-to-summary.json>
```

`business-sync` reads the consolidated groups and generates/reconciles business docs under
`docs/services/<svc>/`. See `.codex/skills/docs/references/business-sync-workflow.md`.

---

## Error handling

| Condition | Behavior |
|---|---|
| `MEMORY.md` not found | Warn + emit empty summary; do not abort |
| Per-fact file parse error | Log warning per file; skip; continue |
| No facts after filtering | Emit summary with zero-count stats; warn downstream |
| Unknown `type` field | Bucket into `other`; log warning |

---

## References

- `.codex/skills/docs/references/business-sync-workflow.md` — downstream consumer of this skill's output
- `.codex/skills/docs/references/services-workflow.md` — target doc structure in `docs/services/<svc>/`
- `.codex/skills/docs/SKILL.md` — `business-sync` mode entry point
