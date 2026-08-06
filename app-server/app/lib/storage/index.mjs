/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Local Storage Abstraction  (Milestone 3.2)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    A storage service able to manage future settings, cache, metadata,
 *    installation state and backups as namespaced JSON documents under
 *    the data directory. The current application is NOT affected.
 *
 *  Namespaces (top-level folders under the data dir):
 *    settings, cache, metadata, installation, backups
 *
 *  Future purpose:
 *    Offline mode (cached records), settings UI, installer state and
 *    backup manifests will all persist through this service instead of
 *    scattering JSON file handling through the codebase.
 *
 *  Dependencies: node:path, app/lib/local/paths, app/lib/local/fsutil.
 *
 *  IMPORTANT: constructing the service performs NO filesystem writes.
 *  Directories and files are created only when set() is called.
 */

import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { paths } from '../local/paths.mjs';
import {
  atomicWriteFile,
  dirExists,
  ensureDir,
  fileExists,
  readJson,
  removeRecursive,
} from '../local/fsutil.mjs';

/** Known namespaces. */
export const NAMESPACES = Object.freeze([
  'settings',
  'cache',
  'metadata',
  'installation',
  'backups',
]);

function safeKey(key) {
  // Keys become file names — strip anything path-hostile.
  return String(key).replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Create a storage service rooted at a data directory.
 * @param {string} [rootDir=paths.dataDir]
 */
export function createStorageService(rootDir = paths.dataDir) {
  const namespaceDir = (ns) => join(rootDir, ns);

  const service = {
    rootDir,
    namespaces: [...NAMESPACES],

    /** True when the root data directory exists. */
    async exists() {
      return dirExists(rootDir);
    },

    /**
     * Path of a namespaced document (does not create it).
     * NOTE: documents are FILES (`<safeKey>.json`) inside a namespace
     * folder — the namespace is a directory, each key is a file.
     */
    pathFor(ns, key) {
      return join(namespaceDir(ns), `${safeKey(key)}.json`);
    },

    /** Read a document; returns `fallback` when missing/invalid. */
    async get(ns, key, fallback = null) {
      return readJson(service.pathFor(ns, key), fallback);
    },

    /** Write (atomically) a namespaced document. */
    async set(ns, key, value) {
      const dir = namespaceDir(ns);
      await ensureDir(dir);
      await atomicWriteFile(service.pathFor(ns, key), JSON.stringify(value, null, 2));
      return value;
    },

    /** True when the document exists. */
    async has(ns, key) {
      return fileExists(service.pathFor(ns, key));
    },

    /** Delete a document (missing documents are fine). */
    async remove(ns, key) {
      await removeRecursive(service.pathFor(ns, key));
    },

    /** List document keys inside a namespace (files ending in .json). */
    async listKeys(ns) {
      try {
        const entries = await readdir(namespaceDir(ns), { withFileTypes: true });
        return entries
          .filter((e) => e.isFile() && e.name.endsWith('.json'))
          .map((e) => e.name.replace(/\.json$/, ''));
      } catch {
        return [];
      }
    },

    /** Remove an entire namespace folder. */
    async removeNamespace(ns) {
      await removeRecursive(namespaceDir(ns));
    },
  };

  return service;
}

/** Shared default instance rooted at the configured data directory. */
export const storage = createStorageService(paths.dataDir);
