/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Self-Tests  (Milestone 4.4)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    On-demand executable health checks. Self-tests are READ-ONLY with
 *    respect to application data — they never modify business data.
 *    The filesystem probe writes and deletes a temporary probe file in
 *    the target directory (a standard writability check, not business
 *    data); the log-write probe uses an isolated throwaway log manager
 *    under the system temp directory.
 *
 *  Self-tests:
 *    • storage      storage.verify()  — document envelope + checksum check
 *    • backup       verify the newest backup on disk
 *    • log-write    end-to-end write through an isolated log manager
 *    • configuration validateConfig(process.env)
 *    • filesystem   required directories exist AND are writable
 *    • registry     every registered service is READY
 *
 *  Dependencies: node:os, node:path, app/lib/config/validate,
 *    app/lib/local/paths, app/lib/local/fsutil, app/lib/logging,
 *    app/lib/health/model. No cycles.
 */

import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../config/validate.mjs';
import { get } from '../config/index.mjs';
import { paths } from '../local/paths.mjs';
import * as fsutil from '../local/fsutil.mjs';
import { createLogManager } from '../logging/index.mjs';
import { HEALTH_STATES, buildResult, worstState } from './model.mjs';

/** True when self-tests may execute (config gate). */
export function selfTestsEnabled() {
  return get('selfTest.enabled', true) !== false;
}

/** Required directories probed by the filesystem self-test. */
export const SELFTEST_DIRS = Object.freeze([
  ['data', paths.dataDir],
  ['logs', paths.logsDir],
  ['backups', paths.backupsDir],
  ['database', paths.databaseDir],
  ['exports', paths.exportDir],
  ['temp', paths.tempDir],
]);

// ── Individual self-tests (each returns a health result) ────────────
async function selfTestStorage({ storage }) {
  const start = Date.now();
  if (!storage || typeof storage.verify !== 'function') {
    return buildResult({
      component: 'selftest:storage',
      status: HEALTH_STATES.UNKNOWN,
      message: 'Storage engine dependency not provided',
      duration: Date.now() - start,
    });
  }
  const verified = await storage.verify();
  return buildResult({
    component: 'selftest:storage',
    status: verified.ok ? HEALTH_STATES.HEALTHY : HEALTH_STATES.FAILED,
    message: verified.ok
      ? `Storage verified (${verified.checked} document(s))`
      : `Storage verification failed (${verified.errors.length} error(s))`,
    details: { checked: verified.checked, errors: verified.errors.slice(0, 10) },
    recommendations: verified.ok ? [] : ['Inspect the storage engine documents and restore from backup'],
    duration: Date.now() - start,
  });
}

async function selfTestBackup({ backup }) {
  const start = Date.now();
  if (!backup || typeof backup.listBackups !== 'function' || typeof backup.verify !== 'function') {
    return buildResult({
      component: 'selftest:backup',
      status: HEALTH_STATES.UNKNOWN,
      message: 'Backup manager dependency not provided',
      duration: Date.now() - start,
    });
  }
  let latest = null;
  try {
    const list = await backup.listBackups();
    latest = list[0] ?? null;
  } catch (err) {
    return buildResult({
      component: 'selftest:backup',
      status: HEALTH_STATES.FAILED,
      message: `Backup registry unreadable: ${err.message}`,
      duration: Date.now() - start,
    });
  }
  if (!latest) {
    return buildResult({
      component: 'selftest:backup',
      status: HEALTH_STATES.UNKNOWN,
      message: 'No backup exists yet — nothing to verify',
      recommendations: ['Create a backup, then re-run this self-test'],
      duration: Date.now() - start,
    });
  }
  const verified = await backup.verify(latest.id);
  return buildResult({
    component: 'selftest:backup',
    status: verified.ok ? HEALTH_STATES.HEALTHY : HEALTH_STATES.FAILED,
    message: verified.ok
      ? `Backup "${latest.id}" verified`
      : `Backup "${latest.id}" failed verification`,
    details: { id: latest.id, failures: verified.errors.map((e) => e.name) },
    recommendations: verified.ok ? [] : ['Recreate the backup (its integrity is broken)'],
    duration: Date.now() - start,
  });
}

