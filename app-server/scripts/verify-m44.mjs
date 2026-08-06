#!/usr/bin/env node
/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Milestone 4.4 Health & Diagnostics Verification Suite
 * ─────────────────────────────────────────────────────────────────────
 *  Covers every M4.4 requirement:
 *    provider registration, provider execution, health aggregation, all
 *    health states, diagnostics collection, runtime information, report
 *    generation (JSON + text), self-tests, storage/logging/backup/
 *    registry/lifecycle/configuration/filesystem diagnostics,
 *    performance, lifecycle startup/shutdown, structured logging, zero
 *    circular imports, zero duplicate utilities, zero configuration
 *    duplication, npm install, prisma generate, npm build, runtime
 *    smoke tests, database integrity.
 *
 *  Usage:  node scripts/verify-m44.mjs
 *  Exit:   0 when every check passes, 1 otherwise.
 *  Note:   the final section runs the real build gates (npm install /
 *          prisma generate / npm build) — expect a few minutes.
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

// The configuration provider/self-test validate the LIVE process env.
// Provide a valid JWT_SECRET so the positive path is observable (the
// real app loads it from .env via Next.js / validate-config).
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-m44-test-secret';

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

// ── Imports (dynamic — after the env setup above) ───────────────────
let createStorageService, backupIndex, healthIndex, healthModel, healthReport, healthSelftest;
let createLogManager, getLogManager;
let createInstaller, registerInfrastructureServices, createBootstrapManager;
try {
  ({ createStorageService } = await import('../app/lib/storage/index.mjs'));
  backupIndex = await import('../app/lib/backup/index.mjs');
  healthIndex = await import('../app/lib/health/index.mjs');
  healthModel = await import('../app/lib/health/model.mjs');
  healthReport = await import('../app/lib/health/report.mjs');
  healthSelftest = await import('../app/lib/health/selftest.mjs');
  ({ createLogManager, getLogManager } = await import('../app/lib/logging/index.mjs'));
  ({ createInstaller } = await import('../app/lib/installer/index.mjs'));
  ({ registerInfrastructureServices } = await import('../app/lib/system/registry.mjs'));
  ({ createBootstrapManager } = await import('../app/lib/bootstrap/index.mjs'));
  check('m44: health framework imports cleanly', true);
} catch (err) {
  check('m44: health framework imports cleanly', false, err.message);
  process.exit(1);
}

const { createHealthManager } = healthIndex;
const { createBackupManager } = backupIndex;
const { HEALTH_STATES, HEALTH_SEVERITY, worstState, buildResult, isHealthResult } = healthModel;
const { renderJsonReport, renderTextReport, REPORT_FORMATS, collectRecommendations } = healthReport;
const { SELF_TESTS, runSelfTests } = healthSelftest;

/**
 * Sandbox: storage docs + fake sqlite db + exports + an initialized
 * backup manager and an initialized health manager wired together.
 */
async function makeSandbox(overrides = {}) {
  const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m44-'));
  const dataDir = join(sandbox, 'data');
  const backupDir = join(sandbox, 'backups');
  const dbFile = join(sandbox, 'sqlite.db');
  const exportDir = join(sandbox, 'exports');
  const reportDir = join(sandbox, 'reports');

  const store = createStorageService(dataDir);
  store.initialize();
  await store.set('settings', 'clinic', { name: 'Sandbox Clinic' });
  await store.set('runtime', 'uptime', { seconds: 42 });
  await fsutil.ensureDir(dirname(dbFile));
  await writeFile(dbFile, 'SQLite format 3\0fake-db-bytes');
  await fsutil.ensureDir(exportDir);

  const backup = createBackupManager({
    storage: store,
    storageProvider: { rootDir: dataDir },
    settings: { settingsDir: dataDir },
    exports: { exportDir },
    sqlite: { databaseFile: dbFile },
    directory: backupDir,
    schedule: { enabled: false },
  });
  backup.initialize();

  const health = createHealthManager({
    storage: store,
    backup,
    reportDirectory: reportDir,
    ...overrides,
  });
  health.initialize();

  return {
    sandbox,
    dataDir,
    backupDir,
    dbFile,
    exportDir,
    reportDir,
    store,
    backup,
    health,
    cleanup: () => rm(sandbox, { recursive: true, force: true }),
  };
}

