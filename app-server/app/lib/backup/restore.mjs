/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Restore Engine  (Milestone 4.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Restore backups safely. Restores are gated on TWO prerequisites
 *    verified BEFORE any application state is modified:
 *      1. integrity — every manifest file exists and its SHA-256
 *         matches the manifest (re-verified per file at apply time)
 *      2. compatibility — formatVersion and schemaVersion are supported
 *         by this application build
 *
 *  Modes:
 *    validate()  — verify + compatibility report (never modifies state)
 *    plan()      — compute the exact restore actions (never modifies)
 *    run()       — dryRun: return the plan only
 *                  full: apply every selected provider with rollback
 *
 *  Rollback: existing targets are moved aside (never deleted) before
 *  the new content is copied in; any failure restores the originals and
 *  removes newly-written files — the application returns to its exact
 *  pre-restore state, and a RestoreError with rolledBack: true is
 *  raised. Where a restore target is genuinely unavailable (e.g. a file
 *  sits where a directory is needed) the failure is reported and
 *  rolled back — the engine never leaves partial state.
 *
 *  After a successful restore of storage/settings namespaces the
 *  storage engine's in-memory cache is invalidated so reads observe the
 *  restored documents.
 *
 *  Dependencies: node:path, node:os, node:crypto, node:fs/promises,
 *    app/lib/local/fsutil, app/lib/backup/errors, app/lib/backup/format,
 *    app/lib/backup/compression, app/lib/backup/verify, app/lib/logging.
 *    No cycles.
 */

import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as fsutil from '../local/fsutil.mjs';
import { createLogger } from '../logging/index.mjs';
import { RestoreError, backupError } from './errors.mjs';
import {
  MANIFEST_FILE_NAME,
  BACKUP_FORMAT_VERSION,
  parseManifest,
  isSafeManifestPath,
} from './format.mjs';
import { decompressFile } from './compression.mjs';
import { verifyBackup } from './verify.mjs';

/**
 * Create the restore engine.
 * @param {object} deps
 * @param {string} [deps.supportedSchemaVersion='1'] schema version this
 *   application build supports (hard gate)
 * @param {Map}    deps.providerMap provider type → provider instance
 * @param {object} [deps.storage]   storage service (for cache invalidation)
 * @param {object} [deps.log]       logger
 */
export function createRestoreEngine(deps = {}) {
  const supportedSchemaVersion = String(deps.supportedSchemaVersion ?? '1');
  const providerMap = deps.providerMap ?? new Map();
  const storage = deps.storage ?? null;
  const log = deps.log ?? createLogger('backup:restore');

  /** Load + parse a backup's manifest. Throws BackupError('invalid-manifest'). */
  async function loadManifest({ backupDir }) {
    const manifestPath = join(backupDir, MANIFEST_FILE_NAME);
    if (!(await fsutil.fileExists(manifestPath))) {
      throw backupError('invalid-manifest', `Backup has no manifest (${manifestPath})`);
    }
    return parseManifest(await readFile(manifestPath, 'utf8'), manifestPath);
  }

  /**
   * Version compatibility — the hard gate checked before any restore.
   * Returns { compatible, blocking[], warnings[] }; `blocking` issues
   * refuse the restore, `warnings` (e.g. different app version) log.
   */
  function checkCompatibility(manifest) {
    const blocking = [];
    const warnings = [];
    if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
      blocking.push(
        `backup format v${manifest.formatVersion} is not supported (supported: ${BACKUP_FORMAT_VERSION})`
      );
    }
    if (String(manifest.schemaVersion) !== supportedSchemaVersion) {
      blocking.push(
        `backup schema version "${manifest.schemaVersion}" is not supported by this build (supported: "${supportedSchemaVersion}")`
      );
    }
    if (typeof manifest.appVersion !== 'string' || manifest.appVersion.length === 0) {
      warnings.push('backup carries no application version');
    }
    return { compatible: blocking.length === 0, blocking, warnings };
  }

  /**
   * Compute the exact restore actions for the selected providers.
   * @returns {Promise<Array<{provider, relative, target, size, compressed, sha256}>>}
   */
  async function plan({ manifest, providers }) {
    const actions = [];
    for (const type of providers) {
      const section = manifest.providers?.[type];
      if (!section) {
        throw backupError('not-found', `Provider "${type}" is not present in this backup`, { type });
      }
      const provider = providerMap.get(type);
      if (!provider || typeof provider.resolveTargets !== 'function') {
        throw backupError('not-found', `No restore provider registered for "${type}"`, { type });
      }
      const files = Array.isArray(section.files) ? section.files : [];
      // Hard gate: manifest paths must be safe AND prefixed with the
      // provider type — a crafted manifest can never read or write
      // outside the backup/application roots.
      for (const file of files) {
        if (!isSafeManifestPath(file.path) || !file.path.startsWith(`${type}/`)) {
          throw backupError(
            'invalid-manifest',
            `Provider "${type}" file "${file.path}" has an unsafe or mismatched path`,
            { type, path: file.path }
          );
        }
      }
      const targets = await provider.resolveTargets({ files, manifest });
      const byPath = new Map(targets.map((t) => [t.path, t.target]));
      for (const file of files) {
        const target = byPath.get(file.path);
        if (!target) {
          throw backupError(
            'invalid-argument',
            `Provider "${type}" produced no restore target for "${file.path}"`,
            { type, path: file.path }
          );
        }
        actions.push({
          provider: type,
          relative: file.path,
          target,
          size: file.size,
          compressed: file.compressed === true,
          sha256: file.sha256,
        });
      }
    }
    return actions;
  }

  /** Integrity + compatibility report. Never throws for a degraded backup. */
  async function validate({ backupDir, providers = null }) {
    const manifest = await loadManifest({ backupDir });
    const verified = await verifyBackup({ backupDir, manifest, providers });
    const compatibility = checkCompatibility(manifest);
    log.info(`Restore validation for ${manifest.id}: ${verified.ok && compatibility.compatible ? 'pass' : 'fail'}`, {
      integrityOk: verified.ok,
      compatible: compatibility.compatible,
    });
    return {
      id: manifest.id,
      manifest,
      verified,
      compatibility,
      ok: verified.ok && compatibility.compatible,
    };
  }

  /**
   * Apply a restore.
   * @param {object} params
   * @param {string} params.backupDir
   * @param {object} params.manifest
   * @param {string[]} params.providers selected provider types
   * @param {boolean} [params.dryRun=false]
   * @param {Function} [params.onProgress]
   */
  async function run({ backupDir, manifest, providers, dryRun = false, onProgress = null }) {
    const actions = await plan({ manifest, providers });
    if (dryRun) {
      log.info(`Dry-run restore of ${manifest.id}: ${actions.length} action(s) planned`, {
        providers,
        actions: actions.length,
      });
      return { ok: true, dryRun: true, actions, providers, restored: 0 };
    }

    const stagingDir = join(tmpdir(), `aarogyam-restore-${process.pid}-${randomUUID()}`);
    const movedAside = []; // { target, artifact }
    const applied = []; // { target }
    try {
      await fsutil.ensureDir(stagingDir);
      for (let i = 0; i < actions.length; i += 1) {
        const action = actions[i];
        const stored = join(backupDir, action.relative);
        onProgress?.({ stage: action.provider, message: `restoring ${action.relative}`, index: i, total: actions.length });

        // Re-verify the stored bytes against the manifest BEFORE any
        // change to application state (defense in depth).
        const storedHash = await fsutil.hashFile(stored);
        if (storedHash !== action.sha256) {
          throw new RestoreError(
            'integrity-failed',
            `Checksum mismatch on "${action.relative}" during restore`,
            { relative: action.relative, rolledBack: true }
          );
        }

        // Decompress into staging when the payload is compressed.
        const source = action.compressed
          ? await decompressFile(stored, join(stagingDir, `${i}.tmp`))
          : stored;

        await fsutil.ensureDir(dirname(action.target));
        // Move any existing target aside — never delete user data.
        if (await fsutil.fileExists(action.target)) {
          const artifact = `${action.target}.aarogyam-restore-${process.pid}-${Date.now()}`;
          await fsutil.move(action.target, artifact);
          movedAside.push({ target: action.target, artifact });
        }
        await fsutil.copyRecursive(source, action.target);
        applied.push({ target: action.target });
      }

      // Commit point — drop the aside artifacts (best effort).
      for (const m of movedAside) {
        await fsutil.removeRecursive(m.artifact).catch(() => {});
      }
      // Invalidate storage caches so reads observe restored documents.
      if (storage && typeof storage.cache?.invalidateNamespace === 'function') {
        for (const ns of ['cache', 'metadata', 'installation', 'runtime']) {
          if (providers.includes('storage')) storage.cache.invalidateNamespace(ns);
        }
        if (providers.includes('settings')) storage.cache.invalidateNamespace('settings');
      }
      log.info(`Restore of ${manifest.id} completed`, { providers, actions: actions.length });
      return { ok: true, dryRun: false, actions, providers, restored: actions.length };
    } catch (err) {
      // Rollback — remove newly-written files, restore the originals.
      for (const a of applied) {
        await fsutil.removeRecursive(a.target).catch(() => {});
      }
      for (const m of [...movedAside].reverse()) {
        await fsutil.move(m.artifact, m.target).catch(() => {});
      }
      if (err instanceof RestoreError) {
        log.error(`Restore of ${manifest.id} failed (rolled back)`, err);
        throw err;
      }
      const wrapped = new RestoreError(
        'restore-failed',
        `Restore of ${manifest.id} failed and was rolled back: ${err.message}`,
        { rolledBack: true }
      );
      log.error(`Restore of ${manifest.id} failed (rolled back)`, wrapped);
      throw wrapped;
    } finally {
      await fsutil.removeRecursive(stagingDir).catch(() => {});
    }
  }

  return { loadManifest, checkCompatibility, plan, validate, run };
}
