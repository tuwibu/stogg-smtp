---
name: observability
description: "Scaffold and manage a self-hosted observability stack: Loki (logs, B2/S3 chunk storage) + VictoriaMetrics (metrics, 90d retention) + Grafana (provisioned dashboards + Telegram alerting + read-only Postgres datasource) + Caddy (TLS via ACME + bearer-token auth proxy for Go agent fleet). Four modes: init, app-logging, dashboard, alerts."
license: MIT
argument-hint: "[init | app-logging | dashboard | alerts] [--local | --prod]"
metadata:
  author: claudex-kit
  version: "1.0.0"
---

# /observability

Self-hosted observability. No SaaS. Everything runs in Docker; all secrets live in `.env`; nothing is committed.

## Stack components

| Component | Image | Role |
|-----------|-------|------|
| **Loki 3.4** | `grafana/loki:3.4.2` | Log aggregation; chunks/index stored in Backblaze B2 (S3-compatible). Local: filesystem. |
| **VictoriaMetrics** | `victoriametrics/victoria-metrics:v1.115.0` | Metrics (Prometheus-compatible); `retentionPeriod=90d`. |
| **Grafana 11** | `grafana/grafana:11.6.0` | Dashboards provisioned from JSON files; Loki + VictoriaMetrics + Postgres datasources; Telegram alerting. |
| **Caddy 2.9** | `caddy:2.9` | Reverse proxy. Prod: TLS via Let's Encrypt ACME. Auth gate: `Authorization: Bearer $FLEET_PUSH_TOKEN` on agent-push paths. |

## Required env vars (`.env`)

All variables must be present before `docker compose up`. Never commit `.env` — only `.env.example`.

```
# Domain / TLS (prod only)
DOMAIN=                        # e.g. example.com — must have A records for obs.* and grafana.*
ACME_EMAIL=                    # Let's Encrypt notification email

# Agent push auth
FLEET_PUSH_TOKEN=              # openssl rand -hex 32 — shared by entire Go agent fleet

# Backblaze B2 / S3 (Loki chunk storage, prod only)
B2_ENDPOINT=                   # e.g. https://s3.us-west-004.backblazeb2.com
B2_BUCKET=
B2_ACCESS_KEY_ID=
B2_SECRET_ACCESS_KEY=

# Grafana
GRAFANA_ADMIN_PASSWORD=
GF_SERVER_ROOT_URL=            # https://grafana.<DOMAIN>
GRAFANA_ALLOW_EMBEDDING=false  # true only if admin UI embeds dashboards via iframe

# Postgres datasource (read-only)
GRAFANA_PG_HOST=               # Host reachable from grafana container (not localhost)
GRAFANA_PG_PORT=5432
GRAFANA_PG_DB=
GRAFANA_PG_PASSWORD=           # password for grafana_ro role (see sql/create-grafana-readonly-user.sql)

# Telegram alerting
# ⚠ CRITICAL: MUST be non-empty — Grafana crash-loops on startup if the
#   Telegram contact-point provisioning file references an empty token/chat.
# Local dev: use dummy strings ("000000:local-dummy-token" / "local-dummy").
ALERT_TELEGRAM_BOT_TOKEN=
ALERT_TELEGRAM_CHAT_ID=
```

---

## Mode: `init`

**Purpose:** scaffold the complete directory structure and config files for the stack.

### Pre-checks

1. Verify `docker` + `docker compose` are installed: `docker compose version`. If missing, print install instructions and stop.
2. Detect target: flag `--local` (default) or `--prod`. Local omits DOMAIN/B2 vars from generated `.env.example`.

### What gets generated

