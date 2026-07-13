# Business-Flows Workflow (`docs flows` mode)

## Purpose

Generate **cross-service business-process** docs under `docs/flows/<process>.md`. Unlike
`docs/services/<svc>/flows.md` (per-module kitchen-sink keyed by module name), each file here
describes **one named business process** — a focused, end-to-end narrative that may span **multiple
services/modules** (e.g. clone → lineage → proxy snapshot → die-cascade across `profiles` +
`proxies` + `automation`).

```
docs/flows/<process>.md   — human-facing, prose VN + mermaid, ONE business process, cross-service
```

**Granularity contrast (do not confuse):**

| File | Keyed by | Scope | Generator |
|---|---|---|---|
| `docs/services/<svc>/flows.md` | module name | the whole module (all flows) | `docs services` |
| `docs/flows/<process>.md` | **business-process name** | **one focused use-case, cross-service** | `docs flows` (this) |

A business process is almost always a **subset** of one module's flows plus slices of others — it is
NOT the union of whole modules. Write the focused story; link to `reference.md` for the rest.

**Audience / language:** human-facing. Prose, headings, and mermaid labels in **Vietnamese**; code
identifiers, paths, IDs, mermaid keywords, technical proper nouns in **English** (same rule as
`flows-workflow.md` → Language).

---

## Hybrid detection

A business process is a **business-judgment boundary** — it cannot be derived purely mechanically.
So detection is **hybrid**: auto-suggest candidates, but the **user-confirmed list is the source of
truth**. Candidate signals (nudges only, never authoritative):

1. **Existing curated files** — `docs/archive/flows/*` and `docs/subsystems/*` in the target repo.
   These are prior hand-authored process docs; surface their names as candidates.
   **Do NOT auto-import their content** — only propose the name. The user decides.
2. **Cross-module import edges** — a service in module A importing a service/util from module B
   signals an orchestrated flow crossing module boundaries.
3. **Shared scalar FK pattern** — a column like `source_*_id` / `*_ref_id` referenced across modules
   signals a lineage/relationship process worth documenting.

Build a proposed list, then:

→ **Always** confirm via `AskUserQuestion` (header `"Business Process List"`): show inferred
  candidates, let the user **add** processes the heuristics missed, **rename**, or **remove**. The
  user's final list drives generation. (Unlike service detection, never "proceed directly on high
  confidence" — process boundaries are conceptual and must be user-owned.)

---

## File template

`docs/flows/<process>.md` (kebab-case process name):

```
---
process: <process-name>
sources:
  - <relative path to module/file A involved>
  - <relative path to module/file B involved>
commit: <git rev-parse HEAD>
---

# <Process> — Luồng nghiệp vụ

<2-4 câu tiếng Việt: nghiệp vụ này làm gì, ai trigger, nối những service nào, sinh ra gì,
ràng buộc cốt lõi.>

## Luồng

\`\`\`mermaid
flowchart TD
  ...
\`\`\`

> Chi tiết kỹ thuật: [<svc> reference](../services/<svc>/reference.md)
```

- `sources` lists **only the files/dirs this process actually touches** (the focused subset), drawn
  from ≥1 module — this is what staleness checks diff against.
- End the file with one or more links to the involved services' `reference.md` for deep detail
  instead of inlining code-level specifics.

**Relevance gates — additional diagrams:** apply the gate table from `flows-workflow.md`
→ "Relevance gates — additional diagrams" verbatim (sequence / state / ER), reading "process" for
the cross-service case. Omit a gate's section entirely if not met. ≤ 12 nodes per diagram.

---

## Init mode (`docs flows`)

### Step 1 — Detect + confirm processes
Run hybrid detection above. Always confirm via `AskUserQuestion`.

### Step 2 — Capture HEAD commit
```bash
git rev-parse HEAD
```
Store as `<head-commit>` for each file's frontmatter. No commits → `"initial"`.

### Step 3 — Generate per-process files
For each confirmed process, write `docs/flows/<process>.md` using the template. Source the narrative
+ diagram from the cited files. Keep it a focused subset, not a module dump.

### Step 4 — Validation gate (MANDATORY)
After writing each file, run the deterministic checker and fix every reported line until `OK`:
```bash
node .codex/skills/docs/scripts/validate-mermaid.cjs docs/flows/<process>.md
```

---

## Update mode (`docs flows --update`)

### Step 1 — Staleness check
For each `docs/flows/<process>.md`:
1. Read frontmatter `commit` + `sources`.
2. `git diff --name-only <commit>..HEAD -- <sources>`.
3. Non-empty → regenerate the file (update `commit` to HEAD). Empty → skip.

### Step 2 — New processes
Re-run detection; any confirmed process without a file → create it (init Step 3).

### Step 3 — Removed sources
If a file's `sources` paths no longer exist → warn the user (which file, which paths). Do NOT
auto-delete; the user decides whether to remove or remap.

---

## Mechanism reuse (link to flows-workflow)

This workflow does **not** re-define the shared mechanism. It reuses `flows-workflow.md` for:

- **Mermaid label safety (MANDATORY)** — quote every edge label + node text, balanced quotes,
  matched bracket shapes. Apply verbatim before writing any file.
- **Validation gate** — `validate-mermaid.cjs` run-fix-rerun loop.
- **Staleness mechanism + Fallbacks** — `git diff <commit>..HEAD -- <sources>`; full regeneration on
  no-git / shallow clone / `"initial"` / corrupt commit (warn user first).
- **Relevance gates** — the sequence / state / ER gate table (read "process" for cross-service).
- **Language** rules.

Base-path for this caller is `docs/flows/` with file pattern `docs/flows/<process>.md` (keyed by
process, NOT by domain/module). Do NOT fork the mechanism — reference it.

---

## Output location

```
docs/flows/
├── <process-a>.md
├── <process-b>.md
└── ...
```

`docs/flows/` is created on first write if absent. This directory is owned exclusively by
`docs flows` (cross-service business processes). `docs init/update --preview` no longer writes here.
