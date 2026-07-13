---
name: contract
description: "Tri-mode OpenAPI codegen orchestrator. Detects the repo's role (Provider / TS consumer / Go consumer) and runs the correct toolchain. Provider emits openapi.json from a live NestJS app. TS consumer generates *.types.d.ts + *.zod.ts via openapi-typescript + openapi-zod-client (schemas-only). Go consumer generates models-only via oapi-codegen — HTTP client stays handwritten. Shared sync+drift-check for all consumers."
license: MIT
argument-hint: "[--role provider|ts|go] [--spec <file>] [--live] [--check] [--sync]"
metadata:
  author: claudex-kit
  version: "1.0.0"
---

# /contract — OpenAPI Codegen Orchestrator

You are a codegen coordinator, not a codegen engine. You detect the repo's role, resolve the spec, invoke the correct toolchain via shell commands, and verify the output. You never write generated code by hand — that is the job of `openapi-typescript`, `openapi-zod-client`, and `oapi-codegen`.

## Flags

| Flag | Effect |
|------|--------|
| `--role provider\|ts\|go` | Skip auto-detect and force a role |
| `--spec <file>` | Use this spec file (overrides all other resolution) |
| `--live` | Force live fetch from `/api/docs-json` (TS consumer only) |
| `--check` | Drift-check only — resync + regen + `git status --porcelain`; exit 1 on drift |
| `--sync` | Sync spec from provider repo + regen (no drift check) |

---

## Step 1 — Detect Role

Run the decision tree unless `--role` is given.

```
1. Does the project have a NestJS Swagger setup?
   Grep: `src/` for `SwaggerModule` OR `@ApiTags` OR `buildAutomationOpenApiDocument`
   AND has `openapi/` directory OR `scripts/generate-openapi.ts`
   → Role: PROVIDER

2. Does the project have a third-party contract directory?
   Glob: `src/shared/third-party/*/openapi.json`
   OR has `scripts/generate-contract.ts`
   → Role: TS_CONSUMER

3. Does the project have an oapi-codegen config?
   Glob: `**/oapi-codegen.yaml` or `**/oapi-codegen.yml`
   AND has `pkg/contract/` directory
   → Role: GO_CONSUMER

4. None of the above → ask user to pass --role explicitly.
```

If multiple signals fire, prefer the order: PROVIDER > TS_CONSUMER > GO_CONSUMER (the most specific wins; a provider repo rarely is also a TS consumer of itself).

---

## Step 2 — Branch per Role

### PROVIDER (NestJS)

**Pre-condition:** live DB + Redis must be reachable. The script boots the real `AppModule` — without a working DB connection it will fail at DI resolution. Warn the user if env vars look unset.

**Tool detection:**
```bash
# Verify NestJS build tools
which nest 2>/dev/null || npx nest --version 2>/dev/null || echo "MISSING: @nestjs/cli"
```

**Generate:**
```bash
# 1. Compile (tsc preserves decorator metadata — tsx/esbuild drops it)
yarn nest build          # or: npx nest build

# 2. Run the compiled generator (anchors at process.cwd() = project root)
node dist/scripts/generate-openapi.js
# Output: openapi/openapi.json (sorted keys, filtered to Swagger allowlist)
```

**What the script does (do NOT re-implement):**
- Boots `AppModule` via `NestFactory.create`
- Calls `buildAutomationOpenApiDocument(app, pkg.version)` — applies the `@AutomationApi` allowlist (strips admin/internal routes)
- Serializes with `JSON.stringify(doc, sortKeysReplacer, 2)` — deterministic key order
- Writes to `openapi/openapi.json`

**Post-run:**
- Print the path count from stdout: `Paths: /automation/…, …`
- Commit `openapi/openapi.json` so consumers can use the offline path

---

### TS_CONSUMER

**Tool detection:**
```bash
npx openapi-typescript --version 2>/dev/null || echo "MISSING: openapi-typescript (npm i -D openapi-typescript)"
npx openapi-zod-client --version 2>/dev/null || echo "MISSING: openapi-zod-client (npm i -D openapi-zod-client)"
```

**Spec resolution order** (first that resolves wins):
1. `--spec <file>` — explicit path
2. `${PROVIDER_REPO_PATH}/openapi/openapi.json` — sibling repo committed spec (offline, deterministic)
3. `${PROVIDER_BASE_URL}/api/docs-json` — live fetch (fallback / `--live`)

Where `PROVIDER_REPO_PATH` and `PROVIDER_BASE_URL` come from the `SERVICES` map in `scripts/generate-contract.ts` (env var names are per-service config).

**Generate per service:**
```bash
# Via the existing script (preferred — reads SERVICES map + env):
ts-node scripts/generate-contract.ts <service>             # uses sibling repo spec
ts-node scripts/generate-contract.ts <service> --spec ./path/to/openapi.json
ts-node scripts/generate-contract.ts <service> --live

# What the script produces in src/shared/third-party/<service>/:
#   openapi.json               (committed snapshot)
#   <service>-api.types.d.ts   (openapi-typescript)
#   <service>-api.zod.ts       (openapi-zod-client schemas-only template)
```

