# Contract Codegen Patterns

Reference for the three stacks supported by `/contract`. Each section describes the pattern,
toolchain, and sample commands. Do NOT copy source code from external repos — cite the toolchain.

---

## 1. Provider — NestJS Swagger → `openapi/openapi.json`

### Pattern

The provider is the source of truth. It boots its real `AppModule` (full DI, DB + Redis must be
reachable), applies a Swagger allowlist decorator (`@AutomationApi` or equivalent) to filter down
to the public automation surface, then serializes the OpenAPI document with sorted keys for
deterministic diffs.

### Why `tsc` not `tsx`/`esbuild`

`tsx` and other esbuild-based runners strip TypeScript decorator metadata at runtime. NestJS DI
relies on `reflect-metadata` — if metadata is absent, the injector cannot resolve providers and
the app fails to boot. The compiled `dist/` output from `tsc` (with `emitDecoratorMetadata: true`)
preserves it.

### Toolchain

| Tool | Role |
|------|------|
| `@nestjs/cli` (`nest build`) | Compile to `dist/` preserving decorator metadata |
| `@nestjs/swagger` (`SwaggerModule`, `DocumentBuilder`) | Build the OpenAPI object from decorated controllers |
| Custom allowlist (e.g. `buildAutomationOpenApiDocument`) | Filter to public surface, strip admin/internal routes |
| `JSON.stringify(doc, sortKeysReplacer, 2)` | Deterministic key ordering for clean diffs |

### Sample commands

```bash
# Full cycle
yarn nest build
node dist/scripts/generate-openapi.js
# → openapi/openapi.json

# Verify output (count exposed paths)
node -e "const d=require('./openapi/openapi.json'); console.log(Object.keys(d.paths))"
```

### Key design decisions

- **Allowlist, not blocklist.** Only routes tagged with the public-surface decorator appear in the
  spec. New routes are opt-in, preventing accidental exposure of internal endpoints.
- **Sorted keys.** `sortKeysReplacer` ensures `git diff` is noise-free when only business fields
  change — no key-order churn.
- **Committed spec.** `openapi/openapi.json` is committed to the provider repo so consumers can
  resolve it offline without running the provider server.

---

## 2. TS Consumer — `openapi-typescript` + `openapi-zod-client` (schemas-only)

### Pattern

The consumer vendors a snapshot of the provider's spec, generates TypeScript types (`.d.ts`) for
compile-time safety, and generates Zod schemas (`.zod.ts`) for runtime validation — using the
schemas-only template so no Zodios HTTP client is emitted and `@zodios/core` is not required.

All generated files land in `src/shared/third-party/<service>/` alongside the vendored
`openapi.json`. The `scripts/generate-contract.ts` script orchestrates spec resolution + both
codegen steps and reads a `SERVICES` map so adding a new provider is one config entry.

### Toolchain

| Tool | Role | Install |
|------|------|---------|
| `openapi-typescript` | Static types from OpenAPI spec → `*.types.d.ts` | `npm i -D openapi-typescript` |
| `openapi-zod-client` | Zod schemas from OpenAPI components → `*.zod.ts` | `npm i -D openapi-zod-client` |
| `ts-node` / `tsx` | Run the orchestrator script | Already in most NestJS devDeps |

### Spec resolution order (implemented in `generate-contract.ts`)

```
1. --spec <file>          explicit path, always wins
2. $<SVC>_REPO_PATH/openapi/openapi.json    sibling repo (offline, deterministic)
3. $<SVC>_API_URL/api/docs-json             live fetch (fallback / --live flag)
```

The sibling-repo path is preferred: no network, no running provider server, and it matches the
provider's committed contract exactly.

### Sample commands

```bash
# Via orchestrator script (handles resolution + both codegen steps)
ts-node scripts/generate-contract.ts multisource
ts-node scripts/generate-contract.ts multisource --spec ./local-override.json
ts-node scripts/generate-contract.ts multisource --live

# Raw codegen (what the script invokes internally)
npx openapi-typescript "src/shared/third-party/multisource/openapi.json" \
    -o "src/shared/third-party/multisource/multisource-api.types.d.ts"

# schemas-only template — resolve the .hbs from the installed package
OZC_DIR=$(node -e "console.log(require.resolve('openapi-zod-client/package.json').replace('/package.json',''))")
npx openapi-zod-client "src/shared/third-party/multisource/openapi.json" \
    -o "src/shared/third-party/multisource/multisource-api.zod.ts" \
    -t "$OZC_DIR/src/templates/schemas-only.hbs"
```

### Output layout

```
src/shared/third-party/<service>/
  openapi.json                    ← vendored spec snapshot (committed)
  <service>-api.types.d.ts        ← compile-time types   (generated, committed)
  <service>-api.zod.ts            ← runtime Zod schemas  (generated, committed)
```

### Key design decisions

- **schemas-only template.** The `schemas-only.hbs` template exports only Zod schema objects —
  no `makeApi`, no Zodios router, no `@zodios/core` peer dep. The consumer's own fetch layer
  (wrapping axios/fetch) calls the provider; Zod validates the response shape.
- **Committed generated files.** Both `.d.ts` and `.zod.ts` are committed. Reviewers can see
  contract changes in PRs; drift-check is a simple `git status --porcelain`.
