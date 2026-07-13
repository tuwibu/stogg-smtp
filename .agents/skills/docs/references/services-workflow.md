# Services Workflow (`docs services` mode)

## Purpose

Generate per-service documentation under `docs/services/<svc>/`. Each detected service gets three
files:

```
docs/services/<svc>/
├── reference.md    — AI-facing, dense, code-level (symbol map, file pointers, invariants, API, gotchas)
├── flows.md   — business-flow diagram; reuses flows-workflow.md mechanism at base-path docs/services/<svc>/
└── scenarios.md    — edge-case catalogue generated via the `scenario` skill (description only, NOT a test runner)
```

**AI-facing vs human-facing distinction:**
- `reference.md` → AI-facing. Dense, code-level, grep-optimised. Header line marks purpose. Not prose. **English** (translating hurts LLM grep accuracy on `file:line`/symbol lookups).
- `flows.md` → machine + human readable. Markdown wrapper: frontmatter (commit + sources), `# heading`, prose summary, fenced ` ```mermaid ` block — renders in GitHub/IDE. **Prose + mermaid labels in Vietnamese** (per flows-workflow.md → Language).
- `scenarios.md` → human-readable risk register. Produced by `/scenario` output, not a gate. **Vietnamese descriptions.**

**Language summary:** `reference.md` = English; `flows.md` + `scenarios.md` = Vietnamese prose/labels, English for code identifiers, IDs, paths, technical terms.

---

## Service Detection

Per-module directory-scan detection (applied to the `.codex/` tree, or `src/` if present). This is
the self-contained service-detection heuristic for this mode:

1. Examine each top-level subdirectory under the detected root (`src/`, `.codex/`, project root).
2. A directory qualifies as a **service** if it contains ≥ 2 files matching any of:
   - `*service*`, `*handler*`, `*repository*`, `*repo*`, `*controller*`, `*manager*`, `*processor*`
   - OR ≥ 4 `.ts` / `.js` / `.cjs` / `.py` files (language-agnostic fallback)
3. Exclude test-only dirs (`__tests__`, `fixtures`, `mocks`, `test`, `spec`).
4. Build proposed list: `[<svc-name>, ...]` using the directory name as-is (kebab-case normalised).

**Ambiguous structure** (flat repo, fewer than 2 qualifying dirs, unclear grouping):
→ `AskUserQuestion` (header `"Service List"`) — show inferred list, let user confirm / edit before
  proceeding.

**Clear structure** (≥ 80% confidence):
→ Proceed directly; note inferred list in the silent-decisions block.

---

## Init mode (`docs services`)

### Step 1 — Detect services

Run detection above. Confirm or ask.

### Step 2 — Capture HEAD commit

```bash
git rev-parse HEAD
```

Store as `<head-commit>`. Used in `flows.md` frontmatter. If no commits → use `"initial"`.

### Step 3 — Generate per-service files

For each confirmed service `<svc>`, create `docs/services/<svc>/` and write three files:

#### 3a. `reference.md`

Apply the template in `service-reference-template.md`. Base-path for reading sources: the service
directory itself. Population strategy:
1. Glob all non-test files in the service dir.
2. Read entry points (index, main export, or the largest file by LOC) first.
3. Extract public exports, classes, functions → Symbol map.
4. Note key constraints visible from code (types, ordering guards, mutex patterns) → Key invariants.
5. Extract public API surface (exported function signatures, REST routes, CLI commands).
6. Note non-obvious traps found in comments, error handling, or complex conditionals → Gotchas.

Keep each section dense and code-level. No narrative paragraphs. Every entry links to `file:line`.

#### 3b. `flows.md`

Delegated to the **flows-workflow mechanism** (see below — Base-path parameterisation). The file
produced is `docs/services/<svc>/flows.md` — a real markdown file that renders in GitHub/IDE:
frontmatter, a `# heading`, a short prose summary, then the diagram inside a fenced ` ```mermaid `
block. Same markdown wrapping as `docs/flows/<process>.md`. Do NOT write raw mermaid without the
fenced block (a bare `.mermaid`-style body does not render).

**File template:**

```
---
domain: <svc-name>
sources:
  - <relative path to service dir>
commit: <head-commit>
---

# <Svc> — Business Flow

<2-4 sentence plain-English summary: what this service does, who triggers it, what it produces.>

## Flow

\`\`\`mermaid
flowchart TD
  ...
\`\`\`
```

No `--preview` opt-in required for this file. The `docs services` mode generates `flows.md`
**automatically** (per the exception in `business-flow-diagram.md`). See that rule for scope limits.

