# Profiling Tools Cheatsheet

Quick-reference flags and commands for tools used by `/profile`.

---

## Lighthouse

```bash
# Install
npm install -g lighthouse
# or: npx lighthouse (no install, slower cold start)

# Basic run (headless Chrome)
lighthouse <url> --output=json --output-path=report.json --chrome-flags="--headless"

# Multiple categories
lighthouse <url> --only-categories=performance,accessibility --output=html --output-path=report.html

# Throttling presets
--preset=desktop          # disables mobile throttling
--throttling-method=devtools   # real Chrome DevTools throttling
--throttling-method=simulate   # Lighthouse simulated (default)
--throttling-method=provided   # no throttling

# Emulation
--emulated-form-factor=mobile   # default
--emulated-form-factor=desktop

# Quiet / CI mode
--quiet                         # suppress progress output
--chrome-flags="--headless --no-sandbox --disable-gpu"

# Multiple runs for median (use lhci for full CI integration)
npm install -g @lhci/cli
lhci collect --url=<url> --numberOfRuns=5
lhci upload --target=filesystem --outputDir=./lhci-reports
```

**Key JSON paths after parsing:**

| Field | Path in JSON |
|-------|-------------|
| Performance score (0–1) | `categories.performance.score` |
| LCP (ms) | `audits['largest-contentful-paint'].numericValue` |
| FCP (ms) | `audits['first-contentful-paint'].numericValue` |
| TBT (ms) | `audits['total-blocking-time'].numericValue` |
| CLS | `audits['cumulative-layout-shift'].numericValue` |
| Speed Index (ms) | `audits['speed-index'].numericValue` |
| TTFB (ms) | `audits['server-response-time'].numericValue` |
| Render-blocking resources | `audits['render-blocking-resources'].details.items` |
| Unused JS (KB) | `audits['unused-javascript'].details.overallSavingsBytes` |

**Good / Needs Improvement / Poor thresholds (2024):**

| Metric | Good | Needs Improvement | Poor |
|--------|------|-------------------|------|
| LCP | ≤ 2 500 ms | ≤ 4 000 ms | > 4 000 ms |
| TBT | ≤ 200 ms | ≤ 600 ms | > 600 ms |
| CLS | ≤ 0.1 | ≤ 0.25 | > 0.25 |
| FCP | ≤ 1 800 ms | ≤ 3 000 ms | > 3 000 ms |

---

## Bundle Analyzers

### webpack-bundle-analyzer

```bash
# Install
npm install --save-dev webpack-bundle-analyzer

# Generate stats file (webpack 5)
npx webpack --profile --json > stats.json

# Or add to webpack.config.js:
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
plugins: [new BundleAnalyzerPlugin({ analyzerMode: 'json', reportFilename: 'stats.json' })]

# Launch analyzer (opens browser)
npx webpack-bundle-analyzer stats.json

# Static HTML (no server, CI-friendly)
npx webpack-bundle-analyzer stats.json --mode=static --report=report.html --no-open
```

### esbuild + esbuild-visualizer

```bash
# Generate metafile during build
npx esbuild src/index.ts --bundle --metafile=meta.json --outfile=dist/out.js

# Visualize
npx esbuild-visualizer --metadata=meta.json --filename=stats.html
open stats.html
```

**Programmatic (esbuild API):**
```js
const result = await esbuild.build({ ..., metafile: true });
fs.writeFileSync('meta.json', JSON.stringify(result.metafile));
```

### Rollup + rollup-plugin-visualizer

```bash
npm install --save-dev rollup-plugin-visualizer

# rollup.config.js
import { visualizer } from 'rollup-plugin-visualizer';
export default { plugins: [visualizer({ filename: 'stats.html', open: true })] };

npx rollup -c   # generates stats.html
```

### Vite

```bash
npm install --save-dev rollup-plugin-visualizer

# vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer';
export default defineConfig({ plugins: [visualizer({ filename: 'stats.html' })] });

npx vite build   # generates stats.html
```

Or one-shot without config change:
```bash
npx vite-bundle-visualizer   # wraps the above automatically
```

### Next.js (@next/bundle-analyzer)

```bash
npm install --save-dev @next/bundle-analyzer

# next.config.js
const withBundleAnalyzer = require('@next/bundle-analyzer')({ enabled: process.env.ANALYZE === 'true' });
module.exports = withBundleAnalyzer({ /* ...nextConfig */ });

ANALYZE=true npx next build   # opens two browser tabs: client + server bundles
```

### Parcel

```bash
npx parcel build src/index.html --detailed-report
# Prints per-asset sizes to stdout; no separate tool needed
```

---

## node --prof (V8 CPU Profiler)

```bash
# 1. Run with profiler enabled
node --prof app.js

# For a server: run load against it, then kill
node --prof server.js &
PID=$!
npx autocannon -d 15 -c 50 http://localhost:3000/hot-endpoint
kill $PID

# 2. Post-process (produces human-readable text)
node --prof-process isolate-*.log > profile.txt

# Useful flags
--prof-process --preprocess     # output JSON instead of text (machine-readable)
--prof-process --call-graph     # add call-graph to text output

# 3. Parse key sections from profile.txt
# [Summary]    - tick distribution across JS/GC/Optimized/Deopt
# [JavaScript] - per-function tick counts (sort by "ticks" column)
# [C++]        - native functions (V8 internals, addon calls)
# [Bottom up]  - call-graph in reverse (who called the hot function)
```

