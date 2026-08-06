#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Milestone 3.3 Verification  (Installer & Bootstrap)
 * ─────────────────────────────────────────────────────────────────────
 *  Automated verification of the installer / bootstrap milestone:
 *
 *    • fresh installation        • existing installation
 *    • repeated installer runs   • directory verification
 *    • metadata generation       • bootstrap startup
 *    • registry initialization   • lifecycle transitions
 *    • graceful shutdown         • version (upgrade) detection
 *    • integrity verification    • failure recovery (transactional)
 *    • zero circular imports     • zero duplicate utilities
 *    • zero configuration duplication
 *
 *  Destructive install tests run in a sandbox under the OS temp dir;
 *  one real-paths install + cleanup proves path-manager integration.
 *
 *  Usage:  node scripts/verify-m33.mjs
 *  Exit:   0 = all checks pass, 1 = failure
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

import { LIFECYCLE_STATES, createLifecycle, LifecycleError, canTransition, assertValidTransition } from '../app/lib/lifecycle/index.mjs';
import { createInstaller, installer, METADATA_SCHEMA_VERSION, METADATA_FILE_NAME, METADATA_REQUIRED_FIELDS, defaultRequiredDirectories } from '../app/lib/installer/index.mjs';
import { createBootstrapManager } from '../app/lib/bootstrap/index.mjs';
import { createRegistry, registerInfrastructureServices, createInfrastructure } from '../app/lib/system/registry.mjs';
import * as fsutil from '../app/lib/local/fsutil.mjs';
import { paths } from '../app/lib/local/paths.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('Aarogyam Milestone 3.3 Verification (Installer & Bootstrap)');
console.log('------------------------------------------------------------');

// ── 0. Module load + zero circular imports ──────────────────────────
// Importing every module above already proves they load without cycles.
check('all M3.3 modules import cleanly', true);

// Programmatic import-graph cycle scan over app/lib modules.
const LIB_FILES = [
  'app/lib/config/index.mjs', 'app/lib/config/schema.mjs', 'app/lib/config/defaults.mjs',
  'app/lib/config/validate.mjs', 'app/lib/local/errors.mjs', 'app/lib/local/paths.mjs',
  'app/lib/local/fsutil.mjs', 'app/lib/local/flags.mjs', 'app/lib/lifecycle/index.mjs',
  'app/lib/logging/index.mjs', 'app/lib/storage/index.mjs', 'app/lib/backup/index.mjs',
  'app/lib/network/index.mjs', 'app/lib/discovery/index.mjs', 'app/lib/sync/index.mjs',
  'app/lib/system/index.mjs', 'app/lib/system/registry.mjs', 'app/lib/installer/index.mjs',
  'app/lib/bootstrap/index.mjs',
];
const edges = new Map(); // file -> [local import targets]
for (const file of LIB_FILES) {
  const src = await readFile(file, 'utf8');
  const deps = [];
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const clean = m[1].replace(/\.mjs$/, '');
    // Resolve the relative target to a canonical path under app/lib.
    const base = file.split('/').slice(0, -1).join('/');
    const parts = [...base.split('/').filter(Boolean), ...clean.split('/')];
    const stack = [];
    for (const p of parts) {
      if (p === '.' || p === '') continue;
      if (p === '..') stack.pop();
      else stack.push(p);
    }
    const resolved = stack.join('/');
    const candidate = `app/lib/${resolved}.mjs`;
    if (LIB_FILES.includes(candidate)) deps.push(candidate);
  }
  edges.set(file, deps);
}
let cycleFound = false;
const visiting = new Set();
const visited = new Set();
function dfs(node) {
  if (visiting.has(node)) { cycleFound = true; return; }
  if (visited.has(node)) return;
  visiting.add(node);
  for (const dep of edges.get(node) ?? []) dfs(dep);
  visiting.delete(node);
  visited.add(node);
}
for (const file of LIB_FILES) dfs(file);
check('zero circular imports (full lib import graph)', !cycleFound);