Relevance gates (same as flows-workflow):
- Sequence diagram: cross ≥ 2 distinct actors/services.
- State diagram: core entity has ≥ 3 lifecycle states.
- ER snippet: domain owns ≥ 3 related entities.
If gate not met → omit that block entirely.

≤ 12 nodes per diagram. Syntax per `mermaidjs-v11` reference (do NOT invoke as generator).
**Apply the "Mermaid label safety (MANDATORY)" rules from `flows-workflow.md`** — always quote every
edge label and node text, balanced quotes, matched node bracket shapes (`{…}` `[…]` `(…)`, never
`{…]`), before writing the file. This prevents "Parse error on line N" from unquoted `/`, `(`, `)`,
`<br/>`, `${...}` and from mismatched diamond/rectangle brackets.

**After writing `flows.md`, run the validation gate (MANDATORY):**

```bash
node .codex/skills/docs/scripts/validate-mermaid.cjs docs/services/<svc>/flows.md
```

Fix every `file:line` it reports and re-run until it prints `OK`. Same checker and loop as
`flows-workflow.md` → "Validation gate".

#### 3c. `scenarios.md`

Invoke the `scenario` skill against the service directory or its primary entry file:

```
/scenario <service-dir> --format test-scenarios
```

Take the one-shot output table and wrap it. **Write all scenario descriptions in Vietnamese**
(keep code identifiers, paths, technical terms in English); translate the `/scenario` output prose
to Vietnamese when pasting:

```markdown
<!-- AI: edge-case register generated by /scenario. Description only — not a test runner. -->
# <Svc> — Kịch bản & Edge Case

> Nguồn: output `/scenario <service-dir>`. Tạo lại khi logic service thay đổi đáng kể.
> File này là danh mục rủi ro, KHÔNG phải test suite chạy được.

[paste scenario table here — mô tả bằng tiếng Việt]
```

Filter to dimensions relevant to the service type (e.g. auth service → dimensions 2, 3, 8, 11;
pure util service → dimensions 2, 3, 7).

---

## Update mode (`docs services --update`)

### Step 1 — Staleness check (flows.md)

For each `docs/services/<svc>/flows.md`:

1. Read frontmatter `commit` and `sources`.
2. Run:
   ```bash
   git diff --name-only <commit>..HEAD -- <sources>
   ```
3. Non-empty diff → regenerate `flows.md` (update `commit` to HEAD).
4. Empty diff → skip (no changes to diagram).

This is identical to `flows-workflow.md` → "Update mode" → "Step 1: Staleness check", applied with
base-path `docs/services/<svc>/` instead of `docs/flows/`.

### Step 2 — Staleness check (reference.md)

1. Read `commit` from `flows.md` frontmatter (shared per-service staleness source).
2. Same `git diff` check against the service dir.
3. Non-empty → regenerate `reference.md` from scratch using the template.
4. Empty → skip.

### Step 3 — Staleness check (scenarios.md)

Scenarios are regenerated only if the user explicitly runs:

```
docs services --update --scenarios
```

Otherwise skip — scenario tables are stable until the service's core logic changes.

### Step 4 — New services

Compare detected service list against existing `docs/services/` subdirs. Any new service →
create all three files (same as init Step 3).

### Step 5 — Removed services

If a `docs/services/<svc>/` exists but its source dir is gone:
→ Warn user (one line: which svc, which missing path).
→ Do NOT auto-delete. User decides.

---

## Base-path parameterisation (link to flows-workflow)

`flows-workflow.md` describes the canonical mermaid generation and staleness mechanism. When this
workflow invokes that mechanism, replace the base-path as follows:

| flows-workflow base-path | This workflow substitutes |
|---|---|
| `<base-path>/` | `docs/services/<svc>/` |
| `<base-path>/<file>` | `docs/services/<svc>/flows.md` |
| Phase 3 size check glob | `docs/services/*/flows.md` |

All other rules (commit capture, git diff staleness, fallback on shallow clone, no parallel pipeline,
≤ 12 nodes, relevance gates, mermaid label safety, validation gate) apply unchanged. Do NOT
duplicate or fork that logic.

`flows-workflow.md` is a pure shared mechanism with no `--preview` opt-in — nothing gate-related
applies here. See the per-service exception in `business-flow-diagram.md` for the precise scope.

---

## Fallbacks

Same fallback conditions as flows-workflow (no git, shallow clone, missing commit field, corrupt
hash) → full regeneration of all three files for every detected service. Warn user first.

---

## Output location

```
docs/services/
├── <svc-a>/
│   ├── reference.md
│   ├── flows.md
│   └── scenarios.md
├── <svc-b>/
│   ├── reference.md
│   ├── flows.md
│   └── scenarios.md
└── ...
```

`docs/services/` is created on first write if absent. Each `<svc>/` subdir created per service.
