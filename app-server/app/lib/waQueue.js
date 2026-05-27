import { readFileSync, writeFileSync, existsSync, promises as fs } from 'fs';
import { join } from 'path';

const LOCK_FILENAME = 'wa-queue.lock';
const QUEUE_FILENAME = 'wa-queue.json';

const MAX_RETRIES = 20;
const RETRY_DELAY = 100; // ms
const LOCK_TIMEOUT_MS = 5000; // 5-second maximum lease safety lifespan

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns the full path to the lock file within the given directory.
 */
export function lockFilePath(baseDir) {
  return join(baseDir, LOCK_FILENAME);
}

/**
 * Returns the full path to the queue file within the given directory.
 */
export function queueFilePath(baseDir) {
  return join(baseDir, QUEUE_FILENAME);
}

/**
 * Acquires the lockfile with stale-lock detection.  Reads the timestamp
 * payload inside the lock file and, if it is older than LOCK_TIMEOUT_MS,
 * automatically breaks the dead lease before attempting a new write.
 * Retries up to MAX_RETRIES times with RETRY_DELAY ms between attempts.
 * Throws if the lock could not be acquired.
 */
export async function acquireLock(baseDir) {
  const lockPath = lockFilePath(baseDir);

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      // 1. Attempt to stat the existing lock file
      const lockStat = await fs.stat(lockPath).catch(() => null);

      if (lockStat) {
        // Read the absolute timestamp stored inside the lock file
        const lockContent = await fs.readFile(lockPath, 'utf8').catch(() => '');
        const lockTimestamp = parseInt(lockContent, 10);

        // 2. Check if the active lock has gone stale (older than 5 seconds)
        if (lockTimestamp && Date.now() - lockTimestamp > LOCK_TIMEOUT_MS) {
          console.warn(
            '⚡ Stale file-lock detected. Automatically breaking stale lease...'
          );
          await releaseLock(baseDir); // Break the dead lease safely
        } else {
          // Lock is still fresh and valid; back off and wait
          await delay(RETRY_DELAY);
          continue;
        }
      }

      // 3. Create/write our new fresh timestamp atomic lock descriptor file
      await fs.writeFile(lockPath, Date.now().toString(), { flag: 'wx' });
      return true; // Lock acquired successfully
    } catch (err) {
      // 'EEXIST' means someone grabbed it between our stat and write
      if (err.code === 'EEXIST') {
        await delay(RETRY_DELAY);
        continue;
      }
      throw err;
    }
  }

  throw new Error(
    `Concurrency Error: Failed to acquire write lock for WhatsApp Queue within ${MAX_RETRIES * RETRY_DELAY}ms.`
  );
}

/**
 * Releases the lockfile by deleting `wa-queue.lock`.
 * Always safe to call — failures are silently ignored.
 */
export async function releaseLock(baseDir) {
  const lockPath = lockFilePath(baseDir);
  try {
    await fs.unlink(lockPath);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to cleanly drop lock handle file:', err);
    }
  }
}

/**
 * Reads and parses the queue file.  Returns an empty array if the file
 * does not exist or is malformed.
 */
export function readQueue(baseDir) {
  const qPath = queueFilePath(baseDir);
  if (!existsSync(qPath)) return [];
  try {
    return JSON.parse(readFileSync(qPath, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Writes the queue array to disk as pretty-printed JSON.
 */
export function writeQueue(baseDir, queue) {
  const qPath = queueFilePath(baseDir);
  writeFileSync(qPath, JSON.stringify(queue, null, 2));
}
