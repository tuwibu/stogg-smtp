---
name: profile
description: "Measure real performance — Lighthouse/Core Web Vitals + bundle size for web FE, CPU flame graphs and heap snapshots for Node services, time/memory for generic scripts. Outputs a numeric metric table with baseline diff, then recommends optimization targets. Does NOT modify code — measure and advise only."
license: MIT
argument-hint: "[path or URL] [--baseline | --compare | --runs N]"
user-invocable: true
category: dev-tools
keywords:
  - performance
  - profiling
  - lighthouse
  - bundle-size
  - heap
  - flamegraph
  - core-web-vitals
  - benchmark
related:
  - loop
  - debug
  - frontend-design
maturity: stable
metadata:
  author: claudex-kit
  version: "1.0.0"
when_to_use: "Use /profile when you need measured numbers before optimizing — 'why is this slow?', 'what's the bundle size?', 'where is CPU time going?', 'baseline before refactor'. NOT for style/correctness reviews — use /code-review for that."
---

# Performance Profiling

You measure. You do not guess. You do not modify code. Every recommendation must trace to a metric row in the output table — no metric, no recommendation.

## Cardinal Rules

1. **Measure first, suggest second.** No "probably slow because…" without a number.
2. **Do NOT touch source files.** This skill is read-only on the codebase.
3. **Non-determinism is real.** Variance ≥ 10 % on any metric → run multiple times, report median + p95.
4. **Fail-soft on missing tools.** Detect → print install instructions → continue with available tools.
5. **Baseline discipline.** If a `.profile-baseline.json` exists, diff against it. If not, offer to save the current run as a new baseline.

---

## Project-Type Decision Tree

```
/profile invoked
│
├─ Has package.json?
│   ├─ Has "next" / "vite" / "webpack" / "esbuild" / "rollup" / "parcel" in deps?
│   │   └─ → Web FE path (Lighthouse + bundle analyzer)
│   │
│   └─ Has "express" / "fastify" / "koa" / "hapi" / "nestjs" / no browser-targeted scripts?
│       └─ → Node service path (--prof / clinic / heap snapshot)
│
├─ Has go.mod / Cargo.toml / requirements.txt / pom.xml (no package.json)?
│   └─ → Generic path (hyperfine / time + /usr/bin/time memory)
│
└─ No project manifest (or user passed a URL)?
    └─ → Web URL path (Lighthouse against the live URL)
```

When ambiguous (e.g. Next.js is also a Node server), run **both** Web FE and Node service paths, section the report accordingly.

---

## Web FE Path

### Step 1 — Lighthouse

```bash
# Install check (detect, don't assume)
npx lighthouse --version 2>/dev/null || echo "MISSING: npm install -g lighthouse"

# Against localhost (start dev server first if needed)
npx lighthouse http://localhost:3000 \
  --output=json \
  --output-path=./lighthouse-report.json \
  --chrome-flags="--headless" \
  --only-categories=performance

# Against production URL
npx lighthouse https://your-site.com \
  --output=json \
  --output-path=./lighthouse-report.json \
  --chrome-flags="--headless"
```

**Non-determinism mitigation:** run 3 times (`--runs 3` if using `lhci`), report median score + p95 for LCP/TBT/CLS.

**Parse targets from JSON output:**
- `audits['first-contentful-paint'].numericValue` → FCP (ms)
- `audits['largest-contentful-paint'].numericValue` → LCP (ms)
- `audits['total-blocking-time'].numericValue` → TBT (ms)
- `audits['cumulative-layout-shift'].numericValue` → CLS (unitless)
- `audits['speed-index'].numericValue` → SI (ms)
- `categories.performance.score` × 100 → overall score (0–100)

### Step 2 — Bundle Analyzer

Detect bundler from `package.json` scripts or config files, then run:

