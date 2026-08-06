# Aarogyam — Local Edition Infrastructure (Milestone 3.2 / 3.3)

This directory contains the **Local Infrastructure Foundation** (Milestone
3.2) and the **Installer & Runtime Bootstrap** layer (Milestone 3.3).

Nothing here runs automatically: no sockets open, no background processes
begin, no filesystem changes occur on import, and no application behavior
is affected. Directory creation happens **only** when the installer (or
the bootstrap manager) is explicitly invoked.

## Module map

| Path | Responsibility |
| --- | --- |
| `config/` | Milestone 3.1 centralized configuration system (pre-existing). |
| `local/errors.mjs` | Shared error types (`NotImplementedError`, …). |
| `local/paths.mjs` | **Runtime Path Manager** — the only module that resolves absolute paths. |
| `local/fsutil.mjs` | Reusable filesystem primitives (atomic writes, hashing, copy/move…). |
| `local/flags.mjs` | Centralized feature flags — all **disabled by default**. |
| `lifecycle/index.mjs` | **Lifecycle interfaces** (M3.3) — six states + transition rules used by the registry and bootstrap. |
| `logging/index.mjs` | Logging framework (info/warn/error/debug, console now, file later). |
| `storage/index.mjs` | **Storage engine** (M4.1) — namespaced, versioned, checksummed JSON documents with atomic writes, transactions, LRU cache, concurrency locking and lifecycle. |
| `backup/index.mjs` | Backup framework (SQLite / settings / exports providers — interfaces only). |
| `network/index.mjs` | Read-only network metadata helpers (no sockets). |
| `discovery/index.mjs` | LAN discovery interfaces (broadcast, scan, clinic identity, device metadata — inert). |
| `sync/index.mjs` | Offline sync interfaces (operation queue, engine, conflict resolver, version tracker — inert). |
| `system/index.mjs` | Read-only process/OS helpers. |
| `system/registry.mjs` | **Service Registry** — register, initialize and gracefully stop services; per-service lifecycle states. |
| `installer/index.mjs` | **Installer** (M3.3) — idempotent + transactional first-run installation, metadata, integrity, upgrade detection. |
| `bootstrap/index.mjs` | **Bootstrap manager** (M3.3) — single entry point for infrastructure initialization + graceful shutdown. |

## Dependency graph

```
config  ◄── local/flags, local/paths, discovery, logging, installer, bootstrap
(node)  ◄── local/fsutil, network            (zero app imports — cycle-proof)
paths,fsutil ◄── storage, backup
errors  ◄── backup, discovery, sync
lifecycle ◄── system/registry, bootstrap     (lifecycle imports nothing)
system  ◄── installer                        (system re-exports from network)
installer ◄── bootstrap
config,lifecycle,installer,registry,logging ◄── bootstrap   (top of graph)
everything ◄── system/registry               (aggregation point)
```

No module imports anything that imports it back. The registry and the
bootstrap manager are the two aggregation points at the top of the graph.

## Storage engine (Milestone 4.1)

Infrastructure-data document storage. Business entities **never** use it
(SQLite via Prisma remains the application database).

- **Namespace layout** — `settings`, `cache`, `metadata`, `installation`,
  `runtime`, `backup`; each namespace is an isolated directory of
  `<safeKey>.json` documents.
- **Document envelope** — `{ $schema, version, namespace, key, savedAt,
  checksum, data }`; `version` is reserved for future compatibility (no
  migrations yet), `checksum` is SHA-256 over the serialized data.
  Legacy raw-JSON documents are read as version 0.
- **Atomic persistence** — every single-document write is temp-file +
  atomic rename (crash-safe, never partially written).
- **Transaction flow** — `begin()` holds the write mutex; `tx.set()` /
  `tx.remove()` stage operations (set temps written immediately);
  `commit()` moves existing targets aside to backups, renames new
  documents into place, then drops backups; any mid-commit failure
  restores the backups (no partial commits). `rollback()` discards the
  staged temps. `transaction(fn)` auto-commits / auto-rolls-back.
- **Transaction restrictions** — inside a transaction use only
  `tx.set()`/`tx.remove()`; a service-level `set()`/`remove()` there
  raises `StorageError('transaction-in-progress')` instead of
  deadlocking. An abandoned transaction is logged as stale after
  `TX_STALE_MS` so a future service manager can recover.
- **Crash-atomicity honesty** — multi-document transactions are
  exception-safe (in-process failures roll back via backups) but not
  crash-atomic: a hard kill between commit phase 1 (targets → `.bak`)
  and phase 3 (backups dropped) can leave orphaned `.bak` artifacts.
  `listKeys` ignores non-`.json` files, so nothing corrupt is served;
  the future journaling milestone closes this window.
- **Concurrency** — a FIFO write mutex serializes all mutations; reads
  are lock-free (renames are atomic). Safe for concurrent services.