- **One `SERVICES` map.** Adding a new provider = one object in the map with `baseUrlEnv`,
  `repoPathEnv`, `outDir`. No per-service script duplication.

### Adding a new service

```ts
// scripts/generate-contract.ts — SERVICES map
const SERVICES: Record<string, ServiceConfig> = {
  mynewservice: {
    baseUrlEnv: 'MYNEWSERVICE_API_URL',
    repoPathEnv: 'MYNEWSERVICE_REPO_PATH',
    outDir: 'src/shared/third-party/mynewservice',
  },
}
```

Then run:
```bash
ts-node scripts/generate-contract.ts mynewservice
git add src/shared/third-party/mynewservice/
```

---

## 3. Go Consumer — `oapi-codegen` models-only → `pkg/contract/contract_gen.go`

### Pattern

The Go consumer vendors the provider's spec in `pkg/contract/openapi.json` and uses `oapi-codegen`
(models-only config) to generate Go struct types. The HTTP client — including retry logic,
`x-api-key` authentication, response sanitization, and the `ApiResponse[T]` envelope unwrap —
is written **by hand** in `pkg/services/`. Codegen never touches the HTTP client.

### Toolchain

| Tool | Role | Install |
|------|------|---------|
| `oapi-codegen` | Generate Go model structs from OpenAPI components | `go install github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@latest` |
| `go generate` | Trigger codegen via `//go:generate` directive | Built into Go toolchain |
| PowerShell scripts (Windows) / shell scripts (Linux) | Sync spec + drift-check | In `scripts/` |

### oapi-codegen config (`pkg/contract/oapi-codegen.yaml`)

```yaml
# Models-only — HTTP client stays handwritten in pkg/services
package: apicontract
generate:
  models: true
output: contract_gen.go
```

**`generate.models: true` only.** Never add `generate.client`, `generate.server`, or
`generate.strict-server` — that would overwrite the handwritten HTTP client pattern.

### go:generate directive

```go
// pkg/contract/generate.go  (or at top of any .go file in pkg/contract/)
package apicontract

//go:generate oapi-codegen -config oapi-codegen.yaml openapi.json
```

### Sample commands

```bash
# Sync spec from provider sibling repo and regenerate
export PROVIDER_REPO_PATH=/path/to/multiprofile-v2-api
cp "$PROVIDER_REPO_PATH/openapi/openapi.json" pkg/contract/openapi.json
go generate ./pkg/contract/...
# → pkg/contract/contract_gen.go

# Drift check (after sync+regen)
dirty=$(git status --porcelain -- pkg/contract)
if [ -n "$dirty" ]; then echo "DRIFT: $dirty"; exit 1; fi
echo "contract in sync"
```

PowerShell equivalents are in `scripts/sync-openapi-contract.ps1` and
`scripts/check-openapi-contract.ps1`.

### File ownership

| File | Owner | Rule |
|------|-------|------|
| `pkg/contract/contract_gen.go` | `oapi-codegen` | Never edit manually; regenerate to update |
| `pkg/contract/openapi.json` | Vendor sync | Updated only by sync script |
| `pkg/contract/oapi-codegen.yaml` | Human config | Pinned to models-only |
| `pkg/services/*.go` (HTTP client) | **Handwritten** | Retry, `x-api-key`, sanitize, `ApiResponse[T]` |

### `ApiResponse[T]` envelope

The provider's API wraps every response in this shape. The handwritten client unwraps it:

```go
type ApiResponse[T any] struct {
    Success bool   `json:"success"`
    Data    T      `json:"data,omitempty"`
    Message string `json:"message,omitempty"`
}
```

Keep this struct definition in sync with the provider's actual envelope. It lives in
`pkg/services/` (handwritten), **not** in `contract_gen.go`.

### Key design decisions

- **Models-only.** Only Go structs for request/response shapes are generated. No HTTP client
  code — oapi-codegen's generated client would not handle the custom retry/auth/sanitize logic
  the consumer needs.
- **Vendor + commit the spec.** `pkg/contract/openapi.json` is committed so the build is
  reproducible without network access or a running provider.
- **Deterministic drift-check via `--porcelain`.** `git diff` only sees tracked files;
  `git status --porcelain` also catches new untracked generated files.

---

## 4. Shared — Drift-Check Pattern

Used by `api-contract-enforcer` at PR review and CI.

### Algorithm

```
1. Resolve spec (--spec > sibling repo > live)
2. Copy spec to vendor location
3. Run role-appropriate regen command
4. git status --porcelain -- <contract-dir>
5. Non-empty output → exit 1 (drift)
6. Empty → exit 0 (in sync)
```

### Why commit generated files?

Generated files are committed so:
- `git status --porcelain` gives a simple, reliable drift signal.
- PR diffs show contract changes explicitly — reviewers see what the provider changed.
- Builds are reproducible offline (no tool invocation needed to build the binary).

### CI integration

Add to your CI pipeline after the build step:

```yaml
# GitHub Actions example
- name: Contract drift check
  run: |
    cp "$PROVIDER_REPO_PATH/openapi/openapi.json" <vendor-path>
    <regen-command>
    dirty=$(git status --porcelain -- <contract-dir>)
    if [ -n "$dirty" ]; then echo "Contract drift: $dirty"; exit 1; fi
```

Or invoke `api-contract-enforcer` agent which runs this flow automatically.
