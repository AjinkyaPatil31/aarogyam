/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Local Installer  (Milestone 3.3)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Production-grade first-run installation: detect first launch,
 *    create every runtime directory, write persistent installation
 *    metadata, validate permissions and report structured diagnostics.
 *
 *  HARD GUARANTEES
 *    • IDEMPOTENT — running install() repeatedly never corrupts or
 *      rewrites an already-current installation (metadata stays
 *      byte-identical when version & schema are unchanged).
 *    • TRANSACTIONAL — directories are created first (idempotent),
 *      metadata is built fully in memory and written LAST via an
 *      atomic write. A failure at any point leaves no partial
 *      installation and never clobbers an existing metadata file.
 *    • NO AUTO-RUN — importing this module performs no filesystem
 *      writes. Directory creation happens ONLY when install() (or
 *      the bootstrap manager) is explicitly called.
 *
 *  Requirement 2 (M3.3): all directory creation now lives HERE. No
 *  other infrastructure module may create the canonical directories.
 *
 *  Future purpose:
 *    The installer milestone (GUI / unattended) reuses this module —
 *    only app/lib/local/paths.mjs needs to be redirected for a
 *    user-chosen installation directory.
 *
 *  Dependencies:
 *    node:crypto, node:path, app/lib/config (app.name via get()),
 *    app/lib/local/paths (path resolution), app/lib/local/fsutil
 *    (fs primitives), app/lib/system (platform/arch),
 *    app/lib/logging (structured logs — no console.log).
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { get } from '../config/index.mjs';
import { paths, resolveDataPath, resolvePath } from '../local/paths.mjs';
import * as fsutil from '../local/fsutil.mjs';
import { getArch, getPlatform } from '../system/index.mjs';
import { createLogger } from '../logging/index.mjs';

/** Version of the installation-metadata shape (independent of app version). */
export const METADATA_SCHEMA_VERSION = '1';

/** File name of the installation metadata document. */
export const METADATA_FILE_NAME = 'installation.json';

/** Fields every metadata document must carry. */
export const METADATA_REQUIRED_FIELDS = Object.freeze([
  'installationId',
  'createdAt',
  'updatedAt',
  'appVersion',
  'schemaVersion',
  'platform',
  'architecture',
]);

/**
 * The canonical set of directories the Local Edition needs.
 * Derived from the path manager — this list is the only place that
 * knows which directories constitute an installation.
 */
export function defaultRequiredDirectories() {
  return [
    paths.dataDir,
    paths.logsDir,
    paths.backupsDir,
    paths.databaseDir,
    paths.exportDir,
    paths.tempDir,
  ];
}

/** App version — single source is package.json (not duplicated in config). */
async function readAppVersion() {
  const pkg = await fsutil.readJson(resolvePath('package.json'), null);
  return pkg && typeof pkg.version === 'string' && pkg.version ? pkg.version : '0.0.0';
}

/**
 * Create an installer.
 * @param {object} [options]
 * @param {string[]} [options.directories] required dirs (default: from paths)
 * @param {string}   [options.metadataFile] metadata path (default: under dataDir)
 */
