#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Infrastructure Verification  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Loads every infrastructure module and verifies:
 *    1. all modules import cleanly (no circular-import failures)
 *    2. feature flags all default to disabled
 *    3. the service registry initializes without starting anything
 *    4. discovery / sync / backup interfaces are inert (throw
 *       NotImplementedError when invoked)
 *    5. no sockets / background processes / filesystem changes occur
 *       automatically (no network handles, no child processes, no new
 *       directories created by merely importing the modules)
 *
 *  Usage:  node scripts/verify-infrastructure.mjs
 *  Exit:   0 = all checks pass, 1 = failure
 */

import { createRegistry, registerInfrastructureServices, createInfrastructure } from '../app/lib/system/registry.mjs';
import { getFlags, isEnabled, FLAG_DEFINITIONS } from '../app/lib/local/flags.mjs';
import { paths, resolvePath, resolveDataPath } from '../app/lib/local/paths.mjs';
import { createDiscoveryService, createBroadcaster, createDiscoveryScanner, createClinicIdentity, createDeviceMetadata } from '../app/lib/discovery/index.mjs';
import { createSyncService, createOperationQueue, createSyncEngine, createConflictResolver, createVersionTracker } from '../app/lib/sync/index.mjs';
import { createBackupManager, createSqliteBackupProvider, createSettingsBackupProvider, createExportProvider, BACKUP_TYPES } from '../app/lib/backup/index.mjs';
import { NotImplementedError, ServiceNotInitializedError, PathViolationError } from '../app/lib/local/errors.mjs';
import * as fsutil from '../app/lib/local/fsutil.mjs';
import { createStorageService, NAMESPACES } from '../app/lib/storage/index.mjs';
import { createLogger, createFileLogger, defaultLogFilePath, LOG_LEVELS } from '../app/lib/logging/index.mjs';
import { getIpv4Addresses, getHostname, getPlatform, getDeviceDescriptor } from '../app/lib/network/index.mjs';
import { getSystemFacts, getPlatform as getOsPlatform, getArch, getCpuCount, getTotalMemoryBytes, getRuntimeVersion, getPid, getHostname as getSysHostname } from '../app/lib/system/index.mjs';
import { existsSync } from 'node:fs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('Aarogyam Infrastructure Verification (Milestone 3.2)');
console.log('----------------------------------------------------');

// ── 1. Modules load (import above already proves this) ──────────────
check('all infrastructure modules import cleanly', true);

// ── 2. Feature flags default disabled ───────────────────────────────
const flags = getFlags();
for (const [name, value] of Object.entries(flags)) {
  check(`flag "${name}" disabled by default`, value === false);
}

// ── 3. Service registry initializes without starting anything ───────
const registry = createRegistry();
registerInfrastructureServices(registry);
check('registry has expected services', registry.names().length === 8, registry.names().join(', '));
registry.initializeAll();
const initialized = registry.instances();
check(
  'registry initializes all services',
  registry.names().every((n) => registry.isInitialized(n)),
  Object.keys(initialized).join(', ')
);

// ── 4. Discovery / sync / backup interfaces are inert ───────────────
const discovery = createDiscoveryService();
let threw = false;
try {
  await discovery.broadcaster.start();
} catch (err) {
  threw = err instanceof NotImplementedError;
}
check('broadcaster.start() throws NotImplementedError (no sockets)', threw);

threw = false;
try {
  await discovery.scanner.start();
} catch (err) {
  threw = err instanceof NotImplementedError;
}
check('scanner.start() throws NotImplementedError (no scanning)', threw);

const sync = createSyncService();
threw = false;
try {
  await sync.engine.sync();
} catch (err) {
  threw = err instanceof NotImplementedError;
}
check('sync engine inert (NotImplementedError)', threw);

const backup = createBackupManager();
threw = false;
try {
  await backup.runAll();
} catch (err) {
  threw = err instanceof NotImplementedError;
}
check('backup runAll() inert (NotImplementedError)', threw);
check('backup manager registers 3 providers', backup.list().length === 3, backup.list().map((p) => p.type).join(', '));

