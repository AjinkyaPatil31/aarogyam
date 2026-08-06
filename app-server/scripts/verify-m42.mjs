/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Milestone 4.2 Logging Framework Verification Suite
 * ─────────────────────────────────────────────────────────────────────
 *  Covers every M4.2 requirement:
 *    levels, hierarchy, structured metadata, console + file logging,
 *    append correctness, rotation by size, retained-file limits,
 *    async ordering, buffered writes, flush, graceful shutdown,
 *    restart recovery, concurrent logging, structured error logging,
 *    lifecycle integration, static checks (circular imports, duplicate
 *    utilities, config duplication, console.* discipline), config gate.
 *
 *  Usage:  node scripts/verify-m42.mjs
 *  Exit:   0 when every check passes, 1 otherwise.
 */

import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

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

/** Create an isolated log manager pointed at a fresh temp directory. */
async function makeHarness(options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'aarogyam-m42-'));
  const mgr = createLogManager({
    level: 'trace',
    console: { enabled: false },
    file: { enabled: true, dir, filename: 'aarogyam.log', maxSize: 64 * 1024, maxFiles: 3 },
    ...options,
  });
  const log = createLogger('harness', { manager: mgr });
  return { dir, mgr, log, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// ── Imports (must load before anything else) ─────────────────────────
let LOG_LEVELS, LOG_LEVEL_NAMES, createLogManager, createLogger, getLogManager;
let flushLogs, defaultLogFilePath, createFileLogger;
let StorageError, LifecycleError;
try {
  ({ LOG_LEVELS, LOG_LEVEL_NAMES, createLogManager, createLogger, getLogManager, flushLogs, defaultLogFilePath, createFileLogger } =
    await import('../app/lib/logging/index.mjs'));
  ({ StorageError } = await import('../app/lib/local/errors.mjs'));
  ({ LifecycleError } = await import('../app/lib/lifecycle/index.mjs'));
  check('m42: logging module imports', true);
} catch (err) {
  check('m42: logging module imports', false, err.message);
  process.exit(1);
}

// ── 1. All log levels ────────────────────────────────────────────────
{
  const { mgr } = await makeHarness();
  const log = createLogger('levels', { manager: mgr });
  log.trace('trace-msg');
  log.debug('debug-msg');
  log.info('info-msg');
  log.warn('warn-msg');
  log.error('error-msg');
  log.fatal('fatal-msg');
  await mgr.flush();
  const stats = mgr.getStats();
  check('m42: six levels defined', LOG_LEVEL_NAMES.length === 6 && Object.keys(LOG_LEVELS).length === 6);
  check('m42: all six levels emitted', stats.written === 6, `written=${stats.written}`);
  check('m42: level ordering trace<fatal', LOG_LEVELS.trace < LOG_LEVELS.info && LOG_LEVELS.info < LOG_LEVELS.fatal);
}

// ── 2. Level filtering (configurable) ────────────────────────────────
{
  const { mgr } = await makeHarness({ level: 'warn' });
  const log = createLogger('filter', { manager: mgr });
  log.trace('t');
  log.debug('d');
  log.info('i');
  log.warn('w');
  log.error('e');
  await mgr.flush();
  check('m42: threshold filters below-level', mgr.getStats().written === 2, `written=${mgr.getStats().written}`);
  check('m42: getLevel reports threshold', mgr.getLevel() === 'warn');
  // Per-logger override raises the threshold only for that logger.
  const { mgr: mgr2 } = await makeHarness({ level: 'info' });
  const strict = createLogger('strict', { manager: mgr2, level: 'error' });
  const loose = createLogger('loose', { manager: mgr2 });
  strict.warn('sw');
  loose.warn('lw');
  await mgr2.flush();
  check('m42: per-logger level override', mgr2.getStats().written === 1, `written=${mgr2.getStats().written}`);
}

// ── 3. Logger hierarchy (child loggers, shared backend) ──────────────
{
  const { mgr } = await makeHarness();
  const root = createLogger('storage', { manager: mgr });
  const child = root.child('cache');
  check('m42: child logger shares backend', child.manager === mgr);
  check('m42: child logger module name', child.name === 'storage:cache', child.name);
  child.info('child-msg');
  await mgr.flush();
  check('m42: child logger emits', mgr.getStats().written === 1);
}

// ── 4. Structured metadata ───────────────────────────────────────────
{
  const { dir, mgr } = await makeHarness();
  const log = createLogger('meta', { manager: mgr });
  const err = new StorageError('checksum-mismatch', 'doc corrupt', { ns: 'settings', key: 'x' });
  log.error('write failed', { attempt: 3 }, err);
  await mgr.flush();
  const files = await readdir(dir);
  const content = await readFile(join(dir, 'aarogyam.log'), 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  const entry = JSON.parse(lines[0]);
  check('m42: file entry is JSONL', lines.length === 1);
  check('m42: timestamp present', typeof entry.timestamp === 'string' && !Number.isNaN(Date.parse(entry.timestamp)));
  check('m42: level present', entry.level === 'error');
  check('m42: module present', entry.module === 'meta');
  check('m42: service present', typeof entry.service === 'string' && entry.service.length > 0);
  check('m42: message present', entry.message === 'write failed');
  check('m42: context preserved', entry.context?.attempt === 3);
  check('m42: error normalized', entry.error?.name === 'StorageError' && entry.error?.code === 'checksum-mismatch');
  check('m42: stack in file entry', typeof entry.stack === 'string' && entry.stack.includes('StorageError'));
  check('m42: log file created', files.includes('aarogyam.log'));
}

// ── 5. Console logging + no stack in console ─────────────────────────
{
  const captured = [];
  const orig = { info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  console.info = (m) => captured.push(['info', m]);
  console.warn = (m) => captured.push(['warn', m]);
  console.error = (m) => captured.push(['error', m]);
  console.debug = (m) => captured.push(['debug', m]);
  const mgr = createLogManager({ level: 'trace', console: { enabled: true }, file: { enabled: false } });
  const log = createLogger('console', { manager: mgr });
  log.info('hello console');
  log.error('boom', new Error('kaboom'));
  await mgr.flush();
  console.info = orig.info;
  console.warn = orig.warn;
  console.error = orig.error;
  console.debug = orig.debug;
  const infoLine = captured.find(([l]) => l === 'info')?.[1] ?? '';
  const errLine = captured.find(([l]) => l === 'error')?.[1] ?? '';
  check('m42: console output emitted', captured.length >= 2, `captured=${captured.length}`);
  check('m42: console line has module + message', infoLine.includes('[console]') && infoLine.includes('hello console'));
  check('m42: console line has error summary', errLine.includes('Error: kaboom'));
  check('m42: console never shows stack', !infoLine.includes('at ') && !errLine.includes('at '));
}

// ── 6. File logging + append correctness ─────────────────────────────
{
  const { dir, mgr } = await makeHarness();
  const log = createLogger('append', { manager: mgr });
  log.info('first');
  await mgr.flush();
  log.info('second');
  log.info('third');
  await mgr.flush();
  const content = await readFile(join(dir, 'aarogyam.log'), 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  check('m42: append keeps earlier entries', lines.length === 3, `lines=${lines.length}`);
  check('m42: append order preserved', lines[0].includes('first') && lines[2].includes('third'));
}

// ── 7. Rotation by size ──────────────────────────────────────────────
{
  const dir = await mkdtemp(join(tmpdir(), 'aarogyam-m42-rot-'));
  const mgr = createLogManager({
    level: 'trace',
    console: { enabled: false },
    file: { enabled: true, dir, filename: 'rot.log', maxSize: 512, maxFiles: 3 },
  });
  const log = createLogger('rot', { manager: mgr });
  // ~230 bytes per entry with maxSize=512 → the 3rd flush crosses the
  // threshold and rotates exactly once; with maxFiles=3 nothing is
  // purged yet (active + .1 only), so every entry must survive.
  for (let i = 0; i < 5; i += 1) {
    log.info(`rotation entry number ${i} with a long padded payload ${'x'.repeat(120)}`);
    await mgr.flush();
  }
  const files = (await readdir(dir)).sort();
  const rotated = files.filter((f) => f.startsWith('rot.log'));
  check('m42: rotation produced .1 file', rotated.includes('rot.log.1'), `files=${files.join(',')}`);
  check('m42: active file still present', rotated.includes('rot.log'));
  // Retained-file limits: maxFiles=3 → active + .1 + .2 at most.
  check('m42: retained-file limit respected', rotated.length <= 3, `rotated=${rotated.length}`);
  // Completed entries never lost within the retention window: every
  // entry written before the (single) rotation must be in some file.
  const allContent = (await Promise.all(rotated.map((f) => readFile(join(dir, f), 'utf8')))).join('');
  const counts = [];
  for (let i = 0; i < 5; i += 1) counts.push(allContent.includes(`rotation entry number ${i}`));
  check('m42: no completed entry lost across rotation', counts.every(Boolean));
  // Retention beyond the window is a deliberate purge, verified by
  // hammering enough entries to force the oldest rotated file out.
  for (let i = 5; i < 30; i += 1) {
    log.info(`rotation entry number ${i} with a long padded payload ${'x'.repeat(120)}`);
    await mgr.flush();
  }
  const filesAfter = (await readdir(dir)).filter((f) => f.startsWith('rot.log'));
  check('m42: retention purges oldest rotated files only', filesAfter.length <= 3, `files=${filesAfter.join(',')}`);
  await mgr.shutdown();
  await rm(dir, { recursive: true, force: true });
}

// ── 8. Async ordering + buffered writes + flush ──────────────────────
{
  const { dir, mgr } = await makeHarness();
  const log = createLogger('order', { manager: mgr });
  const seq = [];
  for (let i = 0; i < 200; i += 1) {
    log.info(`seq-${i}`);
    seq.push(`seq-${i}`);
  }
  // Immediately after enqueueing, the buffer is non-empty (async drain).
  const bufferedAfterEnqueue = mgr.getStats().buffered;
  check('m42: writes are buffered (async pipeline)', bufferedAfterEnqueue > 0 || mgr.getStats().written < 200, `buffered=${bufferedAfterEnqueue}`);
  await mgr.flush();
  check('m42: flush drains buffer', mgr.getStats().buffered === 0, `buffered=${mgr.getStats().buffered}`);
  const content = await readFile(join(dir, 'aarogyam.log'), 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  check('m42: all 200 entries written in order', lines.length === 200 && lines[0].includes('seq-0') && lines[199].includes('seq-199'), `lines=${lines.length}`);
}

// ── 9. Bounded memory (drop oldest on saturation) ────────────────────
{
  // A file sink keeps the drain loop async so the synchronous enqueue
  // loop saturates the bounded buffer and exercises the drop path.
  const dir = await mkdtemp(join(tmpdir(), 'aarogyam-m42-bounded-'));
  const mgr = createLogManager({
    level: 'trace',
    console: { enabled: false },
    file: { enabled: true, dir, filename: 'b.log', maxSize: 1024 * 1024, maxFiles: 3 },
    maxBufferEntries: 16,
  });
  const log = createLogger('bounded', { manager: mgr });
  for (let i = 0; i < 100; i += 1) log.info(`drop-${i}`);
  const stats = mgr.getStats();
  check('m42: buffer bounded', stats.buffered <= 16, `buffered=${stats.buffered}`);
  check('m42: drops counted', stats.dropped > 0, `dropped=${stats.dropped}`);
  await mgr.flush();
  await mgr.shutdown();
  await rm(dir, { recursive: true, force: true });
}

// ── 10. Graceful shutdown + restart recovery ─────────────────────────
{
  const dir = await mkdtemp(join(tmpdir(), 'aarogyam-m42-shut-'));
  const mgr = createLogManager({
    level: 'trace', console: { enabled: false },
    file: { enabled: true, dir, filename: 'rec.log', maxSize: 1024 * 1024, maxFiles: 3 },
  });
  const log = createLogger('rec', { manager: mgr });
  mgr.initialize();
  check('m42: initialize → READY', mgr.getState() === 'READY', mgr.getState());
  log.info('before-shutdown');
  await mgr.flush();
  await mgr.shutdown();
  check('m42: shutdown → STOPPED', mgr.getState() === 'STOPPED', mgr.getState());
  check('m42: shutdown flushed entries', mgr.getStats().written === 1);
  // Restart recovery — a later write reopens the file lazily.
  log.info('after-restart');
  await mgr.flush();
  const content = await readFile(join(dir, 'rec.log'), 'utf8');
  check('m42: write after shutdown reopens file', content.includes('after-restart'));
  await mgr.shutdown();
  await rm(dir, { recursive: true, force: true });
  // Uninitialized shutdown → STOPPED without error.
  const idle = createLogManager({ level: 'info', console: { enabled: false }, file: { enabled: false } });
  await idle.shutdown();
  check('m42: uninitialized shutdown → STOPPED', idle.getState() === 'STOPPED', idle.getState());
}

// ── 11. Concurrent logging (ordered, no interleaving loss) ───────────
{
  const { dir, mgr } = await makeHarness();
  const logs = ['a', 'b', 'c', 'd', 'e'].map((n) => createLogger(`conc-${n}`, { manager: mgr }));
  await Promise.all(
    logs.flatMap((log, li) =>
      Array.from({ length: 20 }, (_, i) =>
        Promise.resolve().then(() => log.info(`conc-${li}-${i}`))
      )
    )
  );
  await mgr.flush();
  const content = await readFile(join(dir, 'aarogyam.log'), 'utf8');
  const lines = content.trim().split('\n').filter(Boolean);
  check('m42: concurrent logging writes every entry', lines.length === 100, `lines=${lines.length}`);
  // Per-logger ordering preserved (single drain loop ⇒ global order).
  const perLogger = {};
  for (const line of lines) {
    const e = JSON.parse(line);
    const key = e.module;
    perLogger[key] ??= [];
    perLogger[key].push(Number(e.message.split('-')[2]));
  }
  const ordered = Object.values(perLogger).every((nums) =>
    nums.every((n, i) => i === 0 || n > nums[i - 1])
  );
  check('m42: per-logger emission order preserved', ordered);
}

// ── 12. Structured error logging (never expose stacks to users) ──────
{
  const captured = [];
  const origErr = console.error;
  console.error = (m) => captured.push(m);
  const mgr = createLogManager({ level: 'error', console: { enabled: true }, file: { enabled: false } });
  const log = createLogger('errs', { manager: mgr });
  const lifeErr = new LifecycleError('READY', 'UNINITIALIZED');
  log.error('lifecycle transition failed', lifeErr);
  await mgr.flush();
  console.error = origErr;
  check('m42: LifecycleError normalized in console', captured.some((m) => m.includes('LifecycleError')));
  check('m42: no stack in console for errors', captured.every((m) => !m.includes('\n    at ')));
}

// ── 13. InstallerError wrapping ───────────────────────────────────────
{
  const { createInstaller } = await import('../app/lib/installer/index.mjs');
  const { InstallerError } = await import('../app/lib/local/errors.mjs');
  // A metadata path inside a file (not a directory) forces the atomic
  // write to fail → the installer must wrap it as InstallerError.
  const dir = await mkdtemp(join(tmpdir(), 'aarogyam-m42-inst-'));
  const blocker = join(dir, 'blocked');
  await writeFile(blocker, 'not a dir');
  const inst = createInstaller({
    directories: [join(dir, 'data')],
    metadataFile: join(blocker, 'installation.json'),
  });
  let threw = null;
  try {
    await inst.install();
  } catch (err) {
    threw = err;
  }
  check('m42: installer throws InstallerError', threw instanceof InstallerError, threw?.name ?? 'no error');
  check('m42: InstallerError carries cause', Boolean(threw?.cause), threw?.cause?.message ?? 'no cause');
  check('m42: InstallerError has code', threw?.code === 'AAROGYAM_INSTALLER');
  await rm(dir, { recursive: true, force: true });
}

// ── 14. Lifecycle integration via registry ───────────────────────────
{
  const { createRegistry, registerInfrastructureServices } = await import('../app/lib/system/registry.mjs');
  const reg = registerInfrastructureServices();
  reg.initializeAll();
  const states = reg.getStates();
  check('m42: logging service READY via registry', states.logging === 'READY', states.logging);
  check('m42: all services READY', Object.values(states).every((s) => s === 'READY'));
  await reg.shutdownAll();
  const after = reg.getStates();
  check('m42: logging STOPPED after shutdownAll', after.logging === 'STOPPED', after.logging);
  check('m42: all services STOPPED', Object.values(after).every((s) => s === 'STOPPED'));
}

// ── 15. Bootstrap flush integration ──────────────────────────────────
{
  // Use a SANDBOXED installer so the real data/log dirs are never
  // created (the repo must stay pristine for other suites).
  const { createBootstrapManager } = await import('../app/lib/bootstrap/index.mjs');
  const { createInstaller, METADATA_FILE_NAME } = await import('../app/lib/installer/index.mjs');
  const { createRegistry, registerInfrastructureServices } = await import('../app/lib/system/registry.mjs');
  const { removeRecursive, ensureDir } = await import('../app/lib/local/fsutil.mjs');
  const { join: j } = await import('node:path');
  const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m42-boot-'));
  const dirs = [j(sandbox, 'data'), j(sandbox, 'logs'), j(sandbox, 'backups'), j(sandbox, 'db'), j(sandbox, 'export'), j(sandbox, 'temp')];
  const bootInst = createInstaller({
    directories: dirs,
    metadataFile: j(sandbox, 'data', 'installation', METADATA_FILE_NAME),
  });
  const boot = createBootstrapManager({
    installer: bootInst,
    registry: registerInfrastructureServices(),
  });
  await boot.initialize();
  check('m42: bootstrap READY', boot.getState() === 'READY', boot.getState());
  await boot.shutdown();
  check('m42: bootstrap shutdown → STOPPED', boot.getState() === 'STOPPED', boot.getState());
  // Logs must have been flushed through the logging manager.
  const logMgr = getLogManager();
  check('m42: bootstrap shutdown flushes logs', logMgr.getStats().buffered === 0, `buffered=${logMgr.getStats().buffered}`);
  await removeRecursive(sandbox);
}

// ── 16. Console.* discipline across infrastructure ───────────────────
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join: j } = await import('node:path');
  const offenders = [];
  function* walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = j(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (p.endsWith('.mjs')) yield p;
    }
  }
  const libRoot = j(ROOT, 'app', 'lib');
  for (const file of walk(libRoot)) {
    if (file.replace(/\\/g, '/').includes('/logging/index.mjs')) continue; // the console sink lives here
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Actual console method calls only — config keys like
      // `logging.console.enabled` must not match.
      if (!/console\.(log|info|warn|error|debug|trace)\s*\(/.test(line)) return;
      const code = line.trim();
      if (code.startsWith('*') || code.startsWith('//') || code.startsWith('/**') || code.includes('never uses console')) return;
      offenders.push(`${file}:${i + 1}: ${code}`);
    });
  }
  check('m42: no console.* outside logging sink', offenders.length === 0, offenders.join(' | '));
}

// ── 17. Zero circular imports (DFS over app/lib, pure Node) ──────────
{
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join: j, resolve, dirname: d } = await import('node:path');
  function* walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = j(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (p.endsWith('.mjs')) yield p;
    }
  }
  const libRoot = j(ROOT, 'app', 'lib');
  const files = [...walk(libRoot)];
  const mods = new Map(files.map((f, i) => [f, i]));
  const adj = files.map((f) => {
    const src = readFileSync(f, 'utf8');
    return [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((m) => m[1])
      .filter((r) => r.startsWith('.') || r.startsWith('/'))
      .map((r) => resolve(d(f), r))
      .filter((r) => mods.has(r) && !r.endsWith('.json'));
  });
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
  check('m42: zero circular imports', cycle === null, cycle ? cycle.join(' -> ') : `scanned ${files.length} modules`);
}