```
<project-root>/infra/observability/
├── docker-compose.yml                      # Main compose (prod paths)
├── docker-compose.override.yml             # Local-dev overrides (auto-merged)
├── .env.example                            # All vars, documented, no real values
├── .gitignore                              # .env + *.local
├── loki/
│   ├── loki-config.yaml                    # Prod: B2 storage
│   └── loki-config.local.yaml             # Local: filesystem storage
├── grafana/
│   ├── provisioning/
│   │   ├── datasources/
│   │   │   ├── datasources.yaml            # Loki + VictoriaMetrics
│   │   │   └── postgres.yaml              # Postgres read-only datasource
│   │   ├── dashboards/
│   │   │   └── dashboards.yaml            # Dashboard provider config
│   │   └── alerting/
│   │       └── telegram-contact.yaml      # Telegram contact point (dummy-safe)
│   └── dashboards/                        # JSON dashboards go here
├── caddy/
│   ├── Caddyfile                           # Prod: TLS ACME + bearer auth
│   └── Caddyfile.local                    # Local: plain HTTP :9090
└── sql/
    └── create-grafana-readonly-user.sql   # Run once on the Postgres DB
```

### Post-scaffold steps

Print numbered instructions:
1. Copy `.env.example` → `.env` and fill all vars.
2. Telegram warning: `ALERT_TELEGRAM_BOT_TOKEN` and `ALERT_TELEGRAM_CHAT_ID` **must be non-empty** — even dummy values — or Grafana crash-loops on startup.
3. Run SQL: `psql -d <db> -f infra/observability/sql/create-grafana-readonly-user.sql`
4. Local start: `docker compose up -d`
5. Prod start (ensure DNS A records exist first): same command — Caddy auto-provisions TLS.
6. Add `infra/observability/.env` to `.gitignore` (root level).

### Source templates

Use the skeletons in `.codex/skills/observability/references/` as generation source. Substitute `{{PLACEHOLDER}}` values at scaffold time where the user has already provided them; otherwise leave as `CHANGE_ME` with inline comments.

---

## Mode: `app-logging`

**Purpose:** wire structured JSON logging with correlation ID in an application and configure it to ship logs to Loki.

### Framework detection

Read `package.json` / `go.mod` / directory layout to detect:

| Signal | Framework |
|--------|-----------|
| `@nestjs/core` in `package.json` | NestJS |
| `express` in `package.json` (no NestJS) | Express |
| `go.mod` present | Go |

### NestJS

1. Check if `winston` + `nestjs-pino` OR `pino` + `pino-loki` already installed. Prefer existing logger — extend rather than add.
2. If no structured logger: `npm install pino pino-loki pino-http uuid` (or yarn equivalent).
3. Create (or update) `src/logger/logger.module.ts` — pino with transport to Loki:
   - Labels: `{ app: "<service-name>", env: "${NODE_ENV}" }`
   - Correlation ID: read `x-correlation-id` header in HTTP requests; generate `uuid` if absent; inject into pino `child` context.
   - Loki transport target: `pino-loki` → `http://localhost:3100` (local) or `https://obs.<DOMAIN>` with `Authorization: Bearer $LOKI_PUSH_TOKEN` (prod).
4. Register `LoggerModule` globally in `AppModule`.
5. Add middleware that stamps `x-correlation-id` response header.

### Express

1. Install `pino` + `pino-http` + `pino-loki` + `uuid`.
2. Wire `pino-http` middleware at app root.
3. Same correlation-ID pattern: read header → generate if absent → attach to `req.log`.
4. Loki transport via `pino-loki`.

### Go

1. Check if `go.uber.org/zap` or `log/slog` already used. Prefer existing.
2. If none: recommend `go.uber.org/zap` with `zapcore.NewJSONEncoder`.
3. Add `correlationID` middleware (HTTP handler wrapper): read `X-Correlation-Id` header → generate UUID if absent → inject into context via `context.WithValue`.
4. For Loki shipping: configure `promtail` as sidecar OR use HTTP client to POST to Loki push API with bearer token. Provide a minimal `promtail-config.yaml` snippet if sidecar path is chosen.

### Common output format (all frameworks)

```json
{
  "level": "info",
  "time": "2024-01-01T00:00:00.000Z",
  "correlationId": "uuid-v4",
  "service": "app-name",
  "env": "production",
  "msg": "...",
  ...additional fields
}
```

### Loki labels to use

```
app=<service-name>
env=<production|staging|local>
```

Keep label cardinality low — do NOT use `correlationId` as a label (put it in the log line).

---

## Mode: `dashboard`

**Purpose:** add a new Grafana dashboard JSON to the provisioning directory.

### Steps