**If `scripts/generate-contract.ts` does not exist yet** (new consumer project), scaffold it from the reference pattern (see `references/contract-codegen-patterns.md`) and add a `SERVICES` entry:
```ts
const SERVICES = {
  <svc>: {
    baseUrlEnv: '<SVC>_API_URL',
    repoPathEnv: '<SVC>_REPO_PATH',
    outDir: 'src/shared/third-party/<svc>',
  },
}
```

**Key codegen invocations (used inside the script):**
```bash
# Types
npx openapi-typescript "<specPath>" -o "<service>-api.types.d.ts"

# Zod schemas-only (no zodios client, no @zodios/core dep)
# Template path resolved from installed package location:
OZC_DIR=$(node -e "console.log(require.resolve('openapi-zod-client/package.json').replace('/package.json',''))")
npx openapi-zod-client "<specPath>" -o "<service>-api.zod.ts" -t "$OZC_DIR/src/templates/schemas-only.hbs"
```

**Output structure:**
```
src/shared/third-party/<service>/
  openapi.json               ← committed spec snapshot
  <service>-api.types.d.ts   ← generated, committed
  <service>-api.zod.ts       ← generated, committed
```

**Never:** generate a Zodios HTTP client or add `@zodios/core` — schemas-only template only.

---

### GO_CONSUMER

**Tool detection:**
```bash
which oapi-codegen 2>/dev/null || go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest
```

**oapi-codegen config** (`pkg/contract/oapi-codegen.yaml`):
```yaml
# Models-only — HTTP client stays handwritten in pkg/services
package: apicontract
generate:
  models: true
output: contract_gen.go
```

The `//go:generate` directive in `pkg/contract/` (or `generate.go`) must reference the config:
```go
//go:generate oapi-codegen -config oapi-codegen.yaml openapi.json
```

**Sync spec from provider:**
```bash
# Copy committed spec from provider repo (PROVIDER_REPO_PATH env var)
cp "$PROVIDER_REPO_PATH/openapi/openapi.json" pkg/contract/openapi.json

# Regenerate models
go generate ./pkg/contract/...
# Output: pkg/contract/contract_gen.go
```

**What is generated vs. handwritten:**

| File | Owner |
|------|-------|
| `pkg/contract/contract_gen.go` | `oapi-codegen` — **never edit manually** |
| `pkg/contract/openapi.json` | Vendored snapshot — updated by sync only |
| `pkg/services/` HTTP client | **Handwritten** — retry, `x-api-key`, sanitize, `ApiResponse[T]` envelope |

`ApiResponse[T]` envelope shape (keep in sync with provider BE):
```go
type ApiResponse[T any] struct {
    Success bool   `json:"success"`
    Data    T      `json:"data,omitempty"`
    Message string `json:"message,omitempty"`
}
```

**Never overwrite `pkg/services/` or any handwritten HTTP client file with codegen output.**

---

## Step 3 — Sync + Drift-Check (all consumer roles)

### Sync (update vendor + regen)

```bash
# Copy spec from provider sibling repo
cp "$PROVIDER_REPO_PATH/openapi/openapi.json" <vendor-spec-path>

# Then regen using the role-appropriate command above
```

### Drift-check

Used by `api-contract-enforcer` at review/CI. Pattern derived from `check-openapi-contract.ps1`:

```bash
# 1. Resync + regen (as above)

# 2. Check for uncommitted changes in the contract dir
dirty=$(git status --porcelain -- <contract-dir>)
if [ -n "$dirty" ]; then
  echo "[check] DRIFT: <contract-dir> differs after regenerate:"
  echo "$dirty"
  echo "Review the diff and commit the resync."
  exit 1
fi
echo "[check] contract in sync"
```

**`--porcelain` is required** — plain `git diff` misses newly generated untracked files.

Exit codes: `0` = in sync, `1` = drift detected (or uncommitted contract changes already present).

### Resolution order (all consumers)

```
1. --spec <file>   (explicit, always wins)
2. $PROVIDER_REPO_PATH/openapi/openapi.json   (sibling repo, offline, deterministic)
3. $PROVIDER_BASE_URL/api/docs-json            (live fetch, --live flag or last resort)
```

---

## Step 4 — Adding a New Consumer

1. Declare the consumer's role (TS or Go).
2. For TS: add a `SERVICES` entry in `scripts/generate-contract.ts`.
3. For Go: add `oapi-codegen.yaml` in the new package dir + `//go:generate` directive.
4. Commit the initial `openapi.json` snapshot so the offline path works immediately.
5. Run `/contract --check` to confirm drift-check is green on first pass.

---

## <HARD-GATE>

- Never write generated types/models by hand. If a tool is missing, install it and rerun.
- Never overwrite handwritten HTTP client files (Go: `pkg/services/`; TS: any non-`third-party` service).
- Drift-check must pass (`git status --porcelain` empty) before reporting success.
- Provider role requires a working AppModule boot — if env vars are missing, STOP and ask the user.
</HARD-GATE>

---

## What You Report

After completing, write a brief summary:

```markdown
## /contract run

Role detected: PROVIDER | TS_CONSUMER | GO_CONSUMER
Spec resolved from: --spec | sibling repo (<path>) | live (<url>)
Output:
  - <path/to/generated-file>  (X bytes / Y types)
  - ...
Drift-check: pass | DRIFT — <files>
```

See `references/contract-codegen-patterns.md` for stack-specific patterns and sample commands.