export function createInstaller(options = {}) {
  const requiredDirectories = options.directories ?? defaultRequiredDirectories();
  const metadataFile =
    options.metadataFile ?? resolveDataPath('installation', METADATA_FILE_NAME);
  const log = createLogger('installer');
  let cachedVersion = null;

  const installer = {
    metadataFile,
    requiredDirectories: [...requiredDirectories],

    /**
     * Current application version. Cached after the first read — version
     * changes are only expected across process restarts (startup-time
     * detection), so a per-process cache is intentional.
     */
    async appVersion() {
      if (!cachedVersion) cachedVersion = await readAppVersion();
      return cachedVersion;
    },

    /** True when a metadata document already exists. */
    async isInstalled() {
      return fsutil.fileExists(metadataFile);
    },

    /** True when no metadata document exists yet. */
    async detectFirstLaunch() {
      return !(await installer.isInstalled());
    },

    /** Read current metadata (null when missing or corrupt). */
    async readMetadata() {
      return fsutil.readJson(metadataFile, null);
    },

    /** Create every required directory (recursive, idempotent). */
    async createRequiredDirectories() {
      for (const dir of requiredDirectories) {
        await fsutil.ensureDir(dir);
        log.debug(`Ensured directory ${dir}`);
      }
      return [...requiredDirectories];
    },

    /** Probe every required directory for existence + writability. */
    async validatePermissions() {
      const results = [];
      for (const dir of requiredDirectories) {
        results.push({ dir, ...(await fsutil.verifyDirectory(dir, { writable: true })) });
      }
      return { ok: results.every((r) => r.exists && r.isDirectory && r.writable), results };
    },

    /**
     * Build a metadata document from optional previous metadata.
     * Preserves installationId/createdAt across reinstalls; appends an
     * upgrade record when the application version changed.
     */
    async buildMetadata(previous = null, version = null) {
      const now = new Date().toISOString();
      const appVersion = version ?? (await installer.appVersion());
      const upgrades = Array.isArray(previous?.upgrades) ? [...previous.upgrades] : [];
      const isUpgrade =
        previous && previous.appVersion && previous.appVersion !== appVersion;
      if (isUpgrade) upgrades.push({ from: previous.appVersion, to: appVersion, at: now });
      return {
        schemaVersion: METADATA_SCHEMA_VERSION,
        installationId: previous?.installationId ?? randomUUID(),
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        appName: get('app.name', 'Aarogyam'),
        appVersion,
        previousVersion: isUpgrade ? previous.appVersion : (previous?.previousVersion ?? null),
        platform: getPlatform(),
        architecture: getArch(),
        upgrades,
      };
    },

    /**
     * Run the installation. Idempotent + transactional:
     *   1. create required directories (idempotent, safe to repeat)
     *   2. build metadata fully in memory
     *   3. atomic write (temp file + rename — never half-written)
     *   4. permission validation
     * When an installation is already current, it is left untouched
     * (returns `unchanged: true`).
     */
    async install() {
      const firstLaunch = await installer.detectFirstLaunch();
      const previous = await fsutil.readJson(metadataFile, null);
      const version = await installer.appVersion();

      // Idempotency short-circuit — a current installation is never
      // rewritten, guaranteeing byte-identical metadata across runs.
      if (
        previous &&
        previous.appVersion === version &&
        previous.schemaVersion === METADATA_SCHEMA_VERSION &&
        previous.installationId &&
        Array.isArray(previous.upgrades)
      ) {
        await installer.createRequiredDirectories();
        const permissions = await installer.validatePermissions();
        log.info('Installation already current — no changes made', { firstLaunch: false });
        return { firstLaunch: false, installed: true, metadata: previous, permissions, unchanged: true };
      }

      if (previous && previous.appVersion && previous.appVersion !== version) {
        log.info('Application version change detected during install', {
          from: previous.appVersion,
          to: version,
        });
      }

      // Phase 1 — directories (idempotent).
      await installer.createRequiredDirectories();

      // Phase 2 — metadata, written LAST and atomically.
      const metadata = await installer.buildMetadata(previous, version);
      await fsutil.writeJson(metadataFile, metadata);

      // Phase 3 — post-write permission validation (diagnostic only).
      const permissions = await installer.validatePermissions();
      if (!permissions.ok) {
        log.warn('Permission check found non-writable directories', {
          dirs: permissions.results.filter((r) => !r.writable).map((r) => r.dir),
        });
      }

      log.info('Installation complete', { firstLaunch, metadataFile });
      return { firstLaunch, installed: true, metadata, permissions, unchanged: false };
    },

    /**
     * Detect an application version change. NO migrations — this is
     * detection only; the upgrade milestone applies migrations.
     */
    async checkUpgrade() {
      const previous = await fsutil.readJson(metadataFile, null);
      const version = await installer.appVersion();
      if (!previous) {
        return { upgraded: false, previousVersion: null, currentVersion: version, reason: 'not-installed' };
      }
      if (previous.appVersion === version) {
        return { upgraded: false, previousVersion: version, currentVersion: version };
      }
      return { upgraded: true, previousVersion: previous.appVersion, currentVersion: version };
    },

    /**
     * Structured integrity diagnostics. Returns `{ ok, checks[] }` where
     * each check is `{ name, ok, detail }`. Never throws for a degraded
     * installation — it reports.
     */
    async verifyInstallation() {
      const checks = [];

      // 1. required directories exist
      const dirResults = [];
      for (const dir of requiredDirectories) {
        dirResults.push({ dir, ok: await fsutil.dirExists(dir) });
      }
      const missing = dirResults.filter((r) => !r.ok);
      checks.push({
        name: 'required-directories',
        ok: missing.length === 0,
        detail: missing.length === 0 ? `${dirResults.length} present` : `missing: ${missing.map((m) => m.dir).join(', ')}`,
      });

      // 2. metadata present
      const metaPresent = await installer.isInstalled();
      checks.push({
        name: 'metadata-present',
        ok: metaPresent,
        detail: metaPresent ? metadataFile : 'missing',
      });

      // 3. metadata valid (all required fields + version consistency)
      let metaValid = false;
      let metaDetail = 'no metadata';
      if (metaPresent) {
        const meta = await fsutil.readJson(metadataFile, null);
        const version = await installer.appVersion();
        const absent = METADATA_REQUIRED_FIELDS.filter(
          (f) => meta?.[f] === undefined || meta[f] === null || meta[f] === ''
        );
        const staleVersion = Boolean(meta?.appVersion) && meta.appVersion !== version;
        metaValid = Boolean(meta) && absent.length === 0 && !staleVersion;
        metaDetail = !meta
          ? 'invalid JSON'
          : absent.length > 0
            ? `missing fields: ${absent.join(', ')}`
            : staleVersion
              ? `version mismatch: metadata=${meta.appVersion}, current=${version}`
              : 'all required fields present';
      }
      checks.push({ name: 'metadata-valid', ok: metaValid, detail: metaDetail });

      // 4. permissions
      const perms = await installer.validatePermissions();
      checks.push({
        name: 'permissions',
        ok: perms.ok,
        detail: perms.ok ? 'all directories writable' : perms.results.filter((r) => !r.writable).map((r) => r.dir).join(', '),
      });

      // 5. configuration consistency
      const appName = get('app.name', '');
      const configOk = typeof appName === 'string' && appName.length > 0;
      checks.push({
        name: 'config-consistent',
        ok: configOk,
        detail: configOk ? `app.name="${appName}"` : 'app.name is empty',
      });

      return { ok: checks.every((c) => c.ok), checks };
    },

    /** Comprehensive status: installed?, metadata, version, diagnostics. */
    async getInstallationStatus() {
      const metadata = await fsutil.readJson(metadataFile, null);
      const verified = await installer.verifyInstallation();
      return {
        installed: await installer.isInstalled(),
        firstLaunch: !(await installer.isInstalled()),
        metadata,
        version: await installer.appVersion(),
        verified,
      };
    },
  };

  return installer;
}

/** Shared default installer rooted at the real runtime paths. */
export const installer = createInstaller();
