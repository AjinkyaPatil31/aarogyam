# Aarogyam — Local Edition Infrastructure (Milestones 3.2 → 4.3)

This directory contains the **Local Infrastructure Foundation** (Milestone
3.2), the **Installer & Runtime Bootstrap** layer (Milestone 3.3), the
**Storage Engine** (Milestone 4.1), the **Logging Framework**
(Milestone 4.2) and the **Backup Framework** (Milestone 4.3).

Nothing here runs automatically: no sockets open, no background processes
begin, no filesystem changes occur on import, and no application behavior
is affected. Directory creation happens **only** when the installer (or
the bootstrap manager) is explicitly invoked.

## Module map

| Path | Responsibility |
| --- | --- |
| `config/` | Milestone 3.1 centralized configuration system (pre-existing). |
| `local/errors.mjs` | Shared error types (`NotImplementedError`, `InstallerError`, `StorageError`, …). |
| `local/paths.mjs` | **Runtime Path Manager** — the only module that resolves absolute paths. |
| `local/fsutil.mjs` | Reusable filesystem primitives (atomic writes, hashing, copy/move…). |
| `local/flags.mjs` | Centralized feature flags — all **disabled by default**. |
| `lifecycle/index.mjs` | **Lifecycle interfaces** (M3.3) — six states + transition rules used by the registry and bootstrap. |
| `logging/index.mjs` | **Logging framework** (M4.2) — TRACE→FATAL levels, buffered async pipeline, console + rotating file sinks, logger hierarchy, structured entries, lifecycle. |
| `storage/index.mjs` | **Storage engine** (M4.1) — namespaced, versioned, checksummed JSON documents with atomic writes, transactions, LRU cache, concurrency locking and lifecycle. |
| `backup/` | **Backup framework** (M4.3) — provider-based manager (`index.mjs`), restore engine (`restore.mjs`), integrity verification (`verify.mjs`), manifest format (`format.mjs`), gzip compression (`compression.mjs`), scheduling infrastructure (`schedule.mjs`), structured errors (`errors.mjs`). |
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
system  ◄── installer, backup                (system re-exports from network)
installer ◄── bootstrap, backup               (readAppVersion / METADATA_SCHEMA_VERSION)
storage ◄── backup                           (registry metadata + cache invalidation)
backup/errors ◄── backup/format, backup/providers, backup/restore
backup/format ◄── backup/verify, backup/restore, backup/index
backup/providers ◄── backup/verify, backup/restore, backup/index
backup/compression ◄── backup/index, backup/restore   (zero app imports — cycle-proof)
config,lifecycle,installer,registry,logging ◄── bootstrap   (top of graph)
everything ◄── system/registry               (aggregation point)
```

No module imports anything that imports it back. The registry and the
bootstrap manager are the two aggregation points at the top of the graph.
The `backup/` modules form a strict chain (errors → format/compression →
providers → verify → restore → index), so no backup module can ever be
part of an import cycle.

## Backup framework (Milestone 4.3)

Production-grade, completely local protection for ALL application data.
Business logic is untouched — the framework only ever reads and copies
files.

### Provider architecture

Each provider is an independently replaceable unit that knows ONE thing:
where its data lives and how to copy it in/out of a backup. Providers
never compress or checksum — the manager owns those concerns, so the
manager API is independent of the compression implementation.

| Provider | Protects | Source |
| --- | --- | --- |
| `sqlite` | application database | `prisma/sqlite.db` (required — a backup without the database fails loudly) |
| `storage` | infrastructure storage engine documents | storage root `cache` / `metadata` / `installation` / `runtime` namespaces |
| `settings` | application settings | storage root `settings` namespace |
| `exports` | generated export data | `data/exports` tree |

The storage `backup` namespace (the backup registry) is deliberately
NOT backed up — it is an index of backups, not protected data, and it is
rebuilt from restored manifests.

### Directory layout

```
<backup.directory>/            (default data/backups)
  <id>/                        e.g. 20260807T103000Z-3f2a9b1c
    manifest.json
    sqlite/aarogyam.sqlite[.gz]
    settings/<doc>.json[.gz]
    storage/<ns>/<doc>.json[.gz]
    exports/<tree>[.gz]
