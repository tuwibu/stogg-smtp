# Package Manager Cheatsheet

Quick reference for dependency commands used by `/deps`.

---

## npm

| Task | Command |
|------|---------|
| List outdated | `npm outdated` |
| List outdated (JSON) | `npm outdated --json` |
| Security audit | `npm audit` |
| Audit (JSON) | `npm audit --json` |
| Fix audit (patch only) | `npm audit fix` |
| Fix audit (allow major) | `npm audit fix --force` _(dangerous — confirm first)_ |
| Install specific version | `npm install <pkg>@<version>` |
| Install and save exact | `npm install --save-exact <pkg>@<version>` |
| Dry-run install | `npm install --dry-run` |
| Check peer conflicts | `npm install --dry-run 2>&1 \| grep -i peer` |
| Verify lockfile integrity | `npm ci --dry-run` |
| List all installed (flat) | `npm list --depth=0` |

**Lockfile:** `package-lock.json`

---

## pnpm

| Task | Command |
|------|---------|
| List outdated | `pnpm outdated` |
| List outdated (JSON) | `pnpm outdated --format json` |
| Security audit | `pnpm audit` |
| Audit (JSON) | `pnpm audit --json` |
| Fix audit | `pnpm audit --fix` |
| Install specific version | `pnpm add <pkg>@<version>` |
| Install exact | `pnpm add --save-exact <pkg>@<version>` |
| Dry-run install | `pnpm install --dry-run` |
| List installed (flat) | `pnpm list --depth 0` |
| Check why a package is installed | `pnpm why <pkg>` |

**Lockfile:** `pnpm-lock.yaml`

---

## yarn (Classic v1 + Berry v2+)

| Task | Command (v1) | Command (v2+ / Berry) |
|------|-------------|----------------------|
| List outdated | `yarn outdated` | `yarn upgrade-interactive` _(interactive only)_ |
| Security audit | `yarn audit` | `yarn npm audit` |
| Audit (JSON) | `yarn audit --json` | `yarn npm audit --json` |
| Install specific version | `yarn add <pkg>@<version>` | `yarn add <pkg>@<version>` |
| Install exact | `yarn add --exact <pkg>@<version>` | `yarn add --exact <pkg>@<version>` |
| Check outdated (non-interactive) | `yarn outdated --json` | _(no built-in; use `npm outdated` as fallback)_ |
| List installed | `yarn list --depth=0` | `yarn info --all` |

**Lockfile:** `yarn.lock`

**Berry note:** `yarn outdated` was removed in v2+. Use `yarn upgrade-interactive` for interactive upgrades, or install `yarn-outdated-formatter` plugin.

---

## bun

| Task | Command |
|------|---------|
| List outdated | `bun outdated` |
| Security audit | `bun audit` _(bun ≥ 1.1)_ |
| Install specific version | `bun add <pkg>@<version>` |
| Install exact | `bun add --exact <pkg>@<version>` |
| Update a package | `bun update <pkg>` |
| List installed | `bun pm ls` |

**Lockfile:** `bun.lockb` (binary); text version `bun.lock` from bun ≥ 1.1.

**Note:** `bun audit` is available from bun 1.1+. For older versions, fall back to `npm audit` (bun uses the same `node_modules` layout).

---

## Go modules

| Task | Command |
|------|---------|
| List outdated modules | `go list -m -u all` |
| List outdated (JSON) | `go list -m -u -json all` |
| Security audit | `govulncheck ./...` |
| Upgrade a specific module | `go get <module>@<version>` |
| Upgrade to latest patch | `go get <module>@patch` |
| Upgrade to latest minor | `go get <module>@latest` |
| Tidy (remove unused, sync go.sum) | `go mod tidy` |
| Verify module integrity | `go mod verify` |
| View available versions | `go list -m -versions <module>` |
| Graph dependencies | `go mod graph` |

**Lockfile equivalent:** `go.sum` (integrity hashes) + `go.mod` (version constraints)

**govulncheck install:** `go install golang.org/x/vuln/cmd/govulncheck@latest`

---

## Detecting lock/manifest drift

| PM | Drift check |
|----|-------------|
| npm | `npm install --dry-run` — exits non-zero if lockfile would change |
| pnpm | `pnpm install --frozen-lockfile` — fails if lockfile is stale |
| yarn v1 | `yarn install --frozen-lockfile` |
| yarn v2+ | `yarn install --immutable` |
| bun | `bun install --frozen-lockfile` |
| go | `go mod verify` — checks go.sum integrity |

Run the frozen/immutable install as a health check; a non-zero exit = drift detected.

---

## CVE severity mapping

`npm audit` / `pnpm audit` severity levels map to action urgency:

| Severity | Action |
|----------|--------|
| **critical** | Fix immediately — Group 1 in upgrade plan |
| **high** | Fix this sprint — Group 1 if patch exists, else document |
| **moderate** | Fix next planned maintenance window |
| **low** | Track, fix opportunistically |
| **info** | Informational only |