**Read the [Summary] first:**
```
[Summary]:
   ticks  total  nonlib   name
    980   24.7%   25.1%  JS: ...       ← your code + deps
    220    5.6%    5.7%  Unoptimized   ← candidates for --allow-natives-syntax check
     80    2.0%    0.0%  GC           ← if > 10%, heap pressure, check leaks
   2300   58.1%          Library       ← V8 builtins, mostly fine
```

---

## clinic.js

```bash
npm install -g clinic

# Doctor — auto-detects CPU / I/O / memory issue
npx clinic doctor -- node server.js

# Flame — CPU flamegraph (best for finding hot functions)
npx clinic flame -- node server.js

# Bubbleprof — async I/O bottlenecks
npx clinic bubbleprof -- node server.js

# Heapprofiler — heap allocations over time
npx clinic heapprofiler -- node server.js

# Each generates a self-contained HTML file in ./.clinic/
```

**Interpret flame chart:**
- Wide bars at the top = hot (most CPU time spent here)
- Red bars = V8 unoptimized code (deopt candidate)
- Look for your own code frames, not just V8 internals

---

## Heap Snapshots

```bash
# Via Chrome DevTools (for servers):
node --inspect server.js
# Open chrome://inspect → click "inspect" → Memory tab → "Take heap snapshot"

# Programmatic snapshot (add to code temporarily — do NOT commit):
const v8 = require('v8');
const path = require('path');
const snapshotPath = v8.writeHeapSnapshot(path.join(__dirname, 'heap.heapsnapshot'));
console.log('Snapshot:', snapshotPath);

# Load snapshot in Chrome DevTools:
# DevTools → Memory → Load → select .heapsnapshot file
```

**heapdump npm package (alternative):**
```bash
npm install heapdump
# In code:
const heapdump = require('heapdump');
heapdump.writeSnapshot('./heap-' + Date.now() + '.heapsnapshot');
# Or send SIGUSR2 to a running process if heapdump.init() is called on startup
kill -USR2 <pid>
```

**Snapshot analysis in Chrome DevTools:**
- **Summary view:** group by constructor, sort by "Retained Size" descending
- **Comparison view:** two snapshots → find objects that grew
- **Containment view:** walk object graph from GC roots

---

## Generic: hyperfine (cross-platform benchmarking)

```bash
# Install
# macOS:  brew install hyperfine
# Linux:  cargo install hyperfine  OR  use release binary from GitHub
# Windows: scoop install hyperfine  OR  winget install sharkdp.hyperfine

# Basic
hyperfine 'command arg1'

# With warmup runs (exclude from stats)
hyperfine --warmup 3 'command arg1'

# Multiple runs (default 10)
hyperfine --runs 20 'command arg1'

# Compare two commands
hyperfine 'old-command' 'new-command'

# Export results
hyperfine --export-json results.json 'command'
hyperfine --export-markdown results.md 'command'

# Prepare/cleanup between runs
hyperfine --prepare 'sync; echo 3 > /proc/sys/vm/drop_caches' 'cat /dev/urandom | head -c 10M'
```

**JSON output key fields:**
```json
{
  "results": [{
    "command": "...",
    "mean": 0.142,        // seconds
    "stddev": 0.003,
    "median": 0.141,
    "min": 0.138,
    "max": 0.149,
    "times": [...]        // all individual run times
  }]
}
```

---

## /usr/bin/time (Linux / macOS)

```bash
# Linux — full resource stats
/usr/bin/time -v command
# Key fields: "Maximum resident set size" (KB), "Elapsed (wall clock) time"

# macOS
/usr/bin/time -l command
# Key field: "maximum resident set size" (bytes)

# POSIX minimal (available everywhere, less detail)
time command
# Outputs: real / user / sys
```

---

## autocannon (HTTP load for Node warm-up)

```bash
npm install -g autocannon

autocannon -d 10 -c 50 http://localhost:3000/path
# -d  duration (seconds)
# -c  concurrent connections
# -p  HTTP pipelining factor (default 1)
# --json → JSON output with latency percentiles + req/sec
```

---

## Quick Decision Table

| Scenario | Primary tool | Secondary |
|----------|-------------|-----------|
| Web page feels slow (user-facing) | `lighthouse` | Chrome DevTools Performance tab |
| JS bundle too large | `webpack-bundle-analyzer` / `vite-bundle-visualizer` | `source-map-explorer` |
| Node server high CPU | `clinic flame` | `node --prof` |
| Node server high memory / leak | heap snapshot (Chrome DevTools) | `clinic heapprofiler` |
| Node async I/O bottleneck | `clinic bubbleprof` | — |
| CLI script / generic binary | `hyperfine` | `/usr/bin/time -v` |
| Need repeatable CI comparison | `lhci` (Lighthouse CI) | `hyperfine --export-json` |