async function selfTestLogWrite() {
  const start = Date.now();
  const dir = await mkdtemp(join(tmpdir(), 'aarogyam-selftest-log-'));
  try {
    const mgr = createLogManager({
      level: 'info',
      console: { enabled: false },
      file: { enabled: true, dir, filename: 'probe.log', maxSize: 1024 * 1024, maxFiles: 2 },
    });
    mgr.initialize();
    const log = { info: (...args) => mgr.emit('info', 'selftest', args) };
    log.info('health self-test probe');
    await mgr.flush();
    const written = mgr.getStats().written;
    const entries = (await readFile(join(dir, 'probe.log'), 'utf8')).trim().split('\n').filter(Boolean);
    await mgr.shutdown();
    const ok = written === 1 && entries.length === 1 && entries[0].includes('health self-test probe');
    return buildResult({
      component: 'selftest:log-write',
      status: ok ? HEALTH_STATES.HEALTHY : HEALTH_STATES.FAILED,
      message: ok ? 'Log write verified end-to-end' : 'Log write probe failed',
      details: { written, entries: entries.length },
      duration: Date.now() - start,
    });
  } catch (err) {
    return buildResult({
      component: 'selftest:log-write',
      status: HEALTH_STATES.FAILED,
      message: `Log write probe threw: ${err.message}`,
      duration: Date.now() - start,
    });
  } finally {
    await fsutil.removeRecursive(dir).catch(() => {});
  }
}

async function selfTestConfiguration() {
  const start = Date.now();
  try {
    validateConfig(process.env);
    return buildResult({
      component: 'selftest:configuration',
      status: HEALTH_STATES.HEALTHY,
      message: 'Configuration validation passed',
      duration: Date.now() - start,
    });
  } catch (err) {
    return buildResult({
      component: 'selftest:configuration',
      status: HEALTH_STATES.FAILED,
      message: 'Configuration validation failed',
      details: { error: err.message },
      recommendations: ['Fix the configuration and restart'],
      duration: Date.now() - start,
    });
  }
}

async function selfTestFilesystem() {
  const start = Date.now();
  const results = [];
  for (const [label, dir] of SELFTEST_DIRS) {
    const probe = await fsutil.verifyDirectory(dir, { writable: true });
    results.push({ label, dir, ...probe });
  }
  const failures = results.filter((r) => !r.exists || !r.isDirectory || !r.writable);
  return buildResult({
    component: 'selftest:filesystem',
    status: failures.length === 0 ? HEALTH_STATES.HEALTHY : HEALTH_STATES.FAILED,
    message:
      failures.length === 0
        ? `All ${results.length} required directories exist and are writable`
        : `${failures.length} required directory/ies failed the probe`,
    details: { results },
    recommendations:
      failures.length > 0
        ? ['Run the installer/bootstrap to (re)create the required directories']
        : [],
    duration: Date.now() - start,
  });
}

async function selfTestRegistry({ registry }) {
  const start = Date.now();
  if (!registry || typeof registry.getStates !== 'function') {
    return buildResult({
      component: 'selftest:registry',
      status: HEALTH_STATES.UNKNOWN,
      message: 'Service registry dependency not provided',
      duration: Date.now() - start,
    });
  }
  const states = registry.getStates();
  const failed = Object.entries(states).filter(([, s]) => s === 'FAILED');
  const notReady = Object.entries(states).filter(([, s]) => s !== 'READY');
  const ok = failed.length === 0 && notReady.length === 0;
  return buildResult({
    component: 'selftest:registry',
    status: ok ? HEALTH_STATES.HEALTHY : HEALTH_STATES.FAILED,
    message: ok ? 'Every service is READY' : 'Not every service is READY',
    details: { failed: failed.map(([n]) => n), notReady: notReady.map(([n]) => n), states },
    recommendations: ok ? [] : ['Restart the failing services and re-run the self-test'],
    duration: Date.now() - start,
  });
}

/** All self-tests, in canonical order. */
export const SELF_TESTS = Object.freeze([
  'storage',
  'backup',
  'log-write',
  'configuration',
  'filesystem',
  'registry',
]);

/**
 * Run the self-tests.
 * @param {object} deps { storage, backup, registry }
 * @param {object} [options]
 * @param {string[]} [options.only] subset of SELF_TESTS
 * @param {boolean} [options.enabled] override gate (default: config)
 * @returns {Promise<{ overall, results }>}
 */
export async function runSelfTests(deps = {}, { only = null, enabled = selfTestsEnabled() } = {}) {
  if (!enabled) {
    return {
      overall: HEALTH_STATES.UNKNOWN,
      results: [
        buildResult({
          component: 'selftest',
          status: HEALTH_STATES.UNKNOWN,
          message: 'Self-tests are disabled (selfTest.enabled=false)',
        }),
      ],
    };
  }

  const runners = {
    storage: () => selfTestStorage(deps),
    backup: () => selfTestBackup(deps),
    'log-write': selfTestLogWrite,
    configuration: selfTestConfiguration,
    filesystem: selfTestFilesystem,
    registry: () => selfTestRegistry(deps),
  };
  const selected = only ?? SELF_TESTS;
  const results = [];
  for (const name of selected) {
    const runner = runners[name];
    if (!runner) continue;
    try {
      results.push(await runner());
    } catch (err) {
      results.push(
        buildResult({
          component: `selftest:${name}`,
          status: HEALTH_STATES.FAILED,
          message: `Self-test threw: ${err.message}`,
        })
      );
    }
  }
  return { overall: worstState(results.map((r) => r.status)), results };
}