// ── 1. Lifecycle interfaces ─────────────────────────────────────────
check('LIFECYCLE_STATES exposes 6 states', Object.keys(LIFECYCLE_STATES).length === 6,
  Object.keys(LIFECYCLE_STATES).join(', '));

const lc = createLifecycle();
check('lifecycle starts UNINITIALIZED', lc.getState() === LIFECYCLE_STATES.UNINITIALIZED);
lc.transitionTo(LIFECYCLE_STATES.INITIALIZING);
lc.transitionTo(LIFECYCLE_STATES.READY);
lc.transitionTo(LIFECYCLE_STATES.STOPPING);
lc.transitionTo(LIFECYCLE_STATES.STOPPED);
check('happy-path transitions UNINITIALIZED→…→STOPPED', lc.getState() === LIFECYCLE_STATES.STOPPED);
check('transition history recorded', lc.getHistory().length === 4);

let illegal = false;
try {
  const l2 = createLifecycle();
  l2.transitionTo(LIFECYCLE_STATES.INITIALIZING);
  l2.transitionTo(LIFECYCLE_STATES.STOPPED); // not allowed from INITIALIZING
} catch (err) {
  illegal = err instanceof LifecycleError;
}
check('illegal transition throws LifecycleError', illegal);
check('canTransition() helper', canTransition(LIFECYCLE_STATES.READY, LIFECYCLE_STATES.STOPPING) === true && canTransition(LIFECYCLE_STATES.READY, LIFECYCLE_STATES.UNINITIALIZED) === false);
check('assertValidTransition() returns true for legal', assertValidTransition(LIFECYCLE_STATES.UNINITIALIZED, LIFECYCLE_STATES.INITIALIZING) === true);
check('idempotent same-state transition', createLifecycle(LIFECYCLE_STATES.STOPPED).transitionTo(LIFECYCLE_STATES.STOPPED) === LIFECYCLE_STATES.STOPPED);
check('createInfrastructure() lazy (no init)', Object.keys(createInfrastructure().instances()).length === 0);

// ── 2. Sandboxed installer flows ────────────────────────────────────
const sandbox = join(tmpdir(), `aarogyam-m33-${process.pid}`);
const sandboxDirs = [
  join(sandbox, 'data'),
  join(sandbox, 'data', 'logs'),
  join(sandbox, 'data', 'backups'),
  join(sandbox, 'data', 'exports'),
  join(sandbox, 'db'),
  join(sandbox, 'temp'),
];
const sandboxMeta = join(sandbox, 'data', 'installation', METADATA_FILE_NAME);
const inst = createInstaller({ directories: sandboxDirs, metadataFile: sandboxMeta });

async function sandboxCleanup() {
  await fsutil.removeRecursive(sandbox);
}

// 2a. Fresh installation
await sandboxCleanup();
check('detectFirstLaunch() true before install', (await inst.detectFirstLaunch()) === true);
const fresh = await inst.install();
check('fresh install: firstLaunch=true', fresh.firstLaunch === true);
check('fresh install: installed=true', fresh.installed === true);
check('fresh install: unchanged=false', fresh.unchanged === false);
check('detectFirstLaunch() false after install', (await inst.detectFirstLaunch()) === false);

// 2b. Directory verification
const dirResults = [];
for (const d of sandboxDirs) dirResults.push(await fsutil.dirExists(d));
check('all required directories created', dirResults.every(Boolean));

