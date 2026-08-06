#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Milestone 4.1 Verification  (Storage Engine)
 * ─────────────────────────────────────────────────────────────────────
 *  Automated verification of the completed storage engine:
 *
 *    • namespace isolation          • document persistence
 *    • atomic writes                • crash recovery
 *    • transaction commit           • transaction rollback
 *    • cache correctness            • cache invalidation
 *    • concurrent access            • integrity verification
 *    • corrupted document handling  • lifecycle startup
 *    • lifecycle shutdown           • graceful write flushing
 *    • zero circular imports        • zero duplicate utilities
 *    • zero configuration duplication
 *
 *  Destructive tests run in a sandbox under the OS temp dir; one
 *  real-path cycle on the shared singleton (cleanup in finally) proves
 *  path-manager + config integration.
 *
 *  Usage:  node scripts/verify-m41.mjs
 *  Exit:   0 = all checks pass, 1 = failure
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fsp } from 'node:fs';
import { readFile } from 'node:fs/promises';

import {
  createStorageService,
  storage,
  NAMESPACES,
  DOCUMENT_VERSION,
  DOCUMENT_SCHEMA,
  STORAGE_ERROR_CODES,
  TX_STALE_MS,
} from '../app/lib/storage/index.mjs';
import { StorageError } from '../app/lib/local/errors.mjs';
import { LIFECYCLE_STATES } from '../app/lib/lifecycle/index.mjs';
import * as fsutil from '../app/lib/local/fsutil.mjs';
import { paths } from '../app/lib/local/paths.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✅' : '  ❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log('Aarogyam Milestone 4.1 Verification (Storage Engine)');
console.log('-----------------------------------------------------');

// ── 0. Module load + zero circular imports ──────────────────────────
check('storage engine imports cleanly', true);

