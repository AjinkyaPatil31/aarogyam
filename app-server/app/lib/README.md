# Aarogyam — Local Edition Infrastructure (Milestone 3.2)

This directory contains the **Local Infrastructure Foundation** built in
Milestone 3.2. It is architecture-only: **nothing here runs automatically**.
No sockets are opened, no background processes begin, no filesystem
changes occur, and no application behavior is affected.

## Module map

| Path | Responsibility |
| --- | --- |
| `config/` | Milestone 3.1 centralized configuration system (pre-existing). |
| `local/errors.mjs` | Shared error types (`NotImplementedError`, …). |
| `local/paths.mjs` | **Runtime Path Manager** — the only module that resolves absolute paths. |
| `local/fsutil.mjs` | Reusable filesystem primitives (atomic writes, hashing, copy/move…). |
| `local/flags.mjs` | Centralized feature flags — all **disabled by default**. |
| `logging/index.mjs` | Logging framework (info/warn/error/debug, console now, file later). |
| `storage/index.mjs` | Local storage abstraction (settings, cache, metadata, installation, backups). |
| `backup/index.mjs` | Backup framework (SQLite / settings / exports providers — interfaces only). |
| `network/index.mjs` | Read-only network metadata helpers (no sockets). |
| `discovery/index.mjs` | LAN discovery interfaces (broadcast, scan, clinic identity, device metadata — inert). |
| `sync/index.mjs` | Offline sync interfaces (operation queue, engine, conflict resolver, version tracker — inert). |
| `system/index.mjs` | Read-only process/OS helpers. |
| `system/registry.mjs` | **Service Registry** — register & lazily initialize all services in one place. |

## Dependency graph

```
config  ◄── local/flags
config  ◄── local/paths
(node)  ◄── local/fsutil        (zero app imports — cycle-proof)
paths,fsutil ◄── storage
paths,fsutil ◄── backup
errors,config,network ◄── discovery
errors ◄── sync
config,paths ◄── logging
(node) ◄── network
(node) ◄── system
everything ◄── system/registry  (top of the graph — no cycles)
```

No module imports anything that imports it back. The registry is the
single aggregation point.

## Configuration integration (Milestone 3.1)

Infrastructure reads **only** through `app/lib/config` — no duplicated
values. New `future.*` keys added in this milestone (all `status: 'future'`,
structure-only, not consumed by application code):

| Key | Env var | Used by |
| --- | --- | --- |
| `future.lanMode.enabled` | `LAN_MODE_ENABLED` | `local/flags` |
| `future.backup.enabled` | `AUTOMATIC_BACKUPS_ENABLED` | `local/flags` |

Existing `future.*` keys reused by the infrastructure:

| Key | Used by |
| --- | --- |
| `future.paths.installation` | `local/paths` |
| `future.paths.database` | `local/paths` |
| `future.paths.backup` | `local/paths`, `backup` |
| `future.paths.logs` | `local/paths`, `logging` |
| `future.logging.level` | `logging` |
| `future.logging.toFile` | `local/flags` |
| `future.lanDiscovery.*` | `local/flags`, `discovery` |
| `future.offlineMode.enabled` | `local/flags` |
| `future.sync.enabled` | `local/flags` |
| `future.apiBaseUrl` | future milestones |

## Hard constraints honored

- No authentication, middleware, Prisma, database, business logic, React
  component, dashboard, route, PDF, WhatsApp, appointment, prescription,
  RBAC or session code was modified.
- `config/schema.mjs` + `config/defaults.mjs` gained two *additive*
  `future`-status keys only (validation skips `status: 'future'`).

## How to verify

```bash
node scripts/verify-infrastructure.mjs   # static + load verification
npm run build                            # app build must still pass
```