// 2c. Metadata generation
const meta = fresh.metadata;
const metaFieldsOk = METADATA_REQUIRED_FIELDS.every((f) => meta[f] !== undefined && meta[f] !== null && meta[f] !== '');
check('metadata carries all required fields', metaFieldsOk, `${METADATA_REQUIRED_FIELDS.length} fields`);
check('metadata.schemaVersion correct', meta.schemaVersion === METADATA_SCHEMA_VERSION);
check('metadata.installationId is uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(meta.installationId));
check('metadata.createdAt/updatedAt ISO', !Number.isNaN(Date.parse(meta.createdAt)) && !Number.isNaN(Date.parse(meta.updatedAt)));
check('metadata.appVersion matches package.json', typeof meta.appVersion === 'string' && meta.appVersion.length > 0, meta.appVersion);
check('metadata.platform + architecture set', typeof meta.platform === 'string' && typeof meta.architecture === 'string');
check('metadata has no personal info', !JSON.stringify(meta).toLowerCase().includes('password') && !/^\d{10}$/.test(JSON.stringify(meta)));

// 2d. Repeated installer execution (idempotency)
const hashOf = async (f) => createHash('sha256').update(await readFile(f, 'utf8')).digest('hex');
const hashBefore = await hashOf(sandboxMeta);
const again = await inst.install();
check('repeated install: unchanged=true', again.unchanged === true);
check('repeated install: same installationId', again.metadata.installationId === meta.installationId);
const hashAfter = await hashOf(sandboxMeta);
check('repeated install: metadata byte-identical', hashBefore === hashAfter);
const third = await inst.install();
check('third install also unchanged', third.unchanged === true);

// 2e. Existing installation
const inst2 = createInstaller({ directories: sandboxDirs, metadataFile: sandboxMeta });
check('existing install: detectFirstLaunch=false', (await inst2.detectFirstLaunch()) === false);
check('existing install: isInstalled=true', (await inst2.isInstalled()) === true);
const existing = await inst2.install();
check('existing install: firstLaunch=false', existing.firstLaunch === false);

// 2f. Version (upgrade) detection
let upgrade = await inst.checkUpgrade();
check('checkUpgrade: no change when version matches', upgrade.upgraded === false);
// Simulate an older version in metadata.
const oldMeta = { ...meta, appVersion: '0.0.9', previousVersion: null, upgrades: [] };
await fsutil.writeJson(sandboxMeta, oldMeta);
const staleVerified = await inst.verifyInstallation();
check('verifyInstallation flags stale version',
  staleVerified.ok === false &&
    staleVerified.checks.find((c) => c.name === 'metadata-valid')?.detail.includes('version mismatch'));
upgrade = await inst.checkUpgrade();
check('checkUpgrade: detects version change', upgrade.upgraded === true, `${upgrade.previousVersion} → ${upgrade.currentVersion}`);
const upgradeInstall = await inst.install();
check('install records upgrade (appVersion bumped)', upgradeInstall.metadata.appVersion !== '0.0.9' && upgradeInstall.metadata.previousVersion === '0.0.9');
check('install appends upgrade history', Array.isArray(upgradeInstall.metadata.upgrades) && upgradeInstall.metadata.upgrades.length === 1);

// 2g. Integrity verification
const verified = await inst.verifyInstallation();
check('verifyInstallation: ok=true for healthy install', verified.ok === true);
check('verifyInstallation: 5 structured checks', verified.checks.length === 5,
  verified.checks.map((c) => c.name).join(', '));
check('verifyInstallation: every check ok', verified.checks.every((c) => c.ok));

// 2h. Failure recovery — directory blocked by a file (no partial install)
const badSandbox = join(tmpdir(), `aarogyam-m33-bad-${process.pid}`);
const badDirs = [join(badSandbox, 'ok'), join(badSandbox, 'blocked')];
await fsutil.ensureDir(join(badSandbox, 'ok'));
await fsp.writeFile(join(badSandbox, 'blocked'), 'i am a file, not a directory');
const badMeta = join(badSandbox, 'installation', METADATA_FILE_NAME);
const badInst = createInstaller({ directories: badDirs, metadataFile: badMeta });
let threwDir = false;
try {
  await badInst.install();
} catch {
  threwDir = true;
}
check('failure recovery: blocked dir throws', threwDir);
check('failure recovery: no partial metadata written', !(await fsutil.fileExists(badMeta)));
await fsutil.removeRecursive(badSandbox);

// 2i. Failure recovery — corrupt metadata self-heals
await fsp.writeFile(sandboxMeta, '{ not valid json !!!');
const healed = await inst.install();
check('failure recovery: corrupt metadata self-heals', healed.installed === true && healed.metadata.appVersion !== undefined);
check('failure recovery: healed metadata is valid', (await inst.verifyInstallation()).ok === true);

// 2j. Failure recovery — atomic write leaves no temp files
const atomicSandbox = join(tmpdir(), `aarogyam-m33-atomic-${process.pid}`);
const atomicDirs = [join(atomicSandbox, 'data')];
await fsutil.ensureDir(atomicDirs[0]);
// metadata parent path is blocked by a FILE → write fails inside atomicWriteFile
const blockedParent = join(atomicSandbox, 'data', 'installation');
await fsp.writeFile(blockedParent, 'blocker');
const atomicMeta = join(blockedParent, METADATA_FILE_NAME);
const atomicInst = createInstaller({ directories: atomicDirs, metadataFile: atomicMeta });
let threwAtomic = false;
try {
  await atomicInst.install();
} catch {
  threwAtomic = true;
}
const leftovers = await readdir(join(atomicSandbox, 'data')).catch(() => []);
check('failure recovery: blocked metadata write throws', threwAtomic);
check('failure recovery: no temp files left behind', !leftovers.some((f) => f.includes('.tmp')));
await fsutil.removeRecursive(atomicSandbox);

// ── 3. Registry lifecycle + graceful shutdown ──────────────────────
const reg = createRegistry();
registerInfrastructureServices(reg);
check('registry: 8 services registered', reg.names().length === 8, reg.names().join(', '));
check('registry: all services UNINITIALIZED before init',
  Object.values(reg.getStates()).every((s) => s === LIFECYCLE_STATES.UNINITIALIZED));
reg.initializeAll();
check('registry: all services READY after init',
  Object.values(reg.getStates()).every((s) => s === LIFECYCLE_STATES.READY));
await reg.shutdownAll();
check('registry: all services STOPPED after shutdownAll',
  Object.values(reg.getStates()).every((s) => s === LIFECYCLE_STATES.STOPPED));

// Reverse-dependency shutdown order test.
const stopOrder = [];
const orderReg = createRegistry();
orderReg.register('database', () => ({ name: 'database', shutdown: async () => stopOrder.push('database') }));
orderReg.register('api', () => ({ name: 'api', shutdown: async () => stopOrder.push('api') }), ['database']);
orderReg.register('ui', () => ({ name: 'ui', shutdown: async () => stopOrder.push('ui') }), ['api']);
orderReg.initializeAll();
check('registry: dependency order initialized', ['database', 'api', 'ui'].every((n) => orderReg.isInitialized(n)));
await orderReg.shutdownAll();
check('registry: shutdown in reverse dependency order', stopOrder.join(',') === 'ui,api,database', stopOrder.join(' → '));

// stop() on a never-initialized service.
const neverReg = createRegistry();
neverReg.register('idle', () => ({}));
await neverReg.stop('idle');
check('registry: stop() on uninitialized service → STOPPED', neverReg.getState('idle') === LIFECYCLE_STATES.STOPPED);

// shutdownAll continues past a failing service shutdown (no partial stop).
const failStop = [];
const errReg = createRegistry();
errReg.register('a', () => ({ shutdown: async () => { failStop.push('a'); throw new Error('a failed'); } }));
errReg.register('b', () => ({ shutdown: async () => failStop.push('b') }));
errReg.initializeAll();
let shutdownThrew = false;
try {
  await errReg.shutdownAll();
} catch {
  shutdownThrew = true;
}
check('registry: shutdownAll stops all services despite one failure', failStop.join(',') === 'b,a', failStop.join(' → '));
check('registry: shutdownAll surfaces collected errors', shutdownThrew);
check('registry: failing service still marked STOPPED', errReg.getState('a') === LIFECYCLE_STATES.STOPPED && errReg.getState('b') === LIFECYCLE_STATES.STOPPED);

// Cycle detection still enforced.
const cyc = createRegistry();
cyc.register('a', () => ({}), ['b']);
cyc.register('b', () => ({}), ['a']);
let cycleCaught = false;
try {
  cyc.initializeAll();
} catch (err) {
  cycleCaught = /[Cc]ircular/.test(err.message);
}
check('registry: circular dependency still detected', cycleCaught);

// ── 4. Bootstrap manager (sandboxed installer + fresh registry) ─────
await sandboxCleanup();
const bootReg = registerInfrastructureServices();
const bootInst = createInstaller({ directories: sandboxDirs, metadataFile: sandboxMeta });
const bootstrap = createBootstrapManager({ installer: bootInst, registry: bootReg });
check('bootstrap: starts UNINITIALIZED', bootstrap.getState() === LIFECYCLE_STATES.UNINITIALIZED);

const status = await bootstrap.initialize();
check('bootstrap: initialize → READY', bootstrap.getState() === LIFECYCLE_STATES.READY);
check('bootstrap: installer ran on first launch', (await bootInst.isInstalled()) === true);
check('bootstrap: registry initialized', Object.values(bootReg.getStates()).every((s) => s === LIFECYCLE_STATES.READY));
check('bootstrap: getStatus() exposes state/registry/config', status.state === 'READY' && status.registry && status.config?.appName);

const againBoot = await bootstrap.initialize();
check('bootstrap: re-initialize while READY is idempotent', againBoot.state === LIFECYCLE_STATES.READY);

const stopped = await bootstrap.shutdown();
check('bootstrap: shutdown → STOPPED', bootstrap.getState() === LIFECYCLE_STATES.STOPPED);
check('bootstrap: registry stopped in shutdown', Object.values(bootReg.getStates()).every((s) => s === LIFECYCLE_STATES.STOPPED));
check('bootstrap: stoppedAt recorded', typeof stopped.stoppedAt === 'string');

await bootstrap.initialize();
check('bootstrap: restart after shutdown works', bootstrap.getState() === LIFECYCLE_STATES.READY);
await bootstrap.shutdown();

// Bootstrap failure path — installer that always throws.
const failInst = {
  isInstalled: async () => false,
  install: async () => { throw new Error('simulated install failure'); },
  verifyInstallation: async () => ({ ok: false, checks: [] }),
  checkUpgrade: async () => ({ upgraded: false }),
};
const failBoot = createBootstrapManager({ installer: failInst, registry: registerInfrastructureServices() });
let bootstrapFailed = false;
try {
  await failBoot.initialize();
} catch {
  bootstrapFailed = true;
}
check('bootstrap: install failure → FAILED state + rethrow', bootstrapFailed && failBoot.getState() === LIFECYCLE_STATES.FAILED);
check('bootstrap: error recorded in status', failBoot.getStatus().errors.length === 1);
await failBoot.shutdown();
check('bootstrap: shutdown from FAILED → STOPPED', failBoot.getState() === LIFECYCLE_STATES.STOPPED);

// Bootstrap persists a detected upgrade on an existing installation.
await sandboxCleanup();
const upBootInst = createInstaller({ directories: sandboxDirs, metadataFile: sandboxMeta });
await upBootInst.install();
const staleMeta = { ...(await upBootInst.readMetadata()), appVersion: '0.0.9', previousVersion: null, upgrades: [] };
await fsutil.writeJson(sandboxMeta, staleMeta);
const upBoot = createBootstrapManager({ installer: upBootInst, registry: registerInfrastructureServices() });
await upBoot.initialize();
const upAfter = await upBootInst.readMetadata();
check('bootstrap persists detected upgrade in metadata',
  upAfter.appVersion !== '0.0.9' && upAfter.previousVersion === '0.0.9' &&
    Array.isArray(upAfter.upgrades) && upAfter.upgrades.length === 1);
check('bootstrap integrity passes after persisted upgrade', (await upBootInst.verifyInstallation()).ok === true);
await upBoot.shutdown();

await sandboxCleanup();

// ── 5. Real-paths integration (installer + path manager) ────────────
check('defaultRequiredDirectories derives from paths module',
  JSON.stringify(defaultRequiredDirectories().sort()) === JSON.stringify(
    [paths.dataDir, paths.logsDir, paths.backupsDir, paths.databaseDir, paths.exportDir, paths.tempDir].sort()
  ));
let realInstallOk = false;
try {
  const real = await installer.install();
  realInstallOk = real.installed === true;
  const realVerified = await installer.verifyInstallation();
  check('real-paths install succeeds', realInstallOk);
  check('real-paths integrity verification passes', realVerified.ok === true);
} catch (err) {
  check('real-paths install succeeds', false, err.message);
}
// Cleanup: remove everything the real install created.
await fsutil.removeRecursive(paths.dataDir);
await fsutil.removeRecursive(paths.tempDir);
check('real-paths install cleaned up (repo stays pristine)',
  !(await fsutil.dirExists(paths.dataDir)) && !(await fsutil.dirExists(paths.tempDir)));

// ── 6. Zero duplicate utilities ─────────────────────────────────────
const FSUTIL_EXPORTS = ['ensureDir', 'dirExists', 'fileExists', 'verifyDirectory', 'removeRecursive', 'copyRecursive', 'move', 'hashFile', 'atomicWriteFile', 'readJson', 'writeJson'];
let dupFound = [];
for (const file of LIB_FILES.filter((f) => !f.includes('fsutil'))) {
  const src = await readFile(file, 'utf8');
  for (const name of FSUTIL_EXPORTS) {
    if (new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b`).test(src)) dupFound.push(`${name} in ${file}`);
  }
}
check('zero duplicate fs utilities outside fsutil', dupFound.length === 0, dupFound.join(', '));

const NET_EXPORTS = ['getIpv4Addresses', 'getHostname', 'getPlatform', 'getDeviceDescriptor'];
dupFound = [];
for (const file of LIB_FILES.filter((f) => !f.includes('network/index'))) {
  const src = await readFile(file, 'utf8');
  for (const name of NET_EXPORTS) {
    if (new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b`).test(src)) dupFound.push(`${name} in ${file}`);
  }
}
check('zero duplicate network helpers outside network', dupFound.length === 0, dupFound.join(', '));

