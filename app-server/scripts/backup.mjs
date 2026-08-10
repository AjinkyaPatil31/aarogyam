#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Aarogyam — Backup CLI  (M1.6 Phase B, W-03)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Thin operator interface over the EXISTING backup framework
 *  (app/lib/backup). The manager owns capture, manifests, checksums,
 *  retention and verification — this script owns only the process boundary:
 *
 *    node scripts/backup.mjs                     run a full backup + verify
 *    node scripts/backup.mjs --verify <id>       verify an existing backup
 *    node scripts/backup.mjs --list              list recorded backups
 *    node scripts/backup.mjs --dir <path>        override backup root
 *    node scripts/backup.mjs --database <path>   override sqlite source
 *    node scripts/backup.mjs --json              machine-readable output only
 *
 *  Safety properties:
 *    • exit code 0 on success, non-zero on failure (2 = usage error)
 *    • reuses the centralized configuration validation gate — no new parser
 *    • loads .env.local/.env BEFORE any config/paths module evaluates
 *      (config and paths read process.env at import time)
 *    • checkpoints the SQLite WAL before capture — the application
 *      database runs in WAL mode (M1.6 Phase A), so a raw file copy would
 *      otherwise omit frames still held in the WAL; the checkpoint makes
 *      the copied file complete and consistent
 *    • prints concise operator output; never secrets, never stack traces
 *    • no uploads, no cloud storage, no scheduled execution
 *    • a --dir override also relocates the backup registry (storage engine
 *      'backup' namespace) under the override root, keeping every artifact
 *      self-contained
 *
 *  Exit codes: 0 success · 1 operation failed · 2 usage error.
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env.local first, then .env (dotenv never overrides an already-set
// key → Next.js precedence). MUST happen before the infra modules below
// are imported — config/index.mjs and local/paths.mjs resolve process.env
// at module evaluation time.
for (const file of ['.env.local', '.env']) {
  const path = join(appRoot, file);
  if (existsSync(path)) loadEnv({ path, override: false, quiet: true });
}

// Dynamic imports guarantee the env prelude above has run first.
const { validateConfig } = await import('../app/lib/config/validate.mjs');
const { paths } = await import('../app/lib/local/paths.mjs');
const fsutil = await import('../app/lib/local/fsutil.mjs');
const { createBackupManager } = await import('../app/lib/backup/index.mjs');
const { createStorageService } = await import('../app/lib/storage/index.mjs');
const { flushLogs } = await import('../app/lib/logging/index.mjs');
const { PrismaClient } = await import('@prisma/client');

// ── Argument parsing (explicit, no dependency) ─────────────────────────────
function printUsage() {
  console.log(`Usage: node scripts/backup.mjs [options]
  (no options)            run a full backup, verify it, print the summary
  --verify <id>           verify an existing backup by id
  --list                  list recorded backups
  --dir <path>            backup root override (default: data/backups)
  --database <path>       sqlite source override (default: prisma/sqlite.db)
  --json                  machine-readable output only
  --help                  show this help`);
}

const opts = { action: 'backup', dir: null, database: null, json: false, id: null };
// Skip argv[0] (node executable) and argv[1] (this script) — parse user args only.
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === '--verify') {
    opts.action = 'verify';
    opts.id = process.argv[i + 1];
    i += 1;
  } else if (arg === '--list') {
    opts.action = 'list';
  } else if (arg === '--dir') {
    opts.dir = process.argv[i + 1];
    i += 1;
  } else if (arg === '--database') {
    opts.database = process.argv[i + 1];
    i += 1;
  } else if (arg === '--json') {
    opts.json = true;
  } else if (arg === '--help' || arg === '-h') {
    printUsage();
    process.exit(0);
  } else {
    console.error(`Unknown argument: ${arg}`);
    printUsage();
    process.exit(2);
  }
}
if ((opts.action === 'verify') && !opts.id) {
  console.error('--verify requires a backup id.');
  printUsage();
  process.exit(2);
}

/**
 * Checkpoint the SQLite WAL into the main database file so a subsequent
 * raw file copy is complete and consistent. Prisma's SQLite driver cannot
 * serialize the pragma's BigInt result row ("Do not know how to serialize
 * a BigInt") — the pragma executes before that serialization error, so it
 * is expected and ignored here (same mechanism proven for busy_timeout in
 * Phase A).
 */
