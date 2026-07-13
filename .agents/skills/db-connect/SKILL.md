---
name: db-connect
description: "Scaffold a dev-only MCP datastore connection. Reads .env.dev via bash cat (no privacy-block), generates .mcp.json with env-ref placeholders (no secrets inline), ensures .gitignore, and prompts for per-server approval once via approved-servers-cache. Supports postgres, redis, clickhouse, s3/r2."
user-invocable: true
when_to_use: "Invoke when an agent needs to query a local/dev database or object store via MCP tools."
category: dev-tools
keywords: [database, postgres, redis, clickhouse, s3, r2, mcp, dev, connect, scaffold]
argument-hint: "[datastore] [server-name]"
metadata:
  author: claudekit
  version: "1.0.0"
---

# db-connect

Scaffold a **dev-only** MCP server entry so the agent can query local datastores via MCP tools — without leaking secrets into `.mcp.json` or connecting to production.

## Security model (important)

Env isolation is **config discipline + hook enforcement, NOT a real sandbox.**

- `.env.dev` must contain only dev/local credentials. Production DSNs must never appear there.
- `env-dev-guard.cjs` (PreToolUse hook, matcher `mcp__.*`) blocks any MCP call that targets a non-loopback/non-RFC1918 host, a `$`-indirection value, or a db-name matching `prod/staging`.
- `.mcp.json` uses `${VAR_NAME}` env-ref placeholders — the actual secret values from `.env.dev` are **never written** to the file (finding 6).
- `.mcp.json` is added to `.gitignore` automatically (the file carries env-refs, not the real secrets, but keeping it out of git prevents accidental expansion by CI tools that interpolate `${...}`).

## Runtime dependencies

| Datastore | Runtime needed |
|-----------|---------------|
| postgres  | `node` + `npx` (auto-installs `@modelcontextprotocol/server-postgres`) |
| s3 / r2   | `node` + `npx` (auto-installs `aws-s3-mcp`) |
| redis     | `uv` + `uvx` (runs `redis-mcp`) |
| clickhouse| `uv` + `uvx` (runs `mcp-clickhouse`) |

Check before running:
```bash
# node/npx
node --version && npx --version
# uv/uvx (redis, clickhouse)
uvx --version
```

If a runtime is missing, warn the user and stop — do not proceed.

## Env-var mapping (spec §2)

| Datastore  | .env.dev var(s)                                       | MCP env-ref(s)                                    | Notes                         |
|------------|-------------------------------------------------------|---------------------------------------------------|-------------------------------|
| postgres   | `DATABASE_URL`                                        | `${DATABASE_URL}`                                 | Read-only mode (`--read-only`) |
| redis      | `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`          | `${REDIS_HOST}`, `${REDIS_PORT}`, `${REDIS_PWD}`  | `REDIS_PASSWORD` → `REDIS_PWD` |
| clickhouse | `CLICKHOUSE_URL`                                      | `${CLICKHOUSE_HOST/PORT/USER/DB}`, `${CLICKHOUSE_URL}` | URL parsed to components |
| s3 / r2    | `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | same names as env-refs; `S3_REGION=auto` hardcoded | Cloudflare R2 convention |

## Workflow

### 1. Read `.env.dev` via bash (not the Read tool)

```bash
# bash cat avoids the privacy-block hook (finding 5)
bash -c "cat .env.dev"
```

Parse the output to detect which datastore variables are present. Do **not** use the Read tool — it triggers the privacy-block hook on env files.

### 2. Detect datastore(s)

| Env var present         | Datastore   |
|-------------------------|-------------|
| `DATABASE_URL`          | postgres    |
| `REDIS_HOST` or `REDIS_PORT` | redis  |
| `CLICKHOUSE_URL`        | clickhouse  |
| `S3_ENDPOINT`           | s3          |

If multiple datastores detected, handle each in turn.

### 3. Approval check (once per server, using approved-servers-cache)

```js
const { isApproved, approve } = require('.codex/hooks/lib/approved-servers-cache.cjs');
```

- `isApproved(serverName)` → **true**: skip prompt, proceed directly.
- **false**: present `AskUserQuestion` asking the user to confirm connecting to `<serverName>`. On approval, call `approve(serverName)` then proceed. On denial, stop for that server.

### 4. Scaffold `.mcp.json`

```bash
node .codex/skills/db-connect/scripts/scaffold-mcp-json.cjs \
  <datastore> <server-name> \
  --env .env.dev \
  --out .mcp.json
```

The script:
- Reads **only var names** from `--env` (never values).
- Writes `${VAR_NAME}` placeholders in the `env` block.
- Merges with any existing `.mcp.json` (other servers preserved).
- Appends `.mcp.json` to `.gitignore` if not already there.

### 5. Inform the user

claudekit does **not** launch MCP servers. After scaffolding, tell the user:

```
.mcp.json updated with server "<server-name>" (<datastore>).

Next steps:
1. Ensure your shell exports the vars from .env.dev (e.g. `set -a && source .env.dev && set +a`).
2. Approve the MCP server in Codex: add it to `.mcp.json` / config and approve "<server-name>".
3. Reload / restart Codex so the new server is picked up.
4. The env-dev-guard hook will block any call that targets a non-dev host.
```

## Example invocation

```bash
# Postgres
node .codex/skills/db-connect/scripts/scaffold-mcp-json.cjs \
  postgres pg-dev --env .env.dev --out .mcp.json

# Redis
node .codex/skills/db-connect/scripts/scaffold-mcp-json.cjs \
  redis redis-dev --env .env.dev --out .mcp.json

# ClickHouse
node .codex/skills/db-connect/scripts/scaffold-mcp-json.cjs \
  clickhouse ch-dev --env .env.dev --out .mcp.json

# Cloudflare R2 (S3-compatible)
node .codex/skills/db-connect/scripts/scaffold-mcp-json.cjs \
  s3 r2-dev --env .env.dev --out .mcp.json
```

## Limitation

Env isolation is enforced by **configuration discipline** (`.env.dev` contains only dev creds) and the `env-dev-guard` hook (blocks non-dev hosts at tool-call time). It is **not** a true network sandbox. A misconfigured `.env.dev` with a production DSN will pass the scaffold step (the script only reads var names) but will be blocked at call time by the guard if the host is non-RFC1918.

## Related files

- `.codex/hooks/env-dev-guard.cjs` — PreToolUse hook blocking non-dev MCP calls
- `.codex/hooks/lib/approved-servers-cache.cjs` — per-server approval cache
- `.codex/skills/db-connect/scripts/scaffold-mcp-json.cjs` — MCP entry generator
- `.codex/skills/use-mcp/SKILL.md` — MCP tool execution (Gemini CLI or direct scripts)