1. Confirm `infra/observability/grafana/dashboards/` exists (run `init` first if not).
2. Ask for dashboard purpose if not provided as an argument.
3. Generate a minimal valid dashboard JSON:
   - Unique `uid` (slug derived from purpose, e.g. `app-errors`).
   - `title`, `tags`, `schemaVersion: 39`, `version: 1`.
   - At least one panel using the relevant datasource (Loki for logs, VictoriaMetrics for metrics, Postgres for domain data).
   - Use the skeleton in `references/dashboard-skeleton.json` as the base.
4. Write to `infra/observability/grafana/dashboards/<slug>.json`.
5. Remind: Grafana reloads provisioned dashboards every 30s (no restart needed).

### Datasource UIDs to use

| Datasource | UID |
|---|---|
| Loki | `loki` |
| VictoriaMetrics | `victoriametrics` |
| Postgres (rollup) | `postgres-rollup` |

---

## Mode: `alerts`

**Purpose:** add a Telegram contact point and/or an alert rule to Grafana provisioning.

### ⚠ Crash-loop warning

Grafana **crash-loops on startup** if the Telegram contact-point provisioning YAML references an empty `botToken` or `chatId`. This happens because the grafana container starts before env vars are validated.

**Mitigation — always enforced:**
- `.env.example` marks both vars as required with a clear warning.
- The provisioned `telegram-contact.yaml` uses Grafana env-var interpolation (`$ALERT_TELEGRAM_BOT_TOKEN`).
- Local dev `.env` must have dummy strings (not empty) — e.g. `000000:local-dummy-token`.

### Steps

1. Confirm `infra/observability/grafana/provisioning/alerting/` exists.
2. Write (or update) `telegram-contact.yaml`:
   ```yaml
   apiVersion: 1
   contactPoints:
     - orgId: 1
       name: Telegram
       receivers:
         - uid: telegram-receiver
           type: telegram
           settings:
             bottoken: $ALERT_TELEGRAM_BOT_TOKEN
             chatid: $ALERT_TELEGRAM_CHAT_ID
   ```
3. For each alert rule requested:
   - Ask for: metric/log query, threshold, severity, summary template.
   - Write to `provisioning/alerting/<rule-slug>.yaml` with `apiVersion: 1`, `groups:` structure.
   - Set `contactPoint: Telegram` in `notification_settings`.
4. Print a reminder to set real Telegram values in `.env` before deploying to prod.

---

## Decision tree

```
/observability <arg>
        │
        ├─ init ────────────── Scaffold full directory + configs
        │                       → --local (default): filesystem Loki, plain HTTP Caddy
        │                       → --prod: B2 Loki, ACME TLS Caddy, full .env required
        │
        ├─ app-logging ──────── Detect framework → wire structured JSON + Loki shipping
        │                       → NestJS / Express / Go
        │
        ├─ dashboard ────────── Add a provisioned Grafana dashboard JSON
        │                       → Uses datasource UIDs: loki / victoriametrics / postgres-rollup
        │
        └─ alerts ───────────── Add Telegram contact point + alert rule
                                → Dummy local values mandatory to avoid Grafana crash-loop
```

---

## Security checklist

- [ ] `.env` added to `.gitignore` (root AND `infra/observability/`)
- [ ] `FLEET_PUSH_TOKEN` generated with `openssl rand -hex 32` — never reuse across envs
- [ ] `grafana_ro` Postgres role has `SELECT` only on rollup tables — never on `users`/`profiles`
- [ ] Loki and VictoriaMetrics NOT exposed externally — Caddy is the only public entry point
- [ ] Grafana admin password is a strong random string
- [ ] `GRAFANA_ALLOW_EMBEDDING=false` unless specifically needed

## Local vs prod config split

| File | Local | Prod |
|------|-------|------|
| `loki-config.yaml` | `loki-config.local.yaml` (filesystem) | `loki-config.yaml` (B2) |
| `Caddyfile` | `Caddyfile.local` (plain HTTP :9090, no TLS) | `Caddyfile` (ACME TLS) |
| Compose merge | `docker-compose.override.yml` auto-merged | `docker-compose.yml` only |

Docker Compose automatically merges `docker-compose.override.yml` in local dev — no extra flags needed.