async function checkpointWAL() {
  const prisma = new PrismaClient();
  try {
    try {
      await prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (err) {
      const msg = String(err?.message ?? '');
      if (!/BigInt|serialize/i.test(msg)) throw err;
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** Emit the machine-readable result line (always the LAST stdout line). */
function emitResult(result) {
  if (opts.json) {
    console.log(`BACKUP_RESULT ${JSON.stringify(result)}`);
    return;
  }
  if (result.action === 'backup') {
    console.log(`Backup ${result.id} — integrity ${result.integrity.ok ? 'OK' : 'FAILED'} ` +
      `(${result.integrity.checks} checks, ${result.integrity.errors} errors)`);
    console.log(`  directory: ${result.directory}`);
    console.log(`  size: ${result.size} bytes`);
    console.log(`  providers: ${result.providers.join(', ')}`);
  } else if (result.action === 'verify') {
    console.log(`Verify ${result.id} — ${result.ok ? 'OK' : 'FAILED'} ` +
      `(${result.checks} checks, ${result.errors} errors)`);
    if (result.failed.length > 0) console.log(`  failed checks: ${result.failed.join(', ')}`);
  } else if (result.action === 'list') {
    for (const b of result.backups) {
      console.log(`  ${b.id}  ${b.createdAt}  ${b.status}  ${b.size ?? '-'} bytes`);
    }
  }
  console.log(`BACKUP_RESULT ${JSON.stringify(result)}`);
}

async function main() {
  // 1. Configuration gate — reuse the single centralized validator.
  try {
    validateConfig(process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const backupDir = resolve(opts.dir ?? paths.backupsDir);
  const databaseFile = resolve(opts.database ?? paths.databaseFile);
  const storageRoot = opts.dir
    ? join(dirname(backupDir), 'registry')
    : paths.dataDir;

  const storage = createStorageService(storageRoot);
  const manager = createBackupManager({
    directory: backupDir,
    sqlite: { databaseFile },
    storage,
  });
  manager.initialize();
  storage.initialize();

  try {
    if (opts.action === 'list') {
      const backups = await manager.listBackups();
      emitResult({ ok: true, action: 'list', backups });
      return 0;
    }

    if (opts.action === 'verify') {
      const result = await manager.verify(opts.id);
      emitResult({
        ok: result.ok,
        action: 'verify',
        id: opts.id,
        checks: result.checks.length,
        errors: result.errors.length,
        failed: result.errors.map((e) => e.name),
      });
      return result.ok ? 0 : 1;
    }

    // Full backup. The WAL checkpoint runs through the app's Prisma
    // client, which resolves the baked-in datasource (prisma/sqlite.db).
    // It is therefore only correct when the target database IS the app
    // database; a --database override pointing elsewhere skips the
    // checkpoint (the file is copied as-is — the operator owns the
    // consistency of a non-standard source). A missing database must
    // still surface the provider's missing-source error, so the
    // checkpoint never runs when the file does not exist (it would
    // otherwise create it).
    const isDefaultDatabase = !opts.database || databaseFile === resolve(paths.databaseFile);
    if (isDefaultDatabase && (await fsutil.fileExists(databaseFile))) {
      await checkpointWAL();
    } else if (!isDefaultDatabase) {
      console.warn(
        'Backup: --database override differs from the application database — skipping WAL checkpoint for this run.'
      );
    }
    const result = await manager.backup();
    const verified = await manager.verify(result.id);
    emitResult({
      ok: verified.ok,
      action: 'backup',
      id: result.id,
      directory: result.dir,
      size: result.size,
      createdAt: result.createdAt,
      providers: result.providers,
      integrity: {
        ok: verified.ok,
        checks: verified.checks.length,
        errors: verified.errors.length,
      },
    });
    return verified.ok ? 0 : 1;
  } catch (err) {
    // Structured error only — code + message, never a stack trace.
    console.error(`Backup failed (${err.code ?? 'unknown'}): ${err.message}`);
    return 1;
  } finally {
    await flushLogs();
    await manager.shutdown().catch(() => {});
    await storage.shutdown().catch(() => {});
  }
}

process.exitCode = await main();