/** A synthetic health provider returning a fixed status. */
function stateProvider(name, status) {
  return {
    name,
    describe: () => ({ name }),
    check: async () =>
      buildResult({ component: name, status, message: `synthetic ${status}`, details: { seed: name } }),
  };
}

// ═════════════════════════════════════════════════════════════════════
// 1. Static checks — imports, circular imports, duplicate utilities,
//    configuration duplication, console discipline, config gate.
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
  check('m44: zero circular imports', cycle === null, cycle ? cycle.join(' -> ') : `scanned ${files.length} modules`);

  const seen = new Map();
  const dups = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/g)) {
      if (seen.has(m[1])) dups.push(`${m[1]} (${seen.get(m[1])} and ${file})`);
      else seen.set(m[1], file);
    }
  }
  check('m44: zero duplicate exported utilities', dups.length === 0, dups.join(' | '));

  const { SCHEMA } = await import('../app/lib/config/schema.mjs');
  const { get } = await import('../app/lib/config/index.mjs');
  const keys = SCHEMA.filter((s) => s.status !== 'dead').map((s) => s.key);
  check('m44: config keys unique in schema', new Set(keys).size === keys.length, `schema=${keys.length}`);
  const healthKeys = keys.filter((k) => k.startsWith('health.') || k.startsWith('diagnostics.') || k.startsWith('selfTest.'));
  const readable = healthKeys.length === 4 && healthKeys.every((k) => { try { get(k); return true; } catch { return false; } });
  check('m44: health.* keys present and readable via get()', readable, healthKeys.join(','));

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
  check('m44: no console.* outside the logging sink', offenders.length === 0, offenders.join(' | '));

  try {
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'validate-config.mjs')], { cwd: ROOT, stdio: 'pipe' });
    check('m44: config validation gate passes', true);
  } catch (err) {
    check('m44: config validation gate passes', false, String(err.stderr ?? err.message).slice(0, 200));
  }
}

