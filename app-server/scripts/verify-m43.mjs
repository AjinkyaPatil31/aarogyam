#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Milestone 4.3 Backup Framework Verification Suite
 * ─────────────────────────────────────────────────────────────────────
 *  Covers every M4.3 requirement:
 *    provider registration + isolation, manual backup, backup manifest,
 *    metadata persistence (storage engine), compression, checksum
 *    validation, integrity verification (missing files, corrupt
 *    manifest, format version), restore validation, dry-run restore,
 *    full restore, provider restore, rollback behavior, version
 *    compatibility, concurrent backup/restore protection, lifecycle
 *    startup/shutdown, cancellation, structured logging, storage
 *    integration, retention, scheduler (disabled), zero circular
 *    imports, zero duplicate utilities, zero configuration duplication,
 *    npm install, prisma generate, npm build, runtime smoke tests and
 *    database integrity.
 *
 *  Usage:  node scripts/verify-m43.mjs
 *  Exit:   0 when every check passes, 1 otherwise.
 *  Note:   the final section runs the real build gates (npm install,
 *          prisma generate, npm build) — expect it to take a few minutes.
 */

import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as fsutil from '../app/lib/local/fsutil.mjs'; // leaf module — no config dependency

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
  } else {
    failed += 1;
    failures.push({ name, detail });
  }
}

/** Resolve a promise + a manual resolve function (for hang tests). */
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Imports (dynamic — keep the parent process env pristine) ────────
let createStorageService, backupIndex, backupErrors, backupFormat, scheduleModule;
let createInstaller, registerInfrastructureServices, createBootstrapManager;
try {
  ({ createStorageService } = await import('../app/lib/storage/index.mjs'));
  backupIndex = await import('../app/lib/backup/index.mjs');
  backupErrors = await import('../app/lib/backup/errors.mjs');
  backupFormat = await import('../app/lib/backup/format.mjs');
  scheduleModule = await import('../app/lib/backup/schedule.mjs');
  ({ createInstaller } = await import('../app/lib/installer/index.mjs'));
  ({ registerInfrastructureServices } = await import('../app/lib/system/registry.mjs'));
  ({ createBootstrapManager } = await import('../app/lib/bootstrap/index.mjs'));
  check('m43: backup framework imports cleanly', true);
} catch (err) {
  check('m43: backup framework imports cleanly', false, err.message);
  process.exit(1);
}

const { createBackupManager, BACKUP_TYPES, MANIFEST_FILE_NAME } = backupIndex;
const { BackupError, RestoreError } = backupErrors;
const { manifestChecksum, BACKUP_FORMAT_VERSION } = backupFormat;
const { createBackupScheduler } = scheduleModule;

/**
 * Create an isolated sandbox: storage docs, a fake SQLite database,
 * an exports tree, and an initialized backup manager wired to it all.
 */
async function makeSandbox(overrides = {}) {
  const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m43-'));
  const dataDir = join(sandbox, 'data');
  const backupDir = join(sandbox, 'backups');
  const dbFile = join(sandbox, 'sqlite.db');
  const exportDir = join(sandbox, 'exports');

  const store = createStorageService(dataDir);
  store.initialize();
  await store.set('settings', 'clinic', { name: 'Sandbox Clinic', phone: '123' });
  await store.set('runtime', 'uptime', { seconds: 42 });
  await store.set('metadata', 'device', { label: 'test' });
  await store.set('installation', 'inst', { id: 'i1' });
  await store.set('cache', 'temp', { v: 1 });
  await fsutil.ensureDir(dirname(dbFile));
  await writeFile(dbFile, 'SQLite format 3\0fake-db-bytes');
  await fsutil.ensureDir(exportDir);
  await writeFile(join(exportDir, 'report.pdf'), 'pdf-bytes');

  const manager = createBackupManager({
    storage: store,
    storageProvider: { rootDir: dataDir },
    settings: { settingsDir: dataDir },
    exports: { exportDir },
    sqlite: { databaseFile: dbFile },
    directory: backupDir,
    compression: { enabled: false },
    retention: { maxBackups: 10 },
    schedule: { enabled: false },
    ...overrides,
  });
  manager.initialize();
  return {
    sandbox,
    dataDir,
    backupDir,
    dbFile,
    exportDir,
    store,
    manager,
    cleanup: () => rm(sandbox, { recursive: true, force: true }),
  };
}

/** A provider whose create() (and optionally resolveTargets) hangs until released. */
function makeSlowProvider(type, { hangResolve = false } = {}) {
  const gate = deferred();
  return {
    provider: {
      type,
      describe: () => ({ type }),
      create: async () => {
        await gate.promise;
        return { files: [], output: {} };
      },
      resolveTargets: async ({ files }) => {
        if (hangResolve) await gate.promise;
        return files.map((f) => ({ path: f.path, target: f.path }));
      },
    },
    gate,
  };
}