| Bundler | Analysis command |
|---------|-----------------|
| **webpack** | `npx webpack-bundle-analyzer stats.json` (generate stats: `npx webpack --profile --json > stats.json`) |
| **esbuild** | `npx esbuild-visualizer --metadata=esbuild-meta.json --filename=stats.html` (generate meta: add `metafile: true` to build script) |
| **rollup** | `npx rollup-plugin-visualizer` (add plugin to rollup config, build once) |
| **Vite** | `npx vite-bundle-visualizer` or `ANALYZE=true npx vite build` (with rollup-plugin-visualizer pre-installed) |
| **Next.js** | `ANALYZE=true npx next build` (requires `@next/bundle-analyzer` in next.config) |
| **Parcel** | Built-in: `parcel build --detailed-report` |

**Parse targets:**
- Total JS bundle size (KB, gzipped + uncompressed)
- Largest single chunk (name + KB)
- Top-5 heaviest packages (name + KB)
- Duplicate packages (same name, multiple versions)

---

## Node Service Path

### Step 1 — CPU Flame Graph (node --prof)

```bash
# Run with V8 profiler
node --prof server.js &
SERVER_PID=$!

# Warm up / exercise the hot path (replace with real load tool)
npx autocannon -d 10 -c 10 http://localhost:3000/your-endpoint

kill $SERVER_PID

# Post-process
node --prof-process isolate-*.log > profile.txt
```

**Parse targets from profile.txt:**
- Top-5 functions by ticks (function name + file + tick count + % total)
- `[Summary]` section: % ticks in Optimized/Unoptimized/Runtime/GC

Alternatively, use **clinic.js** for a richer flamegraph:

```bash
npx clinic --version 2>/dev/null || echo "MISSING: npm install -g clinic"

# clinic flame (CPU), clinic bubbleprof (async I/O), clinic doctor (auto-detect)
npx clinic flame -- node server.js
# Open the generated HTML report, extract the top hot functions
```

### Step 2 — Heap Snapshot

```bash
# For scripts (not servers): heapdump via --inspect
node --inspect --expose-gc your-script.js

# Programmatic (add temporarily to code — read-only analysis, do NOT commit):
# const v8 = require('v8'); v8.writeHeapSnapshot();

# For servers: send SIGUSR2 to a running Node process
kill -USR2 <pid>   # triggers heapdump if heapdump npm module is wired in
```

**Parse targets:**
- Total heap used (MB)
- Top-5 object types by retained size (class name + MB)
- Detached DOM nodes (if Electron/browser context)
- Comparison to previous snapshot: objects grown by > 20 %

### Step 3 — Memory over time (simple)

```bash
/usr/bin/time -v node your-script.js 2>&1 | grep -E "Maximum resident|Elapsed"
# macOS alternative:
/usr/bin/time -l node your-script.js 2>&1 | grep -i "maximum resident"
```

---

## Generic Path

```bash
# Elapsed time + memory (Linux)
/usr/bin/time -v command arg1 arg2

# Elapsed time (macOS)
/usr/bin/time -l command arg1 arg2

# Cross-platform wall-clock with statistical output (install check first)
hyperfine --version 2>/dev/null || echo "MISSING: https://github.com/sharkdp/hyperfine"
hyperfine --runs 10 --warmup 3 'command arg1 arg2'
```

**Parse targets:**
- Wall-clock time: mean ± stddev (ms or s)
- Max RSS / peak memory (MB)
- Relative comparison if multiple commands given

---

## Baseline Diff

If `.profile-baseline.json` exists in the project root, load it and compute delta:

```
delta = current_value - baseline_value
delta_pct = (delta / baseline_value) * 100
```

Show `▲ +12 %` (regression) or `▼ -8 %` (improvement) in the metric table.

To save the current run as baseline:
```bash
# /profile will offer this at the end of the run
echo '{ "lcp_ms": 1200, "tbt_ms": 80, ... }' > .profile-baseline.json
```

---

## Output Format

Present results as a **numeric metric table**, then a separate recommendations section.

### Metric Table Template