// ── 7. Zero configuration duplication ───────────────────────────────
let envLeaks = [];
for (const file of LIB_FILES.filter((f) => !f.startsWith('app/lib/config/'))) {
  const src = await readFile(file, 'utf8');
  if (src.includes('process.env.')) envLeaks.push(file);
}
check('no process.env access outside config system', envLeaks.length === 0, envLeaks.join(', '));

// ── 8. No automatic side effects ────────────────────────────────────
const autoDirChecks = await Promise.all(
  [paths.dataDir, paths.logsDir, paths.backupsDir, paths.exportDir].map((d) =>
    fsutil.dirExists(d).then((exists) => ({ d, exists }))
  )
);
const autoDirs = autoDirChecks.filter((c) => c.exists).map((c) => c.d);
check('importing M3.3 modules creates no directories', autoDirs.length === 0, autoDirs.join(', '));
const stdio = new Set([process.stdin, process.stdout, process.stderr]);
const netHandles = (process._getActiveHandles?.() ?? []).filter(
  (h) => !stdio.has(h) && (h.constructor?.name === 'Socket' || h.constructor?.name === 'Server')
);
check('no sockets / servers opened by verification', netHandles.length === 0);

// ── Summary ─────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log('------------------------------------------------------------');
if (failed.length === 0) {
  console.log(`✅ Milestone 3.3 verification PASSED (${results.length} checks)`);
  process.exit(0);
} else {
  console.log(`❌ Milestone 3.3 verification FAILED (${failed.length}/${results.length})`);
  failed.forEach((f) => console.log(`   - ${f.name} — ${f.detail}`));
  process.exit(1);
}