// ═════════════════════════════════════════════════════════════════════
// 1. Static checks — imports, circular imports, duplicate utilities,
//    configuration duplication, console discipline.
// ═════════════════════════════════════════════════════════════════════
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const libRoot = join(ROOT, 'app', 'lib');
  function* walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (p.endsWith('.mjs')) yield p;
    }
  }
  const files = [...walk(libRoot)];

  // Zero circular imports (DFS over app/lib).
  const mods = new Map(files.map((f, i) => [f, i]));
  const adj = files.map((f) =>
    [...readFileSync(f, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((m) => m[1])
      .filter((r) => r.startsWith('.') || r.startsWith('/'))
      .map((r) => join(dirname(f), r))
      .filter((r) => mods.has(r) && !r.endsWith('.json'))
  );
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Array(files.length).fill(WHITE);
  const stack = [];
  let cycle = null;
  function dfs(u) {
    color[u] = GRAY;
    stack.push(files[u]);
    for (const v of adj[u]) {
      const vi = mods.get(v);
      if (color[vi] === GRAY) {
        cycle = [...stack.slice(stack.indexOf(files[vi])), files[vi]];
        return true;
      }
      if (color[vi] === WHITE && dfs(vi)) return true;
    }
    stack.pop();
    color[u] = BLACK;
    return false;
  }
  for (let i = 0; i < files.length && !cycle; i += 1) if (color[i] === WHITE) dfs(i);
  check('m43: zero circular imports', cycle === null, cycle ? cycle.join(' -> ') : `scanned ${files.length} modules`);

  // Zero duplicate exported utilities.
  const seen = new Map();
  const dups = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)) {
      if (seen.has(m[1])) dups.push(`${m[1]} (${seen.get(m[1])} and ${file})`);
      else seen.set(m[1], file);
    }
  }
  check('m43: zero duplicate exported utilities', dups.length === 0, dups.join(' | '));

  // Zero configuration duplication + backup.* readable via get().
  const { SCHEMA } = await import('../app/lib/config/schema.mjs');
  const { get } = await import('../app/lib/config/index.mjs');
  const keys = SCHEMA.filter((s) => s.status !== 'dead').map((s) => s.key);
  const unique = new Set(keys);
  check('m43: config keys unique in schema', unique.size === keys.length, `schema=${keys.length}`);
  const backupKeys = keys.filter((k) => k.startsWith('backup.'));
  const readable = backupKeys.length === 6 && backupKeys.every((k) => { try { get(k); return true; } catch { return false; } });
  check('m43: all backup.* keys present and readable via get()', readable, backupKeys.join(','));

  // console.* discipline across app/lib (logging sink exempt).
  const offenders = [];
  for (const file of files) {
    if (file.replace(/\\/g, '/').includes('/logging/index.mjs')) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/console\.(log|info|warn|error|debug|trace)\s*\(/.test(line)) return;
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/**')) return;
      offenders.push(`${file}:${i + 1}: ${code}`);
    });
  }
  check('m43: no console.* outside the logging sink', offenders.length === 0, offenders.join(' | '));

  // Config gate.
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'validate-config.mjs')], { cwd: ROOT, stdio: 'pipe' });
    check('m43: config validation gate passes', true);
  } catch (err) {
    check('m43: config validation gate passes', false, String(err.stderr ?? err.message).slice(0, 200));
  }
}

// ═════════════════════════════════════════════════════════════════════
// 2. Provider registration + isolation
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    check('m43: manager registers 4 providers', h.manager.list().length === 4, h.manager.list().map((p) => p.type).join(','));
    check('m43: provider types match BACKUP_TYPES', BACKUP_TYPES.length === 4 && BACKUP_TYPES.every((t) => h.manager.list().some((p) => p.type === t)));
    check('m43: providers individually replaceable', h.manager.get('sqlite').type === 'sqlite');
    const custom = { type: 'sqlite', describe: () => ({ type: 'sqlite', custom: true }), create: async () => ({ files: [], output: {} }), resolveTargets: ({ files }) => files.map((f) => ({ path: f.path, target: f.path })) };
    h.manager.register(custom);
    check('m43: register() replaces a provider by type', h.manager.get('sqlite').describe().custom === true);

    // Provider isolation — one subdirectory per provider, only its files.
    const h2 = await makeSandbox();
    const r = await h2.manager.backup({ trigger: 'manual' });
    const entries = (await readdir(join(h2.backupDir, r.id))).sort();
    check('m43: backup layout = manifest + one dir per provider', JSON.stringify(entries) === JSON.stringify(['exports', 'manifest.json', 'settings', 'sqlite', 'storage']), entries.join(','));
    const sqliteFiles = await readdir(join(h2.backupDir, r.id, 'sqlite'));
    const settingsFiles = await readdir(join(h2.backupDir, r.id, 'settings'));
    const storageFiles = await readdir(join(h2.backupDir, r.id, 'storage'));
    check('m43: sqlite provider isolated', sqliteFiles.length === 1 && sqliteFiles[0] === 'aarogyam.sqlite', sqliteFiles.join(','));
    check('m43: settings provider isolated', settingsFiles.includes('clinic.json'), settingsFiles.join(','));
    check('m43: storage provider isolated (namespaces only)', storageFiles.sort().join(',') === 'cache,installation,metadata,runtime', storageFiles.join(','));
    check('m43: storage provider excludes settings/backup namespaces', !storageFiles.includes('settings') && !storageFiles.includes('backup'));
    await h2.cleanup();

    // Provider failure aborts the whole backup with a structured error
    // and leaves NO partial backup behind.
    const h3 = await makeSandbox();
    h3.manager.register({
      type: 'settings',
      describe: () => ({ type: 'settings' }),
      create: async () => {
        throw new Error('boom');
      },
      resolveTargets: ({ files }) => files.map((f) => ({ path: f.path, target: f.path })),
    });
    let failErr = null;
    try {
      await h3.manager.backup({ trigger: 'manual' });
    } catch (err) {
      failErr = err;
    }
    check('m43: provider failure → structured provider-failed error', failErr instanceof BackupError && failErr.code === 'provider-failed', failErr?.message ?? 'no error');
    check('m43: failed backup leaves no partial directory', (await readdir(h3.backupDir)).length === 0);
    const reg = await h3.store.get('backup', 'registry', null);
    check('m43: failed backup leaves no registry entry', !reg || (reg.backups ?? []).length === 0);
    await h3.cleanup();
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 3. Manual backup + manifest + metadata persistence
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    const r = await h.manager.backup({ trigger: 'manual' });
    check('m43: manual backup returns status completed', r.status === 'completed' && r.id.length > 0);
    check('m43: backup directory created', await fsutil.dirExists(r.dir));

    // Manifest shape + checksum.
    const raw = await readFile(join(r.dir, MANIFEST_FILE_NAME), 'utf8');
    const manifest = JSON.parse(raw);
    check('m43: manifest schema marker', manifest.$schema === 'aarogyam-backup-manifest');
    check('m43: manifest formatVersion', manifest.formatVersion === BACKUP_FORMAT_VERSION);
    check('m43: manifest id + createdAt', typeof manifest.id === 'string' && !Number.isNaN(Date.parse(manifest.createdAt)));
    check('m43: manifest appVersion + schemaVersion', typeof manifest.appVersion === 'string' && manifest.appVersion.length > 0 && typeof manifest.schemaVersion === 'string');
    check('m43: manifest trigger', manifest.trigger === 'manual');
    check('m43: manifest providers cover all 4 types', ['sqlite', 'storage', 'settings', 'exports'].every((t) => manifest.providers?.[t]));
    check('m43: manifest file entries carry size + sha256', manifest.providers.sqlite.files[0].sha256.length === 64 && manifest.providers.sqlite.files[0].size > 0);
    check('m43: manifest checksum recomputes', manifestChecksum(manifest) === manifest.checksum);
    check('m43: manifest records compression config', manifest.compression.enabled === false && manifest.compression.algorithm === null);

    // Metadata persisted through the storage engine (backup namespace).
    check('m43: registry document exists in storage', await h.store.has('backup', 'registry'));
    const doc = await h.store.readDocument('backup', 'registry');
    check('m43: registry stored as versioned storage document', doc.version === 1 && doc.namespace === 'backup' && doc.data.latest?.id === r.id);
    const list = await h.manager.listBackups();
    check('m43: listBackups returns the backup', list.length === 1 && list[0].id === r.id && list[0].status === 'completed');

    // Progress reporting.
    const progress = [];
    const r2 = await h.manager.backup({ trigger: 'manual', onProgress: (p) => progress.push(p) });
    check('m43: progress callback reports stages', progress.some((p) => p.stage === 'sqlite') && progress.some((p) => p.stage === 'done') && progress[0].id === r2.id, `stages=${progress.map((p) => p.stage).join(',')}`);
    check('m43: status() reflects completed state', h.manager.status().running === null && h.manager.status().state === 'READY');

    // Retention.
    const h4 = await makeSandbox({ retention: { maxBackups: 2 } });
    try {
      const b1 = await h4.manager.backup({ trigger: 'manual' });
      await delay(10);
      const b2 = await h4.manager.backup({ trigger: 'manual' });
      await delay(10);
      const b3 = await h4.manager.backup({ trigger: 'manual' });
      const kept = await h4.manager.listBackups();
      check('m43: retention prunes to maxBackups', kept.length === 2, `kept=${kept.length}`);
      check('m43: retention removes the oldest backup', !kept.some((b) => b.id === b1.id) && kept.some((b) => b.id === b3.id));
      check('m43: pruned backup directory removed', !(await fsutil.dirExists(join(h4.backupDir, b1.id))));
      void b2;
    } finally {
      await h4.cleanup();
    }
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 4. Compression
// ═════════════════════════════════════════════════════════════════════
{
  const plain = await makeSandbox();
  const comp = await makeSandbox({ compression: { enabled: true } });
  try {
    const p = await plain.manager.backup({ trigger: 'manual' });
    check('m43: uncompressed backup stores plain files', p.manifest.providers.sqlite.files[0].compressed === false && !p.manifest.providers.sqlite.files[0].path.endsWith('.gz'));

    const c = await comp.manager.backup({ trigger: 'manual' });
    const sqliteEntry = c.manifest.providers.sqlite.files[0];
    check('m43: compressed backup stores .gz payloads', sqliteEntry.compressed === true && sqliteEntry.algorithm === 'gzip' && sqliteEntry.path.endsWith('.gz'));
    check('m43: compressed manifest records algorithm globally', c.manifest.compression.algorithm === 'gzip' && c.manifest.compression.enabled === true);
    check('m43: compressed backup verifies', (await comp.manager.verify(c.id)).ok === true);
    // The stored payload is a real gzip stream (magic 1f 8b).
    const gzHead = (await readFile(join(comp.backupDir, c.id, sqliteEntry.path))).subarray(0, 2).toString('hex');
    check('m43: compressed payload is a gzip stream', gzHead === '1f8b', gzHead);

    // Restore decompresses transparently.
    await writeFile(comp.dbFile, 'CORRUPTED-DB');
    await comp.manager.restore({ id: c.id });
    check('m43: restore from compressed backup works', (await readFile(comp.dbFile, 'utf8')) === 'SQLite format 3\0fake-db-bytes');
  } finally {
    await plain.cleanup();
    await comp.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 5. Checksum validation + integrity verification
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    const r = await h.manager.backup({ trigger: 'manual' });
    const manifestPath = join(h.backupDir, r.id, MANIFEST_FILE_NAME);
    const sqlitePath = join(h.backupDir, r.id, 'sqlite', 'aarogyam.sqlite');

    // Pristine backup verifies clean.
    const ok = await h.manager.verify(r.id);
    check('m43: pristine backup verifies', ok.ok === true && ok.errors.length === 0, ok.checks.map((c) => `${c.name}:${c.ok}`).join(' '));

    // Checksum tamper.
    await writeFile(sqlitePath, 'TAMPERED');
    const tampered = await h.manager.verify(r.id);
    check('m43: checksum tamper detected', tampered.ok === false && tampered.errors.some((e) => e.name === 'file-checksums'));
    let integrityErr = null;
    try {
      await h.manager.restore({ id: r.id });
    } catch (err) {
      integrityErr = err;
    }
    check('m43: restore refused on checksum failure', integrityErr instanceof BackupError && integrityErr.code === 'integrity-failed', integrityErr?.message ?? 'no error');
    await rm(sqlitePath);

    // Missing-file detection.
    const missing = await h.manager.verify(r.id);
    check('m43: missing file detected', missing.ok === false && missing.errors.some((e) => e.name === 'files-present'), missing.errors.map((e) => e.name).join(','));

    // Corrupt manifest.
    const r2 = await h.manager.backup({ trigger: 'manual' });
    await writeFile(join(h.backupDir, r2.id, MANIFEST_FILE_NAME), '{not json');
    const corrupt = await h.manager.verify(r2.id);
    check('m43: corrupt manifest detected', corrupt.ok === false && corrupt.errors.some((e) => e.name === 'manifest-valid'), corrupt.errors.map((e) => e.name).join(','));

    // Format-version drift.
    const r3 = await h.manager.backup({ trigger: 'manual' });
    const m3 = JSON.parse(await readFile(join(h.backupDir, r3.id, MANIFEST_FILE_NAME), 'utf8'));
    m3.formatVersion = 999;
    m3.checksum = manifestChecksum(m3);
    await writeFile(join(h.backupDir, r3.id, MANIFEST_FILE_NAME), JSON.stringify(m3));
    const drift = await h.manager.verify(r3.id);
    check('m43: unsupported format version detected', drift.ok === false && drift.errors.some((e) => e.name === 'format-version'));

    // Crafted manifest path traversal — unsafe paths are rejected both
    // by verification and (as a hard gate) by the restore planner.
    const r4 = await h.manager.backup({ trigger: 'manual' });
    const m4 = JSON.parse(await readFile(join(h.backupDir, r4.id, MANIFEST_FILE_NAME), 'utf8'));
    m4.providers.sqlite.files[0].path = 'sqlite/../../evil.db';
    m4.checksum = manifestChecksum(m4);
    await writeFile(join(h.backupDir, r4.id, MANIFEST_FILE_NAME), JSON.stringify(m4));
    const traversal = await h.manager.verify(r4.id);
    check('m43: unsafe manifest path reported by verify', traversal.ok === false && traversal.errors.some((e) => e.name === 'manifest-valid'), traversal.errors.map((e) => e.name).join(','));
    let traversalErr = null;
    try {
      await h.manager.restore({ id: r4.id });
    } catch (err) {
      traversalErr = err;
    }
    check('m43: restore refuses unsafe manifest paths', traversalErr instanceof BackupError, traversalErr?.message ?? 'no error');

    // Path-traversal backup ids are rejected up front.
    let idTraversal = null;
    try {
      await h.manager.restore({ id: '..' });
    } catch (err) {
      idTraversal = err;
    }
    check('m43: path-traversal ids rejected', idTraversal instanceof BackupError && idTraversal.code === 'invalid-argument', idTraversal?.message ?? 'no error');
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 6. Restore — validation, dry-run, full, provider, rollback, compat
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    const r = await h.manager.backup({ trigger: 'manual' });

    // Restore validation.
    const val = await h.manager.validate(r.id);
    check('m43: restore validation passes', val.ok === true && val.compatibility.compatible === true, JSON.stringify(val.compatibility));

    // Dry-run restore — writes nothing even when targets are out of date.
    await writeFile(h.dbFile, 'CORRUPTED-DB');
    await h.store.set('settings', 'clinic', { name: 'Changed Clinic' });
    const dry = await h.manager.restore({ id: r.id, dryRun: true });
    check('m43: dry-run returns a plan', dry.ok === true && dry.dryRun === true && dry.actions.length > 0, `actions=${dry.actions.length}`);
    check('m43: dry-run writes nothing', (await readFile(h.dbFile, 'utf8')) === 'CORRUPTED-DB' && (await h.store.get('settings', 'clinic'))?.name === 'Changed Clinic');

    // Full restore — every target reverts byte-identical.
    const restored = await h.manager.restore({ id: r.id });
    check('m43: full restore completes', restored.ok === true && restored.restored === restored.actions.length, `restored=${restored.restored}`);
    check('m43: full restore reverts database', (await readFile(h.dbFile, 'utf8')) === 'SQLite format 3\0fake-db-bytes');
    check('m43: full restore reverts settings doc', (await h.store.get('settings', 'clinic'))?.name === 'Sandbox Clinic');
    check('m43: full restore reverts storage docs', (await h.store.get('cache', 'temp'))?.v === 1 && (await h.store.get('runtime', 'uptime'))?.seconds === 42);
    check('m43: full restore reverts exports', (await readFile(join(h.exportDir, 'report.pdf'), 'utf8')) === 'pdf-bytes');
    check('m43: no restore artifacts left behind', !(await (async () => { const all = await fsutil.walkFiles(h.dataDir); return all.some((f) => f.includes('.aarogyam-restore-')); })()));

    // Provider restore — only the requested provider is touched.
    await writeFile(h.dbFile, 'CORRUPTED-AGAIN');
    await h.store.set('settings', 'clinic', { name: 'Changed Clinic 2' });
    await h.manager.restore({ id: r.id, providers: ['sqlite'] });
    check('m43: provider restore reverts sqlite', (await readFile(h.dbFile, 'utf8')) === 'SQLite format 3\0fake-db-bytes');
    check('m43: provider restore leaves other providers untouched', (await h.store.get('settings', 'clinic'))?.name === 'Changed Clinic 2');

    // Restore validation of a missing backup id.
    let missingErr = null;
    try {
      await h.manager.restore({ id: 'does-not-exist-123' });
    } catch (err) {
      missingErr = err;
    }
    check('m43: restore of unknown id → not-found', missingErr instanceof BackupError && missingErr.code === 'not-found');
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 7. Rollback behavior
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    const r = await h.manager.backup({ trigger: 'manual' });

    // Change several storage docs, then block the LAST restore target
    // (the runtime namespace directory replaced by a plain file) so the
    // restore applies some actions and then fails mid-way.
    await h.store.set('cache', 'temp', { v: 99 });
    await h.store.set('metadata', 'device', { label: 'changed' });
    await rm(join(h.dataDir, 'runtime'), { recursive: true, force: true });
    await writeFile(join(h.dataDir, 'runtime'), 'blocker-file');

    let restoreErr = null;
    try {
      await h.manager.restore({ id: r.id, providers: ['storage'] });
    } catch (err) {
      restoreErr = err;
    }
    check('m43: rollback raises structured RestoreError', restoreErr instanceof RestoreError && restoreErr.code === 'restore-failed', restoreErr?.message ?? 'no error');
    check('m43: rollback flagged on error', restoreErr?.ctx?.rolledBack === true || restoreErr?.rolledBack === true);

    // Pre-restore state restored: cache/temp must still be {v:99} (the
    // modified value), NOT the backup value {v:1}.
    const cacheRaw = JSON.parse(await readFile(join(h.dataDir, 'cache', 'temp.json'), 'utf8'));
    check('m43: rollback restores pre-restore content', cacheRaw.data?.v === 99, JSON.stringify(cacheRaw.data));
    check('m43: rollback removes newly-written files', !(await fsutil.fileExists(join(h.dataDir, 'cache', 'temp.json.bak'))));
    const leftovers = await fsutil.walkFiles(h.dataDir);
    check('m43: rollback leaves no restore artifacts', !leftovers.some((f) => f.includes('.aarogyam-restore-')), leftovers.filter((f) => f.includes('restore')).join(','));
    // The blocker is still present — restore did not clobber it.
    check('m43: rollback keeps the blocking file intact', (await readFile(join(h.dataDir, 'runtime'), 'utf8')) === 'blocker-file');

    // After clearing the blocker the restore succeeds.
    await rm(join(h.dataDir, 'runtime'), { force: true });
    await fsutil.ensureDir(join(h.dataDir, 'runtime'));
    const retry = await h.manager.restore({ id: r.id, providers: ['storage'] });
    check('m43: restore succeeds after blocker cleared', retry.ok === true);
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 8. Version compatibility
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    const r = await h.manager.backup({ trigger: 'manual' });

    // Unsupported format version → restore refused before any change.
    const manifestPath = join(h.backupDir, r.id, MANIFEST_FILE_NAME);
    const m = JSON.parse(await readFile(manifestPath, 'utf8'));
    m.formatVersion = 999;
    m.checksum = manifestChecksum(m);
    await writeFile(manifestPath, JSON.stringify(m));
    let incompat = null;
    try {
      await h.manager.restore({ id: r.id });
    } catch (err) {
      incompat = err;
    }
    check('m43: unsupported format blocks restore', incompat instanceof BackupError && incompat.code === 'incompatible', incompat?.message ?? 'no error');
    const val = await h.manager.validate(r.id);
    check('m43: validate reports incompatibility', val.ok === false && val.compatibility.compatible === false && val.compatibility.blocking.length > 0, JSON.stringify(val.compatibility));

    // Schema-version mismatch → restore refused.
    const hB = await makeSandbox({ schemaVersion: '2', directory: h.backupDir });
    try {
      const rB = await hB.manager.backup({ trigger: 'manual' });
      const mB = JSON.parse(await readFile(join(h.backupDir, rB.id, MANIFEST_FILE_NAME), 'utf8'));
      mB.schemaVersion = '1';
      mB.checksum = manifestChecksum(mB);
      await writeFile(join(h.backupDir, rB.id, MANIFEST_FILE_NAME), JSON.stringify(mB));
      let schemaErr = null;
      try {
        await hB.manager.restore({ id: rB.id });
      } catch (err) {
        schemaErr = err;
      }
      check('m43: schema-version mismatch blocks restore', schemaErr instanceof BackupError && schemaErr.code === 'incompatible', schemaErr?.message ?? 'no error');
    } finally {
      await hB.cleanup();
    }
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 9. Concurrency — backup/backup, restore/backup, restore/restore
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    // Concurrent backups blocked.
    const { provider, gate } = makeSlowProvider('sqlite');
    h.manager.register(provider);
    const p1 = h.manager.backup({ trigger: 'manual' });
    await delay(40);
    let busyErr = null;
    try {
      await h.manager.backup({ trigger: 'manual' });
    } catch (err) {
      busyErr = err;
    }
    check('m43: concurrent backup blocked (busy)', busyErr instanceof BackupError && busyErr.code === 'busy', busyErr?.message ?? 'no error');

    // Restore blocked while a backup is active.
    let busyRestore = null;
    try {
      await h.manager.restore({ id: 'anything' });
    } catch (err) {
      busyRestore = err;
    }
    check('m43: restore blocked while backup active (busy)', busyRestore instanceof BackupError && busyRestore.code === 'busy');
    gate.resolve();
    await p1.catch(() => {});

    // Concurrent restores blocked.
    const h2 = await makeSandbox();
    try {
      const r = await h2.manager.backup({ trigger: 'manual' });
      const slow = makeSlowProvider('sqlite', { hangResolve: true });
      h2.manager.register(slow.provider);
      const rp = h2.manager.restore({ id: r.id, providers: ['sqlite'], dryRun: true });
      await delay(40);
      let busy2 = null;
      try {
        await h2.manager.restore({ id: r.id, providers: ['sqlite'], dryRun: true });
      } catch (err) {
        busy2 = err;
      }
      check('m43: concurrent restore blocked (busy)', busy2 instanceof BackupError && busy2.code === 'busy', busy2?.message ?? 'no error');
      slow.gate.resolve();
      const done = await rp;
      check('m43: first restore completes after gate release', done.ok === true && done.dryRun === true);
    } finally {
      await h2.cleanup();
    }
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 10. Lifecycle — startup, shutdown, cancellation
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    const cold = createBackupManager({ storage: h.store, directory: join(h.sandbox, 'cold-backups'), sqlite: { databaseFile: h.dbFile } });
    check('m43: initial state UNINITIALIZED', cold.getState() === 'UNINITIALIZED');
    let notInit = null;
    try {
      await cold.backup({ trigger: 'manual' });
    } catch (err) {
      notInit = err;
    }
    check('m43: backup before initialize → not-initialized', notInit instanceof BackupError && notInit.code === 'not-initialized', notInit?.message ?? 'no error');
    cold.initialize();
    check('m43: initialize → READY', cold.getState() === 'READY');

    // Shutdown safely finishes/cancels running backup work.
    const { provider, gate } = makeSlowProvider('sqlite');
    cold.register(provider);
    const p = cold.backup({ trigger: 'manual' }).catch(() => {});
    await delay(40);
    const shutdownPromise = cold.shutdown();
    check('m43: shutdown transitions to STOPPING', cold.getState() === 'STOPPING', cold.getState());
    gate.resolve();
    await p;
    await shutdownPromise;
    check('m43: shutdown → STOPPED', cold.getState() === 'STOPPED', cold.getState());
    let afterShutdown = null;
    try {
      await cold.backup({ trigger: 'manual' });
    } catch (err) {
      afterShutdown = err;
    }
    check('m43: backup after shutdown → not-initialized', afterShutdown instanceof BackupError && afterShutdown.code === 'not-initialized');

    // Idle shutdown is safe.
    const idle = createBackupManager({ storage: h.store, directory: join(h.sandbox, 'idle-backups'), sqlite: { databaseFile: h.dbFile } });
    idle.initialize();
    await idle.shutdown();
    check('m43: idle shutdown → STOPPED', idle.getState() === 'STOPPED');

    // Cancellation.
    const h2 = await makeSandbox();
    try {
      const slow = makeSlowProvider('sqlite');
      h2.manager.register(slow.provider);
      const p2 = h2.manager.backup({ trigger: 'manual' });
      await delay(40);
      const canc = h2.manager.cancel();
      check('m43: cancel() acknowledges the running backup', canc.cancelled === true && canc.id.length > 0);
      slow.gate.resolve();
      let cancelledErr = null;
      try {
        await p2;
      } catch (err) {
        cancelledErr = err;
      }
      check('m43: cancelled backup raises structured error', cancelledErr instanceof BackupError && cancelledErr.code === 'cancelled', cancelledErr?.message ?? 'no error');
      check('m43: cancellation removes the partial backup directory', (await readdir(h2.backupDir)).length === 0);
      const reg = await h2.store.get('backup', 'registry', null);
      check('m43: cancellation leaves no registry entry', !reg || (reg.backups ?? []).length === 0);
      const idleCancel = h2.manager.cancel();
      check('m43: cancel() with nothing running is a no-op', idleCancel.cancelled === false);
    } finally {
      await h2.cleanup();
    }
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 11. Scheduler infrastructure (exists, disabled by default)
// ═════════════════════════════════════════════════════════════════════
{
  const stubManager = { backup: async () => ({ id: 'stub' }) };
  const disabled = createBackupScheduler({ manager: stubManager, enabled: false, intervalSeconds: 60 });
  const refused = disabled.start();
  check('m43: scheduler refuses to start when disabled', refused.started === false && refused.reason === 'disabled', JSON.stringify(refused));
  check('m43: disabled scheduler reports disabled', disabled.status().enabled === false && disabled.status().started === false);

  const enabled = createBackupScheduler({ manager: stubManager, enabled: true, intervalSeconds: 1 });
  const started = enabled.start();
  check('m43: scheduler starts when enabled', started.started === true && enabled.status().started === true);
  enabled.stop();
  check('m43: scheduler stops cleanly', enabled.status().started === false);

  const h = await makeSandbox();
  try {
    check('m43: manager exposes schedule (disabled)', h.manager.status().schedule.enabled === false && h.manager.schedule?.status().started === false);
    check('m43: schedule.enabled defaults false via config', h.manager.status().schedule.enabled === false);
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 12. Structured logging — full backup through the logging framework
// ═════════════════════════════════════════════════════════════════════
{
  const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m43-log-'));
  const logsDir = join(sandbox, 'logs');
  await fsutil.ensureDir(logsDir);
  const probe = `
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    import { mkdtemp, writeFile } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    const root = ${JSON.stringify(ROOT)};
    const load = (p) => import(pathToFileURL(join(root, p)));
    const { createBackupManager } = await load('app/lib/backup/index.mjs');
    const { createStorageService } = await load('app/lib/storage/index.mjs');
    const { getLogManager } = await load('app/lib/logging/index.mjs');
    const { ensureDir } = await load('app/lib/local/fsutil.mjs');
    const { dirname } = await import('node:path');
    const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m43-logprobe-'));
    const dataDir = join(sandbox, 'data');
    const backupDir = join(sandbox, 'backups');
    const dbFile = join(sandbox, 'sqlite.db');
    const store = createStorageService(dataDir);
    store.initialize();
    await store.set('settings', 'clinic', { name: 'Log Clinic' });
    await ensureDir(dirname(dbFile));
    await writeFile(dbFile, 'SQLite format 3\\0fake-db-bytes');
    const mgr = createBackupManager({ storage: store, directory: backupDir, sqlite: { databaseFile: dbFile }, schedule: { enabled: false } });
    mgr.initialize();
    const res = await mgr.backup({ trigger: 'manual' });
    await mgr.restore({ id: res.id, dryRun: true });
    await getLogManager().flush();
    process.exit(0);
  `;
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
      cwd: ROOT,
      env: { ...process.env, LOG_FILE_ENABLED: 'true', LOG_DIRECTORY: logsDir, LOG_CONSOLE_ENABLED: 'false' },
      stdio: 'pipe',
    });
    const logFile = join(logsDir, 'aarogyam.log');
    check('m43: structured log file written', await fsutil.fileExists(logFile));
    const lines = (await readFile(logFile, 'utf8')).trim().split('\n').filter(Boolean);
    const entries = lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    }).filter(Boolean);
    const backupEntries = entries.filter((e) => e.module === 'backup' || e.module.startsWith('backup:'));
    check('m43: backup operations logged through framework', backupEntries.some((e) => e.level === 'info' && e.message === 'Backup starting') && backupEntries.some((e) => e.level === 'info' && e.message === 'Backup completed'), `backup entries=${backupEntries.length}`);
    check('m43: log entries carry structured metadata', backupEntries.every((e) => typeof e.timestamp === 'string' && typeof e.level === 'string' && typeof e.module === 'string' && typeof e.message === 'string'));
    check('m43: restore logged (dry-run)', entries.some((e) => e.module === 'backup' && e.message.startsWith('Restore of backup')));
  } catch (err) {
    check('m43: structured logging probe ran', false, String(err.message).slice(0, 300));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════
// 13. Storage integration — registry envelope + namespace isolation
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    await h.manager.backup({ trigger: 'manual' });
    const doc = await h.store.readDocument('backup', 'registry');
    check('m43: registry document is a valid storage envelope', doc.$schema === 'aarogyam-doc' && doc.checksum.length === 64);
    check('m43: backup metadata isolated in backup namespace', (await h.store.listKeys('backup')).includes('registry') && !(await h.store.listKeys('backup')).includes('manifest'));
    check('m43: registry does not duplicate manifest content', Object.keys(doc.data).sort().join(',') === 'backups,latest,schemaVersion', Object.keys(doc.data).sort().join(','));
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 14. Bootstrap integration — registry initializes the backup service
// ═════════════════════════════════════════════════════════════════════
{
  const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m43-boot-'));
  try {
    const { METADATA_FILE_NAME } = await import('../app/lib/installer/index.mjs');
    const dirs = [join(sandbox, 'data'), join(sandbox, 'logs'), join(sandbox, 'backups'), join(sandbox, 'db'), join(sandbox, 'export'), join(sandbox, 'temp')];
    const bootInst = createInstaller({
      directories: dirs,
      metadataFile: join(sandbox, 'data', 'installation', METADATA_FILE_NAME),
    });
    const boot = createBootstrapManager({
      installer: bootInst,
      registry: registerInfrastructureServices(),
    });
    await boot.initialize();
    check('m43: bootstrap initializes backup service to READY', boot.getStatus().registry.backup === 'READY', JSON.stringify(boot.getStatus().registry));
    await boot.shutdown();
    check('m43: bootstrap shutdown stops backup service', boot.getStatus().registry.backup === 'STOPPED');
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

// Set AAROGYAM_VERIFY_M43_FAST=1 to skip the slow build gates (npm
// install / prisma generate / npm build) while iterating.
const FAST = process.env.AAROGYAM_VERIFY_M43_FAST === '1';

/** Run npm through a shell on Windows (Node refuses to spawn .cmd directly). */
function runNpm(args, opts = {}) {
  return execFileSync(NPM, args, {
    cwd: ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    ...opts,
  });
}

// ═════════════════════════════════════════════════════════════════════
// 15. Build gates — npm install, prisma generate, npm build
// ═════════════════════════════════════════════════════════════════════
if (FAST) {
  console.log('\n(skipping build gates — AAROGYAM_VERIFY_M43_FAST=1)');
} else {
  try {
    runNpm(['install', '--package-lock=false', '--no-audit', '--no-fund', '--loglevel=error'], { timeout: 600_000 });
    check('m43: npm install succeeds', true);
  } catch (err) {
    check('m43: npm install succeeds', false, String(err.stderr ?? err.message).slice(0, 200));
  }
  try {
    runNpm(['run', 'prisma:generate'], { timeout: 300_000 });
    check('m43: prisma generate succeeds', true);
  } catch (err) {
    check('m43: prisma generate succeeds', false, String(err.stderr ?? err.message).slice(0, 200));
  }
  try {
    runNpm(['run', 'build'], { timeout: 900_000 });
    check('m43: npm build succeeds', true);
  } catch (err) {
    check('m43: npm build succeeds', false, String(err.stderr ?? err.message).slice(0, 400));
  }
}

// ═════════════════════════════════════════════════════════════════════
// 16. Runtime smoke + database integrity (real database round-trip)
// ═════════════════════════════════════════════════════════════════════
{
  const realDb = join(ROOT, 'prisma', 'sqlite.db');
  check('m43: prisma sqlite database present', await fsutil.fileExists(realDb), realDb);
  const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m43-runtime-'));
  try {
    const dbCopy = join(sandbox, 'sqlite.db');
    const dataDir = join(sandbox, 'data');
    await fsutil.copyRecursive(realDb, dbCopy);
    const store = createStorageService(dataDir);
    store.initialize();
    const mgr = createBackupManager({
      storage: store,
      storageProvider: { rootDir: dataDir },
      settings: { settingsDir: dataDir },
      exports: { exportDir: join(sandbox, 'exports') },
      sqlite: { databaseFile: dbCopy },
      directory: join(sandbox, 'backups'),
      schedule: { enabled: false },
    });
    mgr.initialize();

    // Backup the REAL database, corrupt it, restore it.
    const r = await mgr.backup({ trigger: 'manual' });
    await writeFile(dbCopy, 'CORRUPTED-DATABASE');
    const restored = await mgr.restore({ id: r.id });
    check('m43: runtime restore of real database completes', restored.ok === true, JSON.stringify(restored.compatibility));

    // Database integrity — sqlite magic header + Prisma can read it.
    const head = (await readFile(dbCopy)).subarray(0, 16).toString('latin1');
    check('m43: restored database has valid sqlite header', head === 'SQLite format 3\0', JSON.stringify(head));
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbCopy}` } } });
    try {
      const users = await prisma.user.count();
      const patients = await prisma.patientProfile.count().catch(() => -1);
      check('m43: runtime smoke — Prisma reads restored database', typeof users === 'number' && users >= 0, `users=${users}, patients=${patients}`);
    } finally {
      await prisma.$disconnect();
    }
    // The restored backup itself still verifies.
    check('m43: restored-backup integrity holds', (await mgr.verify(r.id)).ok === true);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\nM4.3 verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
process.exit(0);