const LIB_FILES = [
  'app/lib/config/index.mjs', 'app/lib/config/schema.mjs', 'app/lib/config/defaults.mjs',
  'app/lib/config/validate.mjs', 'app/lib/local/errors.mjs', 'app/lib/local/paths.mjs',
  'app/lib/local/fsutil.mjs', 'app/lib/local/flags.mjs', 'app/lib/lifecycle/index.mjs',
  'app/lib/logging/index.mjs', 'app/lib/storage/index.mjs', 'app/lib/backup/index.mjs',
  'app/lib/network/index.mjs', 'app/lib/discovery/index.mjs', 'app/lib/sync/index.mjs',
  'app/lib/system/index.mjs', 'app/lib/system/registry.mjs', 'app/lib/installer/index.mjs',
  'app/lib/bootstrap/index.mjs',
];
const edges = new Map();
for (const file of LIB_FILES) {
  const src = await readFile(file, 'utf8');
  const deps = [];
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const clean = m[1].replace(/\.mjs$/, '');
    const base = file.split('/').slice(0, -1).join('/');
    const parts = [...base.split('/').filter(Boolean), ...clean.split('/')];
    const stack = [];
    for (const p of parts) {
      if (p === '.' || p === '') continue;
      if (p === '..') stack.pop();
      else stack.push(p);
    }
    const candidate = `app/lib/${stack.join('/')}.mjs`;
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

// ── 1. Engine surface ───────────────────────────────────────────────
check('NAMESPACES = settings, cache, metadata, installation, runtime, backup',
  NAMESPACES.length === 6 && JSON.stringify(NAMESPACES) === JSON.stringify(
    ['settings', 'cache', 'metadata', 'installation', 'runtime', 'backup']));
check('DOCUMENT_VERSION = 1', DOCUMENT_VERSION === 1);
check('DOCUMENT_SCHEMA marker defined', typeof DOCUMENT_SCHEMA === 'string' && DOCUMENT_SCHEMA.length > 0);
check('STORAGE_ERROR_CODES exposed', Array.isArray(STORAGE_ERROR_CODES) && STORAGE_ERROR_CODES.includes('invalid-json') && STORAGE_ERROR_CODES.includes('checksum-mismatch'));
check('TX_STALE_MS is a positive timeout', Number.isInteger(TX_STALE_MS) && TX_STALE_MS > 0, `${TX_STALE_MS}ms`);
check('singleton rooted at paths.dataDir', storage.rootDir === paths.dataDir);

// ── Sandbox ─────────────────────────────────────────────────────────
const sandbox = join(tmpdir(), `aarogyam-m41-${process.pid}`);
const store = createStorageService(sandbox, { cache: { enabled: true, maxEntries: 100 } });
const noCache = createStorageService(`${sandbox}-nocache`, { cache: { enabled: false } });
const tinyCache = createStorageService(`${sandbox}-tiny`, { cache: { enabled: true, maxEntries: 2 } });

async function sandboxCleanup() {
  await fsutil.removeRecursive(sandbox);
  await fsutil.removeRecursive(`${sandbox}-nocache`);
  await fsutil.removeRecursive(`${sandbox}-tiny`);
}
await sandboxCleanup();

try {
  // ── 2. Lifecycle startup ───────────────────────────────────────────
  check('storage starts UNINITIALIZED', store.getState() === LIFECYCLE_STATES.UNINITIALIZED);
  store.initialize();
  check('initialize() → READY', store.getState() === LIFECYCLE_STATES.READY);
  store.initialize();
  check('re-initialize is idempotent', store.getState() === LIFECYCLE_STATES.READY);

  // ── 3. Document persistence + envelope ─────────────────────────────
  const value = { clinic: 'Test Clinic', active: true, count: 7 };
  await store.set('settings', 'clinic', value);
  check('set + get round-trip', JSON.stringify(await store.get('settings', 'clinic')) === JSON.stringify(value));
  check('get returns fallback for missing doc', (await store.get('settings', 'nope', 'FB')) === 'FB');
  check('has() true after set', await store.has('settings', 'clinic'));
  check('has() false for missing', !(await store.has('settings', 'nope')));

  const envelope = await store.readDocument('settings', 'clinic');
  check('envelope carries $schema marker', envelope.$schema === DOCUMENT_SCHEMA);
  check('envelope carries version', envelope.version === DOCUMENT_VERSION);
  check('envelope carries namespace + key', envelope.namespace === 'settings' && envelope.key === 'clinic');
  check('envelope carries savedAt', !Number.isNaN(Date.parse(envelope.savedAt)));
  check('envelope carries checksum (sha256 hex)', /^[0-9a-f]{64}$/.test(envelope.checksum));
  check('envelope data matches', JSON.stringify(envelope.data) === JSON.stringify(value));

  // Document file is the serialized envelope (atomic write artifact).
  const rawDoc = JSON.parse(await readFile(store.pathFor('settings', 'clinic'), 'utf8'));
  check('file on disk is an envelope document', rawDoc.$schema === DOCUMENT_SCHEMA && 'data' in rawDoc);

  // ── 4. Document versioning ─────────────────────────────────────────
  await store.set('metadata', 'schema-tag', { tag: 'v2' }, { version: 2 });
  const v2 = await store.readDocument('metadata', 'schema-tag');
  check('set() honours explicit version', v2.version === 2);
  const v2Verify = await store.verifyDocument('metadata', 'schema-tag');
  check('verify flags unsupported version', v2Verify.ok === false && v2Verify.code === 'unsupported-version');
  await store.set('metadata', 'schema-tag', { tag: 'v1' });
  check('verify ok after rewrite at supported version', (await store.verifyDocument('metadata', 'schema-tag')).ok === true);

  // Legacy raw-JSON document (pre-4.1) is read as version 0.
  await fsutil.writeJson(store.pathFor('metadata', 'legacy'), { old: 'raw' });
  const legacy = await store.readDocument('metadata', 'legacy');
  check('legacy raw-JSON doc read as version 0', legacy.version === 0 && legacy.legacy === true && legacy.data.old === 'raw');
  check('legacy doc passes verification', (await store.verifyDocument('metadata', 'legacy')).ok === true);
  check('legacy doc readable via get()', (await store.get('metadata', 'legacy')).old === 'raw');

  // ── 5. Atomic writes + crash recovery ──────────────────────────────
  // A leftover temp file (simulated crash between write and rename)
  // must never affect reads or verification.
  await fsp.writeFile(`${store.pathFor('settings', 'clinic')}.99999.123456.tmp`, 'partial garbage');
  check('crash leftovers ignored by get()', JSON.stringify(await store.get('settings', 'clinic')) === JSON.stringify(value));
  const crashVerify = await store.verify();
  check('crash leftovers ignored by verify()', crashVerify.ok === true && crashVerify.checked >= 3);

  // ── 6. Transactions — commit ───────────────────────────────────────
  const tx1 = await store.begin();
  await tx1.set('settings', 'alpha', 1);
  await tx1.set('settings', 'beta', 2);
  await tx1.remove('metadata', 'legacy');
  await tx1.commit();
  check('tx commit persists sets', (await store.get('settings', 'alpha')) === 1 && (await store.get('settings', 'beta')) === 2);
  check('tx commit applies removes', !(await store.has('metadata', 'legacy')));

  // transaction() convenience — success path.
  await store.transaction(async (tx) => {
    await tx.set('cache', 'temp', 'x');
    await tx.set('cache', 'temp2', 'y');
  });
  check('transaction() commits on success', (await store.get('cache', 'temp')) === 'x' && (await store.get('cache', 'temp2')) === 'y');

  // ── 7. Transactions — rollback ─────────────────────────────────────
  let rolledBack = false;
  try {
    await store.transaction(async (tx) => {
      await tx.set('runtime', 'never', 42);
      throw new Error('boom');
    });
  } catch {
    rolledBack = true;
  }
  check('transaction() rolls back when fn throws', rolledBack && !(await store.has('runtime', 'never')));

  const tx2 = await store.begin();
  await tx2.set('runtime', 'discard', 1);
  await tx2.remove('settings', 'alpha');
  await tx2.rollback();
  check('explicit rollback discards sets', !(await store.has('runtime', 'discard')));
  check('explicit rollback leaves removals undone', (await store.get('settings', 'alpha')) === 1);

  // ── 8. Transactions — no partial commits on failure ────────────────
  await store.set('settings', 'keep', 'original');
  // Create a directory at a target path so the final rename fails.
  await fsutil.ensureDir(store.pathFor('settings', 'blocked'));
  let commitFailed = false;
  const tx3 = await store.begin();
  await tx3.set('settings', 'keep', 'changed');   // would succeed
  await tx3.set('settings', 'blocked', 'x');      // rename over a directory → fails
  try {
    await tx3.commit();
  } catch {
    commitFailed = true;
  }
  check('tx commit failure detected', commitFailed);
  check('tx failure restores prior document (no partial commit)', (await store.get('settings', 'keep')) === 'original');
  check('tx failure leaves blocked dir untouched', await fsutil.dirExists(store.pathFor('settings', 'blocked')));

  // ── 9. Concurrency ─────────────────────────────────────────────────
  const writers = [];
  for (let i = 0; i < 50; i += 1) writers.push(store.set('runtime', 'shared', i));
  await Promise.all(writers);
  const finalValue = await store.get('runtime', 'shared');
  check('50 concurrent writes serialize cleanly', Number.isInteger(finalValue) && finalValue >= 0 && finalValue < 50, `final=${finalValue}`);
  const multi = [];
  for (let i = 0; i < 20; i += 1) multi.push(store.set('runtime', `k${i}`, i));
  await Promise.all(multi);
  const multiOk = [];
  for (let i = 0; i < 20; i += 1) multiOk.push((await store.get('runtime', `k${i}`)) === i);
  check('concurrent writes to distinct keys all persist', multiOk.every(Boolean));
  check('no writes pending after burst', store.getWritesPending() === 0, `pending=${store.getWritesPending()}`);

  // ── 9b. Transaction guards (re-entrancy + input validation) ───────
  let reentrantThrew = null;
  try {
    await store.transaction(async (tx) => {
      await tx.set('runtime', 'inside', 1);
      await store.set('settings', 'oops', 1); // service-level call → must fail fast
    });
  } catch (err) {
    reentrantThrew = err;
  }
  check('service-level set inside transaction throws (no deadlock)',
    reentrantThrew instanceof StorageError && reentrantThrew.code === 'transaction-in-progress');
  check('transaction rolled back cleanly after guard error', !(await store.has('runtime', 'inside')));
  check('storage still functional after guard error (no deadlock)',
    (await store.set('settings', 'post-tx', 7)) === 7);

  let undefThrew = null;
  try {
    await store.set('settings', 'undef', undefined);
  } catch (err) {
    undefThrew = err;
  }
  check('set(undefined) throws StorageError invalid-value',
    undefThrew instanceof StorageError && undefThrew.code === 'invalid-value');

  // Hand-crafted envelope without a data field → structured error.
  await fsp.writeFile(store.pathFor('metadata', 'no-data'), JSON.stringify({
    $schema: DOCUMENT_SCHEMA, version: 1, namespace: 'metadata', key: 'no-data', checksum: 'x',
  }));
  let noDataThrew = null;
  try {
    await store.getStrict('metadata', 'no-data');
  } catch (err) {
    noDataThrew = err;
  }
  check('envelope missing data raises StorageError (not TypeError)',
    noDataThrew instanceof StorageError && noDataThrew.code === 'missing-data');
  check('new error codes registered',
    ['transaction-in-progress', 'invalid-value', 'missing-data'].every((c) => STORAGE_ERROR_CODES.includes(c)));
  await store.remove('metadata', 'no-data');

  // ── 10. Cache correctness ──────────────────────────────────────────
  await store.set('cache', 'hot', { n: 1 });
  await store.get('cache', 'hot'); // miss
  await store.get('cache', 'hot'); // hit
  let stats = store.cache.getStats();
  check('cache enabled + records hits/misses', stats.enabled === true && stats.hits >= 1 && stats.misses >= 1, `hits=${stats.hits} misses=${stats.misses}`);
  check('cache tracks entries', stats.entries >= 1);

  // Write-through: set updates the cache immediately.
  await store.set('cache', 'hot', { n: 2 });
  check('write-through cache sees new value', (await store.get('cache', 'hot')).n === 2);

  // Invalidation.
  await store.cache.invalidate('cache', 'hot');
  const before = store.cache.getStats().hits;
  await store.get('cache', 'hot');
  check('invalidate() forces a re-read (miss)', store.cache.getStats().hits === before);

  await store.set('cache', 'ns-test', 1); // caches the entry (write-through)
  await store.cache.invalidateNamespace('cache');
  const nsHitsBefore = store.cache.getStats().hits;
  await store.get('cache', 'ns-test'); // must be a re-read (miss), not a hit
  check('invalidateNamespace() clears namespace entries', store.cache.getStats().hits === nsHitsBefore);
  await store.set('cache', 'x1', 1);
  await store.set('cache', 'x2', 2);
  await store.cache.clear();
  check('cache.clear() empties the cache', store.cache.getStats().entries === 0);

  // LRU eviction.
  await tinyCache.set('settings', 'a', 1);
  await tinyCache.set('settings', 'b', 2);
  await tinyCache.set('settings', 'c', 3); // exceeds maxEntries=2 → evict
  const tinyStats = tinyCache.cache.getStats();
  check('LRU eviction beyond maxEntries', tinyStats.evictions >= 1 && tinyStats.entries <= 2, `evictions=${tinyStats.evictions} entries=${tinyStats.entries}`);

  // Disabled cache reads still work.
  await noCache.set('settings', 'plain', 5);
  check('disabled cache: reads hit disk', (await noCache.get('settings', 'plain')) === 5 && noCache.cache.getStats().enabled === false);

  // ── 11. Integrity verification ─────────────────────────────────────
  const fullVerify = await store.verify();
  check('verify() passes for healthy documents', fullVerify.ok === true, `${fullVerify.checked} checked`);
  check('verify() reports checked count', fullVerify.checked >= 8);

  // Corrupted document — invalid JSON.
  await fsp.writeFile(store.pathFor('settings', 'broken'), '{{{ not json');
  await store.cache.invalidate('settings', 'broken');
  check('corrupt doc: get() returns fallback', (await store.get('settings', 'broken', 'FB')) === 'FB');
  let strictThrew = null;
  try {
    await store.getStrict('settings', 'broken');
  } catch (err) {
    strictThrew = err;
  }
  check('corrupt doc: getStrict() throws StorageError invalid-json',
    strictThrew instanceof StorageError && strictThrew.code === 'invalid-json');
  let readThrew = null;
  try {
    await store.readDocument('settings', 'broken');
  } catch (err) {
    readThrew = err;
  }
  check('corrupt doc: readDocument() throws', readThrew instanceof StorageError);
  const brokenVerify = await store.verifyDocument('settings', 'broken');
  check('verify() flags corrupt document', brokenVerify.ok === false && brokenVerify.code === 'invalid-json');

  // Tampered document — valid JSON but checksum mismatch.
  await store.set('settings', 'tamper', { safe: true });
  const tampered = JSON.parse(await readFile(store.pathFor('settings', 'tamper'), 'utf8'));
  tampered.data.safe = false; // change data, keep stale checksum
  await fsp.writeFile(store.pathFor('settings', 'tamper'), JSON.stringify(tampered));
  await store.cache.invalidate('settings', 'tamper');
  check('tampered doc: get() returns fallback (never serves corrupt data)', (await store.get('settings', 'tamper', 'FB')) === 'FB');
  const tamperVerify = await store.verifyDocument('settings', 'tamper');
  check('verify flags checksum mismatch', tamperVerify.ok === false && tamperVerify.code === 'checksum-mismatch');

  // ── 12. Namespace isolation ────────────────────────────────────────
  check('namespaces are isolated (settings docs absent from cache)',
    !(await store.listKeys('cache')).includes('clinic'));
  check('namespaces are isolated (backup empty)', (await store.listKeys('backup')).length === 0);
  check('namespaces are isolated (runtime has own docs)', (await store.listKeys('runtime')).length > 0);
  const beforeCount = (await store.listKeys('settings')).length;
  const cacheBefore = (await store.listKeys('cache')).length;
  await store.remove('settings', 'broken');
  check('remove in one namespace leaves others intact',
    (await store.listKeys('settings')).length === beforeCount - 1 &&
    (await store.listKeys('cache')).length === cacheBefore);
  // Clean up the intentionally-corrupted tamper doc before final verify.
  await store.remove('settings', 'tamper');
  const nsAfter = await store.verify();
  check('verify passes after corruption cleanup', nsAfter.ok === true);

  // ── 13. Graceful write flushing + shutdown ─────────────────────────
  const flush = store.set('runtime', 'flush-me', 'persisted'); // fire without await
  await store.shutdown();
  await flush;
  const flushed = JSON.parse(await readFile(store.pathFor('runtime', 'flush-me'), 'utf8'));
  check('shutdown flushes pending writes to disk', flushed.data === 'persisted');
  check('shutdown → STOPPED', store.getState() === LIFECYCLE_STATES.STOPPED);
  store.initialize();
  check('storage re-initializable after shutdown', store.getState() === LIFECYCLE_STATES.READY);
  await store.shutdown();

  // ── 14. Real-paths singleton cycle ─────────────────────────────────
  try {
    storage.initialize();
    await storage.set('runtime', 'ping', { ok: true });
    const ping = await storage.get('runtime', 'ping');
    check('singleton (config cache) persists on real paths', ping?.ok === true);
    await storage.remove('runtime', 'ping');
    await storage.shutdown();
  } finally {
    await fsutil.removeRecursive(paths.dataDir);
  }
  check('real-path cycle cleaned up (repo pristine)', !(await fsutil.dirExists(paths.dataDir)));
} finally {
  await sandboxCleanup();
}

// ── 15. Zero duplicate utilities ─────────────────────────────────────
const FSUTIL_EXPORTS = ['ensureDir', 'dirExists', 'fileExists', 'verifyDirectory', 'removeRecursive', 'copyRecursive', 'move', 'hashFile', 'atomicWriteFile', 'readJson', 'writeJson'];
const storageSrc = await readFile('app/lib/storage/index.mjs', 'utf8');
const dup = FSUTIL_EXPORTS.filter((name) =>
  new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b`).test(storageSrc));
check('zero duplicate fs utilities in storage', dup.length === 0, dup.join(', '));

// ── 16. Zero configuration duplication ──────────────────────────────
check('storage has no process.env access', !storageSrc.includes('process.env.'));
check('storage reads config via get() only', storageSrc.includes("get('storage.cache.enabled'") && storageSrc.includes("get('storage.cache.maxEntries'"));

// ── 17. No automatic side effects ───────────────────────────────────
const autoDirChecks = await Promise.all(
  [paths.dataDir, paths.logsDir, paths.backupsDir, paths.exportDir].map((d) =>
    fsutil.dirExists(d).then((exists) => ({ d, exists }))
  )
);
const autoDirs = autoDirChecks.filter((c) => c.exists).map((c) => c.d);
check('importing storage creates no directories', autoDirs.length === 0, autoDirs.join(', '));

// ── Summary ──────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log('-----------------------------------------------------');
if (failed.length === 0) {
  console.log(`✅ Milestone 4.1 verification PASSED (${results.length} checks)`);
  process.exit(0);
} else {
  console.log(`❌ Milestone 4.1 verification FAILED (${failed.length}/${results.length})`);
  failed.forEach((f) => console.log(`   - ${f.name} — ${f.detail}`));
  process.exit(1);
}
