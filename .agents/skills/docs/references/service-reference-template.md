<!-- AI-FACING: dense, code-level, grep-optimised. NOT prose for humans. -->
# <ServiceName> — Reference

> AI-facing. Populate from source; keep every entry at file:line granularity.
> Sections are immutable — do not rename, reorder, or merge.

---

## 1. Symbol Map

Key exports, classes, and functions this service exposes. One row per symbol.

| Symbol | Kind | File:Line | Signature / Shape |
|--------|------|-----------|-------------------|
| `ExampleClass` | class | `src/example/example.service.ts:12` | `constructor(repo: ExampleRepo)` |
| `doThing` | fn | `src/example/example.service.ts:45` | `(id: string, opts?: Opts) => Promise<Result>` |
| `EXAMPLE_CONST` | const | `src/example/constants.ts:3` | `number = 60_000` |

_Omit internal helpers not exported from the module index. Include re-exports if they form the public surface._

---

## 2. File Pointers

Entry files and their role. List only files that matter for navigation; skip generated, lock, or config files.

| File | Role |
|------|------|
| `src/example/index.ts` | Public export barrel |
| `src/example/example.service.ts` | Core business logic — all state mutations flow through here |
| `src/example/example.repo.ts` | DB access layer; wraps Prisma/Mongoose calls |
| `src/example/example.dto.ts` | Input/output shapes; validated by class-validator |
| `src/example/example.controller.ts` | HTTP boundary; delegates to service, no logic |

---

## 3. Key Invariants

Data, ordering, or concurrency rules that must hold at all times. State them as assertions, not prose.

- `user.id` is immutable after creation — never updated in UPDATE queries.
- Records with `status = 'processing'` must not be picked up by a second worker (idempotency key: `job.lockToken`).
- `createdAt` ≤ `updatedAt` always; enforced at DB level via `DEFAULT now()` on both.
- Pagination cursors are opaque strings — decode only inside `<file>:line`; never parse externally.

_Delete placeholder rows and replace with service-specific invariants._

---

## 4. API Surface

Public functions, REST endpoints, or CLI commands exposed by this service to other services or callers.

### Functions / Methods

| Symbol | Params | Returns | Throws |
|--------|--------|---------|--------|
| `create(dto)` | `CreateDto` | `Promise<Entity>` | `ConflictException` (P2002) |
| `findById(id)` | `string` | `Promise<Entity \| null>` | — |
| `delete(id)` | `string` | `Promise<void>` | `NotFoundException` (P2025) |

### HTTP Routes (if controller exists)

| Method | Path | Guard | Body / Query | Response |
|--------|------|-------|--------------|----------|
| `POST` | `/example` | `JwtAuthGuard` | `CreateDto` | `201 Entity` |
| `GET` | `/example/:id` | `JwtAuthGuard` | — | `200 Entity` |
| `DELETE` | `/example/:id` | `JwtAuthGuard` | — | `204` |

### CLI Commands (if applicable)

| Command | Args | Description |
|---------|------|-------------|
| `example:seed` | `--count N` | Seeds N example records for local dev |

_Remove sections not applicable to this service._

---

## 5. Gotchas

Non-obvious traps: timing assumptions, silent failures, surprising defaults, env-specific behaviour.

- **Soft-delete default:** `findAll()` filters `deletedAt IS NULL` by default; pass `{ includeSoftDeleted: true }` to bypass (`example.repo.ts:78`).
- **Cascade risk:** deleting a parent record triggers `ON DELETE SET NULL` on child FK — children become orphaned, not deleted (`schema.prisma:114`).
- **Redis TTL:** cached results expire after `CACHE_TTL_SECONDS` (default 300); stale reads possible within that window (`example.service.ts:92`).
- **Env dependency:** feature flag `EXAMPLE_FEATURE_ENABLED` must be `"true"` (string, not bool) or the route returns 404 silently (`example.controller.ts:23`).

_Replace with real gotchas found in code. Remove if none exist — do not leave placeholders._