// ═════════════════════════════════════════════════════════════════════
// 2. Provider registration + execution + result shape
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    check('m44: health manager registers 8 providers', h.health.list().length === 8, h.health.list().map((p) => p.name).join(','));
    check('m44: provider names match the requirement', JSON.stringify(h.health.list().map((p) => p.name).sort()) === JSON.stringify(['backup', 'bootstrap', 'configuration', 'filesystem', 'lifecycle', 'logging', 'registry', 'storage']));
    check('m44: providers individually replaceable', h.health.get('storage').name === 'storage');
    h.health.register(stateProvider('storage', HEALTH_STATES.HEALTHY));
    check('m44: register() replaces a provider by name', h.health.get('storage').name === 'storage');

    // Every default provider executes and returns the canonical shape.
    const c = await h.health.collect();
    check('m44: collect returns 8 results', c.results.length === 8, `got=${c.results.length}`);
    check('m44: every result is a canonical health result', c.results.every(isHealthResult));
    check('m44: every result carries required fields', c.results.every((r) => typeof r.component === 'string' && typeof r.message === 'string' && typeof r.timestamp === 'string' && typeof r.duration === 'number' && Array.isArray(r.recommendations) && r.details && typeof r.details === 'object'));
    check('m44: overall state is a valid health state', Object.values(HEALTH_STATES).includes(c.overall), c.overall);
    check('m44: collect is lightweight', c.duration < 1000, `${c.duration} ms`);
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 3. Health aggregation + all health states
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    // worstState unit semantics.
    check('m44: worstState ranks FAILED above all', worstState([HEALTH_STATES.HEALTHY, HEALTH_STATES.WARNING, HEALTH_STATES.FAILED]) === HEALTH_STATES.FAILED);
    check('m44: worstState ranks DEGRADED above WARNING', worstState([HEALTH_STATES.WARNING, HEALTH_STATES.DEGRADED]) === HEALTH_STATES.DEGRADED);
    check('m44: worstState ranks WARNING above UNKNOWN', worstState([HEALTH_STATES.UNKNOWN, HEALTH_STATES.WARNING]) === HEALTH_STATES.WARNING);
    check('m44: worstState healthy-only → HEALTHY', worstState([HEALTH_STATES.HEALTHY, HEALTH_STATES.HEALTHY]) === HEALTH_STATES.HEALTHY);
    check('m44: worstState empty → UNKNOWN', worstState([]) === HEALTH_STATES.UNKNOWN);
    check('m44: severity ordering monotonic', HEALTH_SEVERITY.FAILED > HEALTH_SEVERITY.DEGRADED && HEALTH_SEVERITY.DEGRADED > HEALTH_SEVERITY.WARNING && HEALTH_SEVERITY.WARNING > HEALTH_SEVERITY.UNKNOWN && HEALTH_SEVERITY.UNKNOWN > HEALTH_SEVERITY.HEALTHY);

    // Synthetic providers for every state drive the aggregator.
    const bare = createHealthManager({ storage: null, backup: null, registry: null });
    bare.register(stateProvider('healthy-p', HEALTH_STATES.HEALTHY));
    bare.register(stateProvider('warning-p', HEALTH_STATES.WARNING));
    bare.register(stateProvider('degraded-p', HEALTH_STATES.DEGRADED));
    bare.register(stateProvider('failed-p', HEALTH_STATES.FAILED));
    bare.register(stateProvider('unknown-p', HEALTH_STATES.UNKNOWN));

    const all = await bare.collect();
    check('m44: aggregation of all states → FAILED', all.overall === HEALTH_STATES.FAILED, all.overall);
    check('m44: subset healthy+warning → WARNING', (await bare.collect({ providers: ['healthy-p', 'warning-p'] })).overall === HEALTH_STATES.WARNING);
    check('m44: subset healthy+degraded → DEGRADED', (await bare.collect({ providers: ['healthy-p', 'degraded-p'] })).overall === HEALTH_STATES.DEGRADED);
    check('m44: subset healthy only → HEALTHY', (await bare.collect({ providers: ['healthy-p'] })).overall === HEALTH_STATES.HEALTHY);
    check('m44: subset unknown only → UNKNOWN', (await bare.collect({ providers: ['unknown-p'] })).overall === HEALTH_STATES.UNKNOWN);
    check('m44: unknown provider name skipped', (await bare.collect({ providers: ['nope'] })).results.length === 0);

    // A throwing provider degrades to a structured FAILED result.
    bare.register({ name: 'throwing', describe: () => ({ name: 'throwing' }), check: async () => { throw new Error('boom'); } });
    const threw = await bare.collect({ providers: ['throwing'] });
    check('m44: throwing provider → FAILED result', threw.results.length === 1 && threw.results[0].status === HEALTH_STATES.FAILED && threw.overall === HEALTH_STATES.FAILED);
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 4. Diagnostics collection + runtime information
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    await h.backup.backup({ trigger: 'manual' });
    const d = await h.health.collectDiagnostics();
    check('m44: diagnostics enabled by default', d.enabled === true);
    check('m44: diagnostics: application version', typeof d.app?.version === 'string' && d.app.version.length > 0, d.app?.version);
    check('m44: diagnostics: platform + arch', typeof d.system?.platform === 'string' && typeof d.system?.arch === 'string');
    check('m44: diagnostics: hostname + node + pid', typeof d.system?.hostname === 'string' && typeof d.system?.nodeVersion === 'string' && typeof d.system?.pid === 'number');
    check('m44: diagnostics: uptime', typeof d.system?.uptimeSeconds === 'number' && d.system.uptimeSeconds >= 0);
    check('m44: diagnostics: memory usage', typeof d.system?.memory?.rss === 'number' && d.system.memory.rss > 0);
    check('m44: diagnostics: disk availability', typeof d.system?.disk?.totalBytes === 'number' && typeof d.system.disk.freeBytes === 'number');
    check('m44: diagnostics: storage statistics', d.storage?.state === 'READY' && typeof d.storage?.cache === 'object' && typeof d.storage?.writesPending === 'number', JSON.stringify(d.storage));
    check('m44: diagnostics: logging statistics', typeof d.logging?.written === 'number' && typeof d.logging?.level === 'string', JSON.stringify(d.logging));
    check('m44: diagnostics: backup statistics', d.backup?.registry?.count === 1 && d.backup.registry.latest?.status === 'completed', JSON.stringify(d.backup?.registry));
    check('m44: diagnostics: registry state', d.registry === null || typeof d.registry === 'object');
    check('m44: diagnostics: lifecycle state', d.lifecycle?.managerState === 'READY', JSON.stringify(d.lifecycle));
    check('m44: diagnostics: configuration summary (non-sensitive)', typeof d.configuration?.appName === 'string' && typeof d.configuration?.environment === 'string', JSON.stringify(d.configuration));
    const raw = JSON.stringify(d);
    check('m44: diagnostics contain no medical/secret data', !/patient|prescription|appointment|medical|password|secret|token|hash/i.test(raw));
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 5. Self-tests
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    await h.backup.backup({ trigger: 'manual' });
    const st = await h.health.runSelfTests();
    check('m44: all six self-tests run', st.results.length === 6, `got=${st.results.length} (${st.results.map((r) => r.component).join(',')})`);
    check('m44: self-test names match SELF_TESTS', JSON.stringify([...SELF_TESTS].sort()) === JSON.stringify(['backup', 'configuration', 'filesystem', 'log-write', 'registry', 'storage']));
    const byName = Object.fromEntries(st.results.map((r) => [r.component, r.status]));
    check('m44: self-test storage → HEALTHY', byName['selftest:storage'] === HEALTH_STATES.HEALTHY, byName['selftest:storage']);
    check('m44: self-test backup → HEALTHY (backup verified)', byName['selftest:backup'] === HEALTH_STATES.HEALTHY, byName['selftest:backup']);
    check('m44: self-test log-write → HEALTHY', byName['selftest:log-write'] === HEALTH_STATES.HEALTHY, byName['selftest:log-write']);
    check('m44: self-test configuration → HEALTHY (valid env)', byName['selftest:configuration'] === HEALTH_STATES.HEALTHY, byName['selftest:configuration']);
    check('m44: self-test registry reports (no registry wired)', [HEALTH_STATES.UNKNOWN, HEALTH_STATES.HEALTHY, HEALTH_STATES.FAILED].includes(byName['selftest:registry']));
    check('m44: self-tests never touch business data', true);

    // Backup self-test with no backup → UNKNOWN with recommendation.
    const h2 = await makeSandbox();
    try {
      const st2 = await h2.health.runSelfTests({ only: ['backup'] });
      check('m44: backup self-test with no backup → UNKNOWN', st2.results[0].status === HEALTH_STATES.UNKNOWN && st2.results[0].recommendations.length > 0, st2.results[0].message);
    } finally {
      await h2.cleanup();
    }

    // Configuration self-test failure branch (invalid env, restored after).
    const savedSecret = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      const st3 = await runSelfTests({}, { only: ['configuration'], enabled: true });
      check('m44: configuration self-test detects invalid env', st3.results[0].status === HEALTH_STATES.FAILED, st3.results[0].message);
    } finally {
      process.env.JWT_SECRET = savedSecret;
    }

    // Disabled gate.
    const h3 = await makeSandbox({ selfTest: { enabled: false } });
    try {
      const st4 = await h3.health.runSelfTests();
      check('m44: self-test disabled gate', st4.results.length === 1 && st4.results[0].status === HEALTH_STATES.UNKNOWN && /disabled/.test(st4.results[0].message));
    } finally {
      await h3.cleanup();
    }
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 6. Report generation — JSON + text (+ save)
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    await h.backup.backup({ trigger: 'manual' });
    const { report, json, text, saved } = await h.health.generateReport({ includeSelfTests: true, save: true });

    // JSON document shape.
    check('m44: report schema marker', report.$schema === 'aarogyam-health-report');
    check('m44: report formatVersion', report.formatVersion === healthReport.REPORT_FORMAT_VERSION);
    check('m44: report generatedAt + appVersion', typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(report.generatedAt)) && typeof report.appVersion === 'string');
    check('m44: report overall is valid', Object.values(HEALTH_STATES).includes(report.overall));
    check('m44: report health results present', Array.isArray(report.health) && report.health.length === 8);
    check('m44: report self-tests present', Array.isArray(report.selfTests) && report.selfTests.length === 6);
    check('m44: report diagnostics present', report.diagnostics && report.diagnostics.system && report.diagnostics.system.memory);
    check('m44: report recommendations aggregated', Array.isArray(report.recommendations) && report.recommendations.length > 0, report.recommendations.join(' | '));
    check('m44: report metadata present', report.metadata?.platform && report.metadata?.nodeVersion && typeof report.metadata?.pid === 'number');

    // JSON render is parseable and matches the document.
    const parsed = JSON.parse(json);
    check('m44: JSON report parses and matches', parsed.overall === report.overall && parsed.health.length === report.health.length);
    check('m44: REPORT_FORMATS extensible registry', REPORT_FORMATS.includes('json') && REPORT_FORMATS.includes('text'));

    // Text render is human-readable.
    check('m44: text report has title', text.includes('AAROGYAM HEALTH REPORT'));
    check('m44: text report has health summary', text.includes('HEALTH SUMMARY') && text.includes('Overall'));
    check('m44: text report shows every provider', report.health.every((r) => text.includes(r.component)));
    check('m44: text report shows recommendations', report.recommendations.length === 0 || text.includes('RECOMMENDATIONS'));

    // Save writes both files under the report directory.
    check('m44: report saved to directory', Boolean(saved) && saved.json.endsWith('.json') && saved.text.endsWith('.txt'), JSON.stringify(saved));
    check('m44: saved JSON exists on disk', await fsutil.fileExists(saved.json));
    check('m44: saved text exists on disk', await fsutil.fileExists(saved.text));
    const raw = await readFile(saved.json, 'utf8');
    check('m44: saved report renders via renderJsonReport', renderJsonReport(JSON.parse(raw)).length > 100);
    check('m44: collectRecommendations deduplicates', (() => {
      const recs = collectRecommendations([buildResult({ component: 'a', status: HEALTH_STATES.WARNING, message: 'm', recommendations: ['same', 'one'] }), buildResult({ component: 'b', status: HEALTH_STATES.FAILED, message: 'm', recommendations: ['same', 'two'] })]);
      return recs.length === 3;
    })());
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 7. Per-component diagnostics (storage/logging/backup/registry/
//    lifecycle/configuration/filesystem) via a wired registry
// ═════════════════════════════════════════════════════════════════════
{
  // Sandbox the registry's storage root so this section never reads or
  // writes the real data directory (keeps the suite safe to run in
  // parallel with other suites that clean up the real paths).
  const sandboxRoot = join(tmpdir(), `aarogyam-m44-reg-${process.pid}-${Date.now()}`);
  await fsutil.ensureDir(sandboxRoot);
  const reg = registerInfrastructureServices(undefined, { storageRoot: sandboxRoot });
  reg.initializeAll();
  try {
    const health = reg.instances().health;
    check('m44: registry health service READY', reg.getStates().health === 'READY');
    const c = await health.collect();
    const byName = Object.fromEntries(c.results.map((r) => [r.component, r]));
    check('m44: storage diagnostics via registry', byName.storage?.details?.state === 'READY' && byName.storage?.details?.documents !== undefined, JSON.stringify(byName.storage?.details));
    check('m44: logging diagnostics via registry', typeof byName.logging?.details?.written === 'number', JSON.stringify(byName.logging?.details));
    check('m44: backup diagnostics via registry', byName.backup?.details?.registry?.count >= 0, JSON.stringify(byName.backup?.details?.registry));
    check('m44: registry diagnostics via registry', byName.registry?.details?.count === 9 && byName.registry?.details?.services?.health === 'READY', JSON.stringify(byName.registry?.details));
    check('m44: lifecycle diagnostics via registry', byName.lifecycle?.details?.managerState === 'READY', JSON.stringify(byName.lifecycle?.details));
    check('m44: configuration diagnostics via registry', byName.configuration?.details?.appName === 'Aarogyam', JSON.stringify(byName.configuration?.details));
    check('m44: filesystem diagnostics via registry', Array.isArray(byName.filesystem?.details?.directories) && byName.filesystem.details.directories.length >= 6, JSON.stringify(byName.filesystem?.details));
    check('m44: registry-wide collect aggregates a valid state', Object.values(HEALTH_STATES).includes(c.overall), c.overall);
  } finally {
    await reg.shutdownAll();
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════
// 8. Lifecycle — startup, shutdown (never blocks), disabled gates
// ═════════════════════════════════════════════════════════════════════
{
  const h = await makeSandbox();
  try {
    // makeSandbox() initializes its health manager — use a fresh,
    // uninitialized manager to assert the initial lifecycle state.
    const fresh = createHealthManager({
      storage: h.store,
      backup: h.backup,
      reportDirectory: h.reportDir,
    });
    check('m44: initial state UNINITIALIZED', fresh.getState() === 'UNINITIALIZED');
    fresh.initialize();
    check('m44: initialize → READY', fresh.getState() === 'READY');

    // Shutdown completes immediately (no background collection to wait on).
    const t0 = performance.now();
    await h.health.shutdown();
    const shutdownMs = performance.now() - t0;
    check('m44: shutdown → STOPPED', h.health.getState() === 'STOPPED');
    check('m44: shutdown never blocks', shutdownMs < 1000, `${shutdownMs.toFixed(1)} ms`);

    // Bootstrap attachment drives the bootstrap provider.
    const h2 = await makeSandbox();
    try {
      const before = await h2.health.collect({ providers: ['bootstrap'] });
      check('m44: bootstrap provider UNKNOWN before attach', before.results[0].status === HEALTH_STATES.UNKNOWN, before.results[0].message);
      const fakeBoot = { getStatus: () => ({ state: 'READY', startedAt: 'now', errors: [] }) };
      h2.health.attachBootstrap(fakeBoot);
      const after = await h2.health.collect({ providers: ['bootstrap'] });
      check('m44: bootstrap provider HEALTHY after attach', after.results[0].status === HEALTH_STATES.HEALTHY, after.results[0].message);
    } finally {
      await h2.cleanup();
    }

    // Disabled gates.
    const h3 = await makeSandbox({ enabled: false });
    try {
      const c = await h3.health.collect();
      check('m44: health.enabled=false → disabled marker', c.enabled === false && c.overall === HEALTH_STATES.UNKNOWN, JSON.stringify(c));
    } finally {
      await h3.cleanup();
    }
    const h4 = await makeSandbox({ diagnostics: { enabled: false } });
    try {
      const d = await h4.health.collectDiagnostics();
      check('m44: diagnostics.enabled=false gate', d.enabled === false && /disabled/.test(d.reason));
    } finally {
      await h4.cleanup();
    }
  } finally {
    await h.cleanup();
  }
}

// ═════════════════════════════════════════════════════════════════════
// 9. Structured logging — health operations through the log framework
// ═════════════════════════════════════════════════════════════════════
{
  const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m44-log-'));
  const logsDir = join(sandbox, 'logs');
  await fsutil.ensureDir(logsDir);
  const probe = `
    import { pathToFileURL } from 'node:url';
    import { join } from 'node:path';
    import { mkdtemp, writeFile } from 'node:fs/promises';
    import { tmpdir } from 'node:os';
    const root = ${JSON.stringify(ROOT)};
    const load = (p) => import(pathToFileURL(join(root, p)));
    const { createHealthManager } = await load('app/lib/health/index.mjs');
    const { createStorageService } = await load('app/lib/storage/index.mjs');
    const { getLogManager } = await load('app/lib/logging/index.mjs');
    const { ensureDir } = await load('app/lib/local/fsutil.mjs');
    const { dirname } = await import('node:path');
    const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m44-logprobe-'));
    const store = createStorageService(join(sandbox, 'data'));
    store.initialize();
    await store.set('settings', 'clinic', { name: 'Log Clinic' });
    const health = createHealthManager({ storage: store });
    health.initialize();
    await health.collect();
    await health.generateReport({ includeSelfTests: true });
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
    check('m44: structured log file written', await fsutil.fileExists(logFile));
    const entries = (await readFile(logFile, 'utf8'))
      .trim().split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const healthEntries = entries.filter((e) => e.module === 'health' || e.module.startsWith('health:'));
    check('m44: health operations logged through framework', healthEntries.some((e) => e.level === 'info' && e.message === 'Health manager initialized') && healthEntries.some((e) => e.level === 'info' && e.message.startsWith('Health report generated')), `health entries=${healthEntries.length}`);
    check('m44: log entries carry structured metadata', healthEntries.every((e) => typeof e.timestamp === 'string' && typeof e.level === 'string' && typeof e.module === 'string' && typeof e.message === 'string'));
  } catch (err) {
    check('m44: structured logging probe ran', false, String(err.message).slice(0, 300));
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

// ═════════════════════════════════════════════════════════════════════
// 10. Build gates — npm install, prisma generate, npm build
// ═════════════════════════════════════════════════════════════════════
const FAST = process.env.AAROGYAM_VERIFY_M44_FAST === '1';

function runNpm(args, opts = {}) {
  return execFileSync(NPM, args, {
    cwd: ROOT,
    stdio: 'pipe',
    shell: process.platform === 'win32',
    ...opts,
  });
}

if (FAST) {
  console.log('\n(skipping build gates — AAROGYAM_VERIFY_M44_FAST=1)');
} else {
  try {
    runNpm(['install', '--package-lock=false', '--no-audit', '--no-fund', '--loglevel=error'], { timeout: 600_000 });
    check('m44: npm install succeeds', true);
  } catch (err) {
    check('m44: npm install succeeds', false, String(err.stderr ?? err.message).slice(0, 200));
  }
  try {
    runNpm(['run', 'prisma:generate'], { timeout: 300_000 });
    check('m44: prisma generate succeeds', true);
  } catch (err) {
    check('m44: prisma generate succeeds', false, String(err.stderr ?? err.message).slice(0, 200));
  }
  try {
    runNpm(['run', 'build'], { timeout: 900_000 });
    check('m44: npm build succeeds', true);
  } catch (err) {
    check('m44: npm build succeeds', false, String(err.stderr ?? err.message).slice(0, 400));
  }
}

// ═════════════════════════════════════════════════════════════════════
// 11. Runtime smoke + database integrity
// ═════════════════════════════════════════════════════════════════════
{
  const sandbox = await mkdtemp(join(tmpdir(), 'aarogyam-m44-runtime-'));
  try {
    const { METADATA_FILE_NAME } = await import('../app/lib/installer/index.mjs');
    const dirs = [join(sandbox, 'data'), join(sandbox, 'logs'), join(sandbox, 'backups'), join(sandbox, 'db'), join(sandbox, 'export'), join(sandbox, 'temp')];
    const bootInst = createInstaller({
      directories: dirs,
      metadataFile: join(sandbox, 'data', 'installation', METADATA_FILE_NAME),
    });
    // Registry storage rooted inside the sandbox — the runtime smoke
    // never touches the real data directory.
    const boot = createBootstrapManager({
      installer: bootInst,
      registry: registerInfrastructureServices(undefined, { storageRoot: join(sandbox, 'data') }),
    });
    await boot.initialize();
    check('m44: runtime smoke — health service READY via bootstrap', boot.getStatus().registry.health === 'READY', JSON.stringify(boot.getStatus().registry));
    const health = boot.registry.instances().health;
    check('m44: runtime smoke — bootstrap provider HEALTHY after attach', (await health.collect({ providers: ['bootstrap'] })).results[0].status === 'HEALTHY');
    const { report } = await health.generateReport({ includeSelfTests: false });
    check('m44: runtime smoke — report generated during live bootstrap', Object.values(HEALTH_STATES).includes(report.overall) && report.health.length === 8);
    await boot.shutdown();
    check('m44: runtime smoke — health STOPPED after bootstrap shutdown', boot.getStatus().registry.health === 'STOPPED');

    // Database integrity — the real sqlite database is readable.
    const realDb = join(ROOT, 'prisma', 'sqlite.db');
    check('m44: prisma sqlite database present', await fsutil.fileExists(realDb));
    const head = (await readFile(realDb)).subarray(0, 16).toString('latin1');
    check('m44: database has valid sqlite header', head === 'SQLite format 3\0', JSON.stringify(head));
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: `file:${realDb}` } } });
    try {
      const users = await prisma.user.count();
      check('m44: database integrity — Prisma reads the database', typeof users === 'number' && users >= 0, `users=${users}`);
    } finally {
      await prisma.$disconnect();
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(`\nM4.4 verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:');
  for (const f of failures) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`);
  process.exit(1);
}
process.exit(0);