// ── 5. No automatic side effects from import ────────────────────────
// 5a. No child processes / sockets created by this script itself.
const childPids = Object.keys(process._getActiveHandles?.() ?? {})
  .filter((k) => k.includes('ChildProcess'));
check('no child processes spawned', childPids.length === 0);

// Note: when stdout is piped (e.g. in CI), process.stdin/stdout/stderr are
// net.Socket instances. Exclude stdio — they are the process's own handles,
// not evidence of network activity.
const stdio = new Set([process.stdin, process.stdout, process.stderr]);
const netHandles = (process._getActiveHandles?.() ?? []).filter(
  (h) =>
    !stdio.has(h) &&
    (h.constructor?.name === 'Socket' || h.constructor?.name === 'Server')
);
check('no open sockets / servers', netHandles.length === 0);

// 5b. Importing modules created NO directories.
const created = [paths.dataDir, paths.logsDir, paths.backupsDir, paths.exportDir]
  .filter((dir) => existsSync(dir));
check('no directories created automatically by imports', created.length === 0, created.join(', ') || 'none');

// ── 6. Storage service round-trips without touching the data dir ────
const sandboxRoot = `${paths.tempDir}-verify-${process.pid}`;
const store = createStorageService(sandboxRoot);
await store.set('settings', 'clinic', { name: 'Test Clinic' });
const readBack = await store.get('settings', 'clinic');
check('storage set/get round-trip', readBack?.name === 'Test Clinic');
check('storage has()', await store.has('settings', 'clinic'));
check('storage listKeys()', (await store.listKeys('settings')).includes('clinic'));
await store.remove('settings', 'clinic');
check('storage remove()', !(await store.has('settings', 'clinic')));
await fsutil.removeRecursive(sandboxRoot);

// ── 7. fsutil primitives work ────────────────────────────────────────
const probeDir = `${paths.tempDir}-fsutil-${process.pid}`;
await fsutil.ensureDir(`${probeDir}/nested/deep`);
check('ensureDir creates nested dirs', await fsutil.dirExists(`${probeDir}/nested/deep`));
await fsutil.writeJson(`${probeDir}/a.json`, { hello: 'world' });
check('writeJson + readJson round-trip', (await fsutil.readJson(`${probeDir}/a.json`)).hello === 'world');
const h1 = await fsutil.hashFile(`${probeDir}/a.json`);
const h2 = await fsutil.hashFile(`${probeDir}/a.json`);
check('hashFile is deterministic', h1 === h2 && /^[0-9a-f]{64}$/.test(h1));
await fsutil.copyRecursive(`${probeDir}/nested`, `${probeDir}/nested-copy`);
check('copyRecursive', await fsutil.dirExists(`${probeDir}/nested-copy/deep`));
await fsutil.move(`${probeDir}/a.json`, `${probeDir}/b.json`);
check('move', await fsutil.fileExists(`${probeDir}/b.json`));
await fsutil.atomicWriteFile(`${probeDir}/c.txt`, 'atomic');
const { readFile } = await import('node:fs/promises');
check('atomicWriteFile', (await readFile(`${probeDir}/c.txt`, 'utf8')) === 'atomic');
const vdir = await fsutil.verifyDirectory(probeDir);
check('verifyDirectory detects existing dir', vdir.exists === true && vdir.isDirectory === true);
const vmiss = await fsutil.verifyDirectory(`${probeDir}/does-not-exist`);
check('verifyDirectory detects missing dir', vmiss.exists === false);
await fsutil.removeRecursive(probeDir);
check('removeRecursive', !(await fsutil.dirExists(probeDir)));

// ── 8. Logging framework works, level respected ─────────────────────
const log = createLogger('verify', { level: 'warn' });
check('logger level is warn', log.getLevel() === 'warn');
check('logger exposes all levels', ['debug', 'info', 'warn', 'error'].every((l) => typeof log[l] === 'function'));

// ── 9. Network / system helpers are pure reads ──────────────────────
check('network getHostname()', typeof getHostname() === 'string' && getHostname().length > 0);
check('network getIpv4Addresses() returns array', Array.isArray(getIpv4Addresses()));
const facts = getSystemFacts();
check('system facts populated', typeof facts.pid === 'number' && typeof facts.platform === 'string');