```markdown
## Profile Results — <project name or URL> — <timestamp>

### Core Web Vitals (Lighthouse, median of 3 runs)
| Metric | Value | Baseline | Delta | Threshold |
|--------|-------|----------|-------|-----------|
| LCP    | 2 400 ms | 2 100 ms | ▲ +14 % | ≤ 2 500 ms ✅ |
| TBT    | 320 ms | 180 ms | ▲ +78 % | ≤ 200 ms ❌ |
| CLS    | 0.08 | 0.05 | ▲ +60 % | ≤ 0.1 ✅ |
| FCP    | 1 100 ms | 980 ms | ▲ +12 % | ≤ 1 800 ms ✅ |
| Score  | 72 / 100 | 81 / 100 | ▲ -9 pts | |

### Bundle Size
| Asset | Uncompressed | Gzip | Baseline | Delta |
|-------|-------------|------|----------|-------|
| main.js | 420 KB | 118 KB | 310 KB | ▲ +35 % |
| vendor.js | 680 KB | 190 KB | 680 KB | — |

Top 3 heaviest packages: react-pdf (98 KB gz), lodash (72 KB gz), moment (65 KB gz)

### Node CPU (top 5 hot functions)
| Rank | Function | File | Ticks | % Total |
|------|----------|------|-------|---------|
| 1 | parseBody | src/middleware/body.js:42 | 1 240 | 31 % |
| 2 | hashPassword | src/auth/bcrypt.js:18 | 890 | 22 % |
| ... | | | | |

### Heap
| Metric | Value | Baseline | Delta |
|--------|-------|----------|-------|
| Heap used | 184 MB | 160 MB | ▲ +15 % |
| Array objects | 42 MB | 38 MB | ▲ +11 % |
```

---

## Recommendations Section

Only recommend what the metrics justify. Format:

```markdown
## Optimization Targets (ordered by expected impact)

1. **TBT regression (+78 %)** — likely caused by new synchronous work in main thread.
   Candidates: the `parseBody` function (31 % CPU ticks) and any new third-party scripts.
   Next step: run /profile --compare before/after removing the suspect script.

2. **Bundle size growth (+35 % on main.js)** — `react-pdf` added 98 KB gz.
   Consider dynamic import (`React.lazy`) if PDF rendering is not on the critical path.
   Saves ~80 KB gz from initial load.

3. **moment.js (65 KB gz)** — consider replacing with `date-fns` or native `Intl`.
   One-time migration, no runtime trade-off.
```

**Do NOT suggest code edits here.** Suggest the target and the expected impact. The user (or `/loop`) decides whether to act.

---

## Integration with /loop

`/profile` is the **metric source** for `/loop` optimization cycles.

```
/profile → numeric metric table (objective function values)
                          ↓
                       /loop --objective "LCP < 2000ms AND bundle_main < 300KB"
                          ↓
               /loop proposes code change → developer implements
                          ↓
                       /profile --compare (re-measure)
                          ↓
               loop until objective met or diminishing returns
```

When handing off to `/loop`, include:
- The failing metric row(s) from the table above
- The threshold that defines "done" (e.g. `TBT ≤ 200 ms`)
- The baseline file path (for automatic delta tracking across iterations)

---

## Missing Tool Handling

When a required tool is absent, print a clear install block and skip that sub-metric — do NOT fail the entire run:

```
⚠ lighthouse not found. Install: npm install -g lighthouse
  Skipping Core Web Vitals section — bundle analysis will proceed.

⚠ clinic not found. Install: npm install -g clinic
  Falling back to node --prof. For richer flamegraphs, install clinic.
```

After listing all missing tools, ask the user: **"Install missing tools now and re-run, or proceed with available data?"**

---

## Report

Save to `plans/reports/profile-<YYMMDD>-<HHmm>-<slug>.md` (or alongside the cook/fix report if invoked mid-workflow). Include:

- Full metric table
- Baseline diff (if baseline exists)
- Recommendations (metric-traced)
- Tool versions used + run count
- Raw output files referenced (lighthouse-report.json, profile.txt, etc.) — do NOT inline large raw output

```markdown
## Profile run

Date: 2026-06-12 16:24
Runs: 3 (median reported)
Tools: lighthouse 12.1.0, webpack-bundle-analyzer 4.10.0

Metrics: [table above]
Recommendations: [list above]
Baseline: .profile-baseline.json (saved this run)
Raw output: lighthouse-report.json, stats.json
```