```

### Backup lifecycle

`initialize()` (sync, no I/O) → READY. `backup({ trigger: 'manual' })`:

1. guards — enabled? initialized? not busy? (structured errors only)
2. create `<backup.directory>/<id>/`
3. for each provider: capture into its staging subdirectory
4. finalize each file — compress (when enabled) + SHA-256 checksum
5. write `manifest.json` atomically (self-checksummed)
6. persist the registry index through the Storage Engine (`backup`
   namespace — an index only, the manifest stays the source of truth)
7. apply retention (`backup.retention.maxBackups`, oldest pruned)
8. report progress via the optional `onProgress` callback + `status()`

`cancel()` cooperatively aborts a running backup (checked between
provider stages); the partial directory is removed. `shutdown()`
cancels any running backup, waits (bounded by `SHUTDOWN_GRACE_MS`) and
stops the scheduler. Only manual execution is exposed — the scheduler
(`backup/schedule.mjs`) exists but stays disabled
(`backup.schedule.enabled=false`) and is never started by the manager.

### Restore lifecycle

`restore({ id, providers, dryRun })`:

1. load the manifest + verify integrity (checksums, missing files,
   manifest checksum) and compatibility (format + schema version) —
   all BEFORE any application state changes
2. `dryRun` → compute and return the exact action plan, write nothing
3. apply — for every file: re-verify the stored SHA-256, move any
   existing target aside (never delete), copy the (decompressed) bytes
   in
4. on ANY failure → roll back: remove newly-written files, restore the
   moved-aside originals, raise a structured `RestoreError` with
   `rolledBack: true`
5. on success → drop the aside artifacts and invalidate the storage
   engine cache so reads observe restored documents

`validate(id)` returns the integrity + compatibility report without
restoring; `verify(id)` returns structured integrity diagnostics.

### Manifest format (`backup/format.mjs`)

Versioned (`formatVersion`, currently 1) and self-checksummed — the
`checksum` field is the SHA-256 of the canonical serialization without
itself. Every file entry carries `{ path, size, sha256, compressed,
algorithm }`; `size`/`sha256` describe the file exactly as stored
(compressed bytes when compression is enabled).

```json
{
  "$schema": "aarogyam-backup-manifest",
  "formatVersion": 1,
  "id": "20260807T103000Z-3f2a9b1c",
  "createdAt": "2026-08-07T10:30:00.000Z",
  "appVersion": "0.1.0",
  "schemaVersion": "1",
  "trigger": "manual",
  "compression": { "enabled": false, "algorithm": null },
  "metadata": { "platform": "win32", "arch": "x64", "hostname": "..." },
  "providers": { "sqlite": { "status": "ok", "files": [], "output": {} }, ... },
  "checksum": "..."
}
```

### Integrity verification (`backup/verify.mjs`)

`verifyBackup()` reports structured diagnostics — never throws for a
degraded backup: `manifest-present`, `manifest-valid`, `format-version`,
`manifest-checksum`, `metadata-complete`, per-provider status,
`files-present` (missing-file detection) and `file-checksums`.

### Concurrency

One backup at a time; no restore while a backup runs; no concurrent
restores — all enforced with structured `BackupError('busy')`.

### Configuration (all via `config.get()`)

| Key | Env var | Default | Used by |
| --- | --- | --- | --- |
| `backup.enabled` | `BACKUP_ENABLED` | `true` | `backup` manager (master switch) |
| `backup.directory` | `BACKUP_DIRECTORY` | `data/backups` | `local/paths`, `backup` |
| `backup.compression.enabled` | `BACKUP_COMPRESSION_ENABLED` | `false` | `backup` manager |
| `backup.retention.maxBackups` | `BACKUP_RETENTION_MAX_BACKUPS` | `20` | `backup` manager |
| `backup.schedule.enabled` | `BACKUP_SCHEDULE_ENABLED` | `false` | `backup/schedule` |
| `backup.schedule.intervalSeconds` | `BACKUP_SCHEDULE_INTERVAL_SECONDS` | `86400` | `backup/schedule` |

Milestone 4.3 moved `future.backup.enabled` → `backup.schedule.enabled`
(flag `automaticBackups` follows) and `future.paths.backup` →
`backup.directory`; the old keys are recorded in `config/schema.mjs`
`LEGACY`.

### Dependencies

```
config, paths, fsutil, lifecycle, logging, storage, installer, system ◄── backup/index
backup/errors ◄── backup/*   (pure classes — leaf)
backup/compression ◄── node only              (leaf)
backup ◄── system/registry                    (registered service, depends on storage)
backup ◄── scripts/verify-{infrastructure,m43} (verification only)
```

## Logging framework (Milestone 4.2)

The single logging system for the application. Every infrastructure
module obtains its own logger through `createLogger(name)` sharing one
buffered asynchronous backend (the log manager). No infrastructure
module uses `console.*` directly.

- **Levels** — `TRACE < DEBUG < INFO < WARN < ERROR < FATAL`;
  configurable via `logging.level` (per-logger overrides supported).
- **Write pipeline** — `log.info(...)` → normalise entry → bounded FIFO
  buffer → single drain loop takes ordered batches (max 64) → console
  sink (human-readable, no stack) + file sink (JSONL with full
  structured metadata incl. stack). Enqueue is synchronous and cheap;
  disk I/O never blocks the caller.
- **Buffer lifecycle** — bounded (`maxBufferEntries`, default 4096); on
  saturation the OLDEST entries are dropped and counted in
  `getStats().dropped`. `flush()` resolves only when the buffer is
  empty and no drain cycle is running.
- **File logging** — append-only JSONL at `<logsDir>/aarogyam.log`.
  The log **directory is created by the installer only**; if it is
  missing the file sink disables itself with a console warning (never
  creates directories). A closed/stale handle reopens lazily on the
  next write (restart-safe).
- **Rotation** — by size (`logging.file.maxSize`, default 1 MB) with
  `logging.file.maxFiles` retained files. The active file is renamed
  aside **before** new entries are appended, so completed entries are
  never lost. Rotation happens at open time and per batch.
- **Logger hierarchy** — `createLogger('storage')` →
  `.child('cache')` yields `storage:cache`; all loggers share the same
  backend. Bootstrap creates `bootstrap`, installer creates
  `installer`, etc.
- **Structured entries** — `{ timestamp, level, module, service,
  message, context, error: {name,message,code}, stack }`; context is
  extensible. Error arguments (`StorageError`, `LifecycleError`,
  `InstallerError`, …) are normalized; **stack traces appear only in
  the file sink**, never in console output.
- **Lifecycle** — `getLogManager().initialize()` → READY (sync, no
  I/O); `flush()` drains; `shutdown()` flushes + closes the file
  handle → STOPPED (a later write reopens lazily). The registry
  registers the log manager as a service, so `shutdownAll()` flushes
  and closes logs in the correct order.
- **Configuration** — `logging.level`, `logging.console.enabled`,
  `logging.file.enabled`, `logging.file.maxSize`,
  `logging.file.maxFiles` — all via `config.get()`. The log directory
  comes from `paths.logsDir` (`future.paths.logs` / `LOG_DIRECTORY`).

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

Existing `future.*` keys reused by the infrastructure:

| Key | Used by |
| --- | --- |
| `future.paths.installation` | `local/paths` |
| `future.paths.database` | `local/paths` |
| `future.paths.backup` | `local/paths`, `backup` (Milestone 4.3: key moved to `backup.directory` — see below) |
| `future.paths.logs` | `local/paths`, `logging` |
| `future.lanDiscovery.*` | `local/flags`, `discovery` |
| `future.offlineMode.enabled` | `local/flags` |

`storage.*` keys added in Milestone 4.1 (consumed by the storage engine):

| Key | Env var | Used by |
| --- | --- | --- |
| `storage.cache.enabled` | `STORAGE_CACHE_ENABLED` | `storage` |
| `storage.cache.maxEntries` | `STORAGE_CACHE_MAX_ENTRIES` | `storage` |

`logging.*` keys added in Milestone 4.2 (consumed by the logging
framework — they replace the M3.1 `future.logging.*` scaffolding):

| Key | Env var | Used by |
| --- | --- | --- |
| `logging.level` | `LOG_LEVEL` | `logging` |
| `logging.console.enabled` | `LOG_CONSOLE_ENABLED` | `logging` |
| `logging.file.enabled` | `LOG_FILE_ENABLED` | `logging`, `local/flags` |
| `logging.file.maxSize` | `LOG_FILE_MAX_SIZE` | `logging` |
| `logging.file.maxFiles` | `LOG_FILE_MAX_FILES` | `logging` |

The removed `LOG_TO_FILE` variable (previously `future.logging.toFile`)
is recorded as `status: 'dead'` in `config/schema.mjs` `LEGACY`, with
`removedIn: '4.2'`.

## Storage dependency graph

```
config, paths, fsutil, errors, lifecycle, logging ◄── storage   (no cycles)
storage ◄── system/registry                                    (registered service)
storage ◄── scripts/verify-{infrastructure,m33,m41,m42}        (verification only)
```

`logging` is registered as a service in the registry; because it is
initialized early and stopped late (reverse order), every other service
can log during its own shutdown and the log manager flushes last.

## Configuration history

- Milestone 3.3 added **no new configuration keys**: the installer and
  bootstrap only consume values that already exist (`app.name`, the
  `future.paths.*` set) or read the app version from `package.json`.
- Milestone 4.1 added `storage.cache.*`.
- Milestone 4.2 added `logging.*` (replacing the `future.logging.*`
  scaffolding) and promoted the `loggingToFile` flag to
  `logging.file.enabled`.
- Milestone 4.3 added `backup.*` (replacing the `future.backup.enabled`
  scaffolding — now `backup.schedule.enabled` — and moving
  `future.paths.backup` → `backup.directory`).

## Hard constraints honored

- No authentication, middleware, Prisma, database schema, business
  logic, React component, dashboard, route, PDF, WhatsApp, appointment,
  prescription, RBAC or session code was modified.
- No application code imports the new infrastructure modules yet (the
  backup framework is invoked only through the infrastructure registry).
- No directories are created unless the installer/bootstrap is invoked
  (the backup manager writes only when a backup/restore explicitly runs).
- No infrastructure module uses `console.*` directly — all logging
  flows through the logging framework.

## How to verify

```bash
node scripts/verify-infrastructure.mjs   # M3.2 static + load verification
node scripts/verify-m33.mjs              # M3.3 installer/bootstrap verification
node scripts/verify-m41.mjs              # M4.1 storage engine verification
node scripts/verify-m42.mjs              # M4.2 logging framework verification
node scripts/verify-m43.mjs              # M4.3 backup framework verification (incl. build gates)
npm run build                            # app build must still pass
```

`AAROGYAM_VERIFY_M43_FAST=1 node scripts/verify-m43.mjs` skips the slow
build gates (npm install / prisma generate / npm build) while iterating.