- **Cache behavior** — optional in-memory LRU, read-through +
  write-through (crash-safe), with `invalidate()` / `invalidateNamespace()`
  / `clear()` and `getStats()` (`hits`, `misses`, `evictions`, `entries`).
  The shared instance reads `storage.cache.*` from config.
- **Integrity verification** — `verify()` / `verifyDocument()` validate
  JSON format, envelope version, namespace/key markers and checksums;
  `getStrict()` / `readDocument()` raise structured `StorageError`s;
  `get()` is lenient (returns the fallback and logs on corruption).
- **Lifecycle** — `initialize()` → READY (sync, no I/O); `shutdown()`
  drains pending writes, flushes (write-through ⇒ disk already current)
  and → STOPPED.

## Lifecycle (Milestone 3.3)

Every stateful component tracks state through `app/lib/lifecycle`:

```
UNINITIALIZED ──► INITIALIZING ──► READY
      │                │  │          │
      │                │  └─► FAILED ─┼──► STOPPING ──► STOPPED
      └───────────────►│              │        ▲
                     (retry)          └────────┘
```

- Illegal transitions throw `LifecycleError`.
- The registry exposes `getState(name)` / `getStates()`.
- Services may expose `shutdown()` — it is awaited during `stop()`.

## Bootstrap sequence (startup order)

`bootstrap.initialize()` runs, in order:

1. **Configuration** — already resolved by `config/index.mjs` at import;
   a coherence check (`app.name` non-empty) runs first.
2. **Installation** — `detectFirstLaunch()`: first launch runs the
   installer; an existing install is verified for integrity.
3. **Upgrade detection** — `checkUpgrade()` records version changes
   (no migrations yet).
4. **Registry** — `registry.initializeAll()` brings up storage, logging,
   backup, discovery and sync in dependency order.
5. Transition to `READY`.

## Shutdown order (graceful)

`bootstrap.shutdown()`:

1. Stop registry services in **reverse dependency order**
   (`registry.shutdownAll()` reverses the initialization order).
2. Drain in-flight async log writes (flush).
3. Mark `STOPPED`.

## Installer flow

`installer.install()` is **idempotent and transactional**:

1. Create every required directory (recursive, idempotent).
2. Build the metadata document fully in memory.
3. Write it **last** with an atomic write (temp file + rename — a crash
   can never leave a half-written file or a partial installation).
4. Validate permissions and report structured diagnostics.

An installation that is already current is **never rewritten**
(byte-identical metadata across runs). A corrupt metadata file self-heals
(rebuilds with a fresh installation id). A blocked directory or metadata
write throws **before** any partial state is persisted.

## Installation metadata

Persisted at `data/installation/installation.json` (path-manager
resolved). Contains **no personal information**:

| Field | Meaning |
| --- | --- |
| `installationId` | UUID, stable across reinstalls |
| `createdAt` / `updatedAt` | ISO timestamps |
| `appVersion` | from `package.json` (single source — not duplicated in config) |
| `previousVersion` | set only after an upgrade |
| `schemaVersion` | metadata-shape version (`'1'`) |
| `platform` / `architecture` | host OS + CPU arch |
| `appName` | from `config.get('app.name')` |
| `upgrades[]` | history of `{from, to, at}` version changes |

## Configuration integration (Milestones 3.1–3.3)

Infrastructure reads **only** through `app/lib/config` — no duplicated
values, and no `process.env` access anywhere outside the config system.
The installer reads `app.name` via `config.get()`; the app version comes
from `package.json` (the installer is its single consumer, so it is not
duplicated into config either).

`future.*` keys added so far (all `status: 'future'`, structure-only):

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

`storage.*` keys added in Milestone 4.1 (consumed by the storage engine):

| Key | Env var | Used by |
| --- | --- | --- |
| `storage.cache.enabled` | `STORAGE_CACHE_ENABLED` | `storage` |
| `storage.cache.maxEntries` | `STORAGE_CACHE_MAX_ENTRIES` | `storage` |

## Storage dependency graph

```
config, paths, fsutil, errors, lifecycle, logging ◄── storage   (no cycles)
storage ◄── system/registry                                    (registered service)
storage ◄── scripts/verify-{infrastructure,m33,m41}            (verification only)
```
| `future.sync.enabled` | `local/flags` |
| `future.apiBaseUrl` | future milestones |

Milestone 3.3 added **no new configuration keys**: the installer and
bootstrap only consume values that already exist (`app.name`, the
`future.paths.*` set) or read the app version from `package.json`.

## Hard constraints honored

- No authentication, middleware, Prisma, database schema, business
  logic, React component, dashboard, route, PDF, WhatsApp, appointment,
  prescription, RBAC or session code was modified.
- No application code imports the new infrastructure modules yet.
- No directories are created unless the installer/bootstrap is invoked.

## How to verify

```bash
node scripts/verify-infrastructure.mjs   # M3.2 static + load verification
node scripts/verify-m33.mjs              # M3.3 installer/bootstrap verification
npm run build                            # app build must still pass
```