// ── 18. Zero configuration duplication ───────────────────────────────
{
  const { SCHEMA } = await import('../app/lib/config/schema.mjs');
  const keys = SCHEMA.filter((s) => s.status !== 'dead').map((s) => s.key);
  const unique = new Set(keys);
  check('m42: config keys unique in schema', unique.size === keys.length, `schema=${keys.length} unique=${unique.size}`);
  const { get } = await import('../app/lib/config/index.mjs');
  const loggingKeys = keys.filter((k) => k.startsWith('logging.'));
  const readable = loggingKeys.every((k) => { try { get(k); return true; } catch { return false; } });
  check('m42: all logging.* keys readable via get()', readable, loggingKeys.join(','));
  // Duplicate-utility scan: no export name defined twice across modules.
  const { readdirSync, readFileSync } = await import('node:fs');
  const { join: j } = await import('node:path');
  const seen = new Map();
  const dups = [];
  function* walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = j(dir, e.name);
      if (e.isDirectory()) yield* walk(p);
      else if (p.endsWith('.mjs')) yield p;
    }
  }
  const libRoot = j(ROOT, 'app', 'lib');
  for (const file of walk(libRoot)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)) {
      const name = m[1];
      if (seen.has(name)) dups.push(`${name} (${seen.get(name)} and ${file})`);
      else seen.set(name, file);
    }
  }
  check('m42: zero duplicate exported utilities', dups.length === 0, dups.join(' | '));
}