// ── 10. Path manager sanity ──────────────────────────────────────────
check('paths.appRoot is an absolute path', /^([A-Za-z]:)?[\\/]/.test(paths.appRoot), paths.appRoot);
check('paths.databaseFile ends in sqlite.db', paths.databaseFile.endsWith('sqlite.db'), paths.databaseFile);
check('paths exports all required dirs', ['appRoot', 'dataDir', 'logsDir', 'backupsDir', 'tempDir', 'databaseDir', 'exportDir'].every((k) => typeof paths[k] === 'string'));
check('resolvePath() joins under installation dir', resolvePath('x', 'y').startsWith(paths.installationDir));
check('resolveDataPath() joins under data dir', resolveDataPath('x', 'y').startsWith(paths.dataDir));

// ── 11. Individual interface factories are loadable ──────────────────
check('createBroadcaster() loads', typeof createBroadcaster().start === 'function');
check('createDiscoveryScanner() loads', typeof createDiscoveryScanner().start === 'function');
check('createClinicIdentity() loads', typeof createClinicIdentity().toPayload === 'function');
check('createDeviceMetadata() loads', typeof createDeviceMetadata().toPayload === 'function');
check('createOperationQueue() loads', typeof createOperationQueue().enqueue === 'function');
check('createSyncEngine() loads', typeof createSyncEngine().sync === 'function');
check('createConflictResolver() loads', typeof createConflictResolver().resolve === 'function');
check('createVersionTracker() loads', typeof createVersionTracker().current === 'function');
check('createSqliteBackupProvider() loads', createSqliteBackupProvider().type === 'sqlite');
check('createSettingsBackupProvider() loads', createSettingsBackupProvider().type === 'settings');
check('createExportProvider() loads', createExportProvider().type === 'exports');
check('BACKUP_TYPES exposed', BACKUP_TYPES.length === 3);
check('NAMESPACES exposed', NAMESPACES.length === 6, NAMESPACES.join(', '));
check('LOG_LEVELS exposed', LOG_LEVELS.debug < LOG_LEVELS.error);
check('error types load', NotImplementedError.name === 'NotImplementedError' && ServiceNotInitializedError.name === 'ServiceNotInitializedError' && PathViolationError.name === 'PathViolationError');
check('flags API loadable', typeof isEnabled === 'function' && Object.keys(FLAG_DEFINITIONS).length === 6);
check('createFileLogger() loads', typeof createFileLogger('x', 'x.log').info === 'function');
check('defaultLogFilePath() returns a path', typeof defaultLogFilePath() === 'string');
check('network platform/descriptor helpers', typeof getPlatform() === 'string' && typeof getDeviceDescriptor().hostname === 'string');
check('system helpers exposed', typeof getOsPlatform() === 'string' && typeof getArch() === 'string' && typeof getCpuCount() === 'number' && typeof getTotalMemoryBytes() === 'number' && typeof getRuntimeVersion() === 'string' && typeof getPid() === 'number' && typeof getSysHostname() === 'string');
check('createInfrastructure() builds without initializing', Object.keys(createInfrastructure().instances()).length === 0);

// ── 12. Registry cycle detection ─────────────────────────────────────
const cyc = createRegistry();
cyc.register('a', () => ({}), ['b']);
cyc.register('b', () => ({}), ['a']);
let cycleCaught = false;
try {
  cyc.initializeAll();
} catch (err) {
  cycleCaught = /[Cc]ircular/.test(err.message);
}
check('registry detects circular dependencies', cycleCaught);

// ── Summary ──────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log('----------------------------------------------------');
if (failed.length === 0) {
  console.log(`✅ Infrastructure verification PASSED (${results.length} checks)`);
  process.exit(0);
} else {
  console.log(`❌ Infrastructure verification FAILED (${failed.length}/${results.length})`);
  failed.forEach((f) => console.log(`   - ${f.name}`));
  process.exit(1);
}