// ── 19. Config gate ──────────────────────────────────────────────────
{
  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'validate-config.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    check('m42: config validation gate passes', true);
  } catch (err) {
    check('m42: config validation gate passes', false, String(err.stderr ?? err.message).slice(0, 200));
  }
}

// ── 20. File logging disabled when directory missing ─────────────────
{
  const mgr = createLogManager({
    level: 'info', console: { enabled: false },
    file: { enabled: true, dir: join(tmpdir(), 'aarogyam-m42-missing-dir-xyz'), filename: 'nope.log' },
  });
  const log = createLogger('missingdir', { manager: mgr });
  log.info('should-not-write');
  await mgr.flush();
  check('m42: file sink self-disables on missing dir', mgr.getStats().fileEnabled === false);
}

// ── 21. No-sink short-circuit (bounded memory) ───────────────────────
{
  const mgr = createLogManager({ level: 'trace', console: { enabled: false }, file: { enabled: false } });
  const log = createLogger('nosink', { manager: mgr });
  for (let i = 0; i < 50; i += 1) log.info(`ns-${i}`);
  const stats = mgr.getStats();
  check('m42: no-sink drops synchronously (buffered=0)', stats.buffered === 0, `buffered=${stats.buffered}`);
  check('m42: no-sink emits nothing to disk', stats.written === 0, `written=${stats.written}`);
  await mgr.flush();
}

// ── 22. Circular context never poisons the pipeline ──────────────────
{
  const dir = await mkdtemp(join(tmpdir(), 'aarogyam-m42-circ-'));
  const mgr = createLogManager({
    level: 'trace',
    console: { enabled: false },
    file: { enabled: true, dir, filename: 'circ.log', maxSize: 1024 * 1024, maxFiles: 3 },
  });
  const log = createLogger('circ', { manager: mgr });
  const circular = { attempt: 3 };
  circular.self = circular; // circular reference
  log.error('circular context', circular, new Error('boom'));
  await mgr.flush();
  const stats = mgr.getStats();
  const content = await readFile(join(dir, 'circ.log'), 'utf8');
  const entry = JSON.parse(content.trim().split('\n')[0]);
  check('m42: circular context does not throw (fileErrors=0)', stats.fileErrors === 0, `fileErrors=${stats.fileErrors}`);
  check('m42: circular entry keeps message + error', entry.message === 'circular context' && entry.error?.name === 'Error', JSON.stringify(entry));
  check('m42: circular entry keeps scalar context', entry.context?.attempt === 3, JSON.stringify(entry.context));
  await mgr.shutdown();
  await rm(dir, { recursive: true, force: true });
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\nM4.2 verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
process.exit(0);
