/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Aarogyam — WhatsApp Runtime Consumer  (M1.6 Phase C, W-04)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Activates the EXISTING webjs queue consumer inside the application
 *  process. The provider (app/lib/whatsappProvider.js) enqueues messages to
 *  wa-queue.json under lock; previously ONLY the standalone
 *  scripts/wa-init.mjs drained that queue (a separate manual process). This
 *  module starts the SAME consumer as part of normal server startup:
 *
 *    • webjs provider + paired LocalAuth session → the client starts and
 *      the queue is polled/delivered with the exact wa-init semantics
 *    • webjs provider + no paired session       → no-op (the operator
 *      pairs once via `npm run whatsapp`; nothing can be delivered
 *      unpaired, so no Chrome is launched pointlessly)
 *    • twilio provider                           → no-op (twilio bypasses
 *      the queue by design)
 *
 *  Safety properties:
 *    • Idempotent — the shared singleton never creates a second client,
 *      poll timer or consumer; repeated start() is a no-op once started.
 *    • Failure-safe — client initialization failures are logged through
 *      the logging framework (never credentials/session material) and
 *      never crash the application; the persisted queue is left intact.
 *    • Graceful stop() — clears the poll timer and destroys the client
 *      without forcing process termination (unref'd timers).
 *    • Queue semantics preserved exactly: lock-based phases, the
 *      `processing` flag (also what makes a concurrent manual wa-init run
 *      safe), waQueue.js retry/limits, per-message ordering.
 *    • NODE-RUNTIME-ONLY — imports whatsapp-web.js; never import this
 *      module from code compiled for the Edge runtime. In Next.js it is
 *      reached only through the webpackIgnore'd runtime import in
 *      instrumentation.js.
 *
 *  Dependencies: node:fs, node:path, whatsapp-web.js, app/lib/waQueue.js,
 *    app/lib/config, app/lib/logging. No cycles.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pkg from 'whatsapp-web.js';
import { acquireLock, releaseLock, readQueue, writeQueue } from './waQueue.js';
import { config } from './config/index.mjs';
import { createLogger } from './logging/index.mjs';

const { Client, LocalAuth } = pkg;

/** LocalAuth clientId — must match scripts/wa-init.mjs (same session). */
export const WHATSAPP_CLIENT_ID = 'aarogyam';

/** Default poll cadence (wa-init used 5000ms). */
const DEFAULT_POLL_INTERVAL_MS = 5000;

/** Reconnect delay after a disconnect (wa-init used 5000ms). */
const RECONNECT_DELAY_MS = 5000;

/**
 * True when a paired LocalAuth session exists under baseDir. whatsapp-web.js
 * LocalAuth stores its session at `<baseDir>/.wwebjs_auth/session-<clientId>/`;
 * a non-empty session directory means a pairing has been completed (or at
 * least attempted) — only then is it meaningful to launch the client.
 */
export async function hasWhatsAppSession(baseDir = process.cwd()) {
  try {
    const authDir = join(baseDir, '.wwebjs_auth');
    if (!existsSync(authDir)) return false;
    const entries = readdirSync(authDir, { withFileTypes: true });
    return entries.some((entry) => {
      if (!entry.isDirectory()) return false;
      if (!entry.name.includes('session')) return false;
      try {
        return readdirSync(join(authDir, entry.name)).length > 0;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

/**
 * The queue consumer — a faithful port of scripts/wa-init.mjs pollQueue():
 *   Phase 1  acquire lock → read → mark `processing` → write → release
 *   Phase 2  lock-free delivery: 10-digit phone → 91<phone>@c.us,
 *            isRegisteredUser gate, sendMessage (no message-body logging)
 *   Phase 3  acquire lock → merge statuses by id → write → release
 * Message ordering, retry/limits and locking all live in waQueue.js and are
 * untouched. The timer is unref'd so it never keeps a server process alive.
 *
 * @param {object} opts
 * @param {object} opts.client      whatsapp-web.js Client (or test fake)
 * @param {string} opts.baseDir     directory holding wa-queue.json
 * @param {number} [opts.pollIntervalMs=5000]
 * @param {object} [opts.log]       logger (default: 'whatsapp:consumer')
 */
export function createQueueConsumer({ client, baseDir, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, log = null }) {
  const logger = log ?? createLogger('whatsapp:consumer');
  let timer = null;

  async function pollOnce() {
    // ── Phase 1: lock → read → mark processing → write → release ──
    let pending;
    try {
      await acquireLock(baseDir);
      try {
        const queue = readQueue(baseDir);
        pending = queue.filter((m) => !m.sent && !m.processing);
        if (pending.length === 0) return;
        pending.forEach((m) => {
          m.processing = true;
        });
        writeQueue(baseDir, queue);
      } finally {
        await releaseLock(baseDir);
      }
    } catch (err) {
      logger.warn('Queue lock error (phase 1) — retrying on next poll', err);
      return;
    }

    // ── Phase 2: send (lock-free, may take seconds) ────────────────
    for (const msg of pending) {
      try {
        let phone = String(msg.phone).replace(/[^0-9]/g, '');
        if (phone.length === 10) phone = '91' + phone;
        const chatId = `${phone}@c.us`;
        logger.info('Delivering queued WhatsApp message', { chatId });

        const isRegistered = await client.isRegisteredUser(chatId);
        if (!isRegistered) {
          logger.warn('Recipient is not on WhatsApp', { chatId });
          msg.sent = true;
          msg.failed = true;
          msg.error = 'Not registered on WhatsApp';
          continue;
        }

        await client.sendMessage(chatId, msg.message);
        msg.sent = true;
        msg.processing = false;
        logger.info('Queued WhatsApp message delivered', { chatId });
      } catch (err) {
        logger.warn('Failed to deliver queued WhatsApp message', err);
        msg.sent = true;
        msg.failed = true;
        msg.processing = false;
        msg.error = err.message;
      }
    }

    // ── Phase 3: lock → read → merge statuses → write → release ────
    try {
      await acquireLock(baseDir);
      try {
        const queue = readQueue(baseDir);
        for (const sentMsg of pending) {
          const idx = queue.findIndex((m) => m.id === sentMsg.id);
          if (idx !== -1) {
            queue[idx].sent = sentMsg.sent;
            queue[idx].processing = sentMsg.processing;
            queue[idx].failed = sentMsg.failed;
            queue[idx].error = sentMsg.error;
          }
        }
        writeQueue(baseDir, queue);
      } finally {
        await releaseLock(baseDir);
      }
    } catch (err) {
      logger.warn('Queue lock error (phase 3) — statuses merged on next poll', err);
    }
  }

  return {
    isRunning: () => timer !== null,
    start() {
      if (timer) return this;
      timer = setInterval(() => {
        void pollOnce();
      }, pollIntervalMs);
      if (typeof timer.unref === 'function') timer.unref();
      return this;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      return this;
    },
    /** Exposed for deterministic tests. */
    pollOnce,
  };
}

/**
 * Create an isolated WhatsApp runtime manager (dependency-injectable for
 * tests). The singleton helpers at the bottom wrap one shared instance.
 *
 * @param {object} [options]
 * @param {string} [options.provider='config.whatsapp.provider']
 * @param {string} [options.baseDir=process.cwd()]  queue/session root
 * @param {number} [options.pollIntervalMs=5000]
 * @param {Function} [options.clientFactory]        DI: returns a client
 * @param {Function} [options.sessionCheck]         DI: async () => boolean
 * @param {object} [options.log]
 */
export function createWhatsAppRuntime(options = {}) {
  const provider = options.provider ?? config.whatsapp.provider;
  const baseDir = options.baseDir ?? process.cwd();
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const clientFactory = options.clientFactory ?? null;
  const sessionCheck = options.sessionCheck ?? hasWhatsAppSession;
  const log = options.log ?? createLogger('whatsapp:runtime');

  let state = { phase: 'uninitialized', startedAt: null, reason: null, lastError: null };
  let client = null;
  let consumer = null;
  let factoryCalls = 0;
  let restarting = false;

  /** Public snapshot — always includes the provider for callers/tests. */
  const getSnapshot = () => ({ ...state, provider });

  function createDefaultClient() {
    return new Client({
      authStrategy: new LocalAuth({ clientId: WHATSAPP_CLIENT_ID }),
      puppeteer: {
        executablePath: config.whatsapp.puppeteer.executablePath,
        headless: config.whatsapp.puppeteer.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
        ],
      },
    });
  }

  function attachClientEvents() {
    client.on('ready', () => {
      state = { ...state, phase: 'ready', lastError: null };
      consumer = createQueueConsumer({ client, baseDir, pollIntervalMs, log });
      consumer.start();
      log.info('WhatsApp runtime ready — consuming queue', { pollIntervalMs });
    });
    client.on('qr', () => {
      // Never print the QR/session material to the server console — the
      // pairing tool (scripts/wa-init.mjs) owns QR display. A QR here means
      // the stored session expired.
      log.warn('WhatsApp QR requested — session expired; re-pair with `npm run whatsapp`');
    });
    client.on('auth_failure', () => {
      log.warn('WhatsApp authentication failed — session may be invalid; re-pair with `npm run whatsapp`');
    });
    client.on('disconnected', (reason) => {
      consumer?.stop();
      state = { ...state, phase: 'disconnected' };
      log.warn('WhatsApp client disconnected — re-initializing', {
        reason: String(reason).slice(0, 200),
      });
      if (restarting) return;
      restarting = true;
      setTimeout(async () => {
        try {
          if (!client) return;
          await client.initialize();
          restarting = false;
        } catch (err) {
          restarting = false;
          log.error('WhatsApp re-initialization failed', err);
          state = {
            ...state,
            phase: 'failed',
            lastError: { name: err?.name ?? 'Error', code: err?.code ?? null },
          };
        }
      }, RECONNECT_DELAY_MS).unref?.();
    });
  }

  function cleanupClient() {
    consumer?.stop();
    consumer = null;
    client = null;
  }

  return {
    /** Number of client instances created (idempotency evidence). */
    get factoryCalls() {
      return factoryCalls;
    },
    getState: getSnapshot,

    /**
     * Start the consumer. Idempotent: a started/ready/stopped runtime is
     * left untouched; a failed runtime may retry. Never throws — failures
     * are recorded in state and logged.
     */
    async start() {
      if (state.phase === 'starting' || state.phase === 'ready' || state.phase === 'stopped') {
        return getSnapshot();
      }

      if (provider !== 'webjs') {
        state = { phase: 'stopped', startedAt: null, reason: 'provider-not-webjs', lastError: null };
        log.info('WhatsApp runtime not started (provider is not webjs)', { provider });
        return getSnapshot();
      }

      if (!(await sessionCheck(baseDir))) {
        state = { phase: 'stopped', startedAt: null, reason: 'no-session', lastError: null };
        log.info('No WhatsApp session found — runtime consumer skipped (pair once with `npm run whatsapp`)');
        return getSnapshot();
      }

      state = { phase: 'starting', startedAt: new Date().toISOString(), reason: null, lastError: null };
      try {
        client = clientFactory ? clientFactory() : createDefaultClient();
        factoryCalls += 1;
        attachClientEvents();
        client
          .initialize()
          .catch((err) => {
            // Fail-safe: a client that cannot start must never crash the
            // application. The persisted queue stays intact for the next
            // run. Only safe error facts (name/code) enter state.
            log.error('WhatsApp client initialization failed — queue remains persisted', err);
            state = {
              ...state,
              phase: 'failed',
              reason: 'initialize-failed',
              lastError: { name: err?.name ?? 'Error', code: err?.code ?? null },
            };
            cleanupClient();
          });
        return getSnapshot();
      } catch (err) {
        log.error('WhatsApp runtime start failed', err);
        state = {
          ...state,
          phase: 'failed',
          reason: 'start-failed',
          lastError: { name: err?.name ?? 'Error', code: err?.code ?? null },
        };
        cleanupClient();
        return getSnapshot();
      }
    },

    /**
     * Graceful stop: clear the poll timer and destroy the client. Safe and
     * idempotent from any phase; never forces process termination.
     */
    async stop() {
      if (state.phase === 'stopped') return getSnapshot();
      consumer?.stop();
      consumer = null;
      if (client && typeof client.destroy === 'function') {
        try {
          await client.destroy();
        } catch (err) {
          log.warn('WhatsApp client destroy failed', err);
        }
      }
      client = null;
      state = { phase: 'stopped', startedAt: state.startedAt, reason: 'stopped', lastError: null };
      log.info('WhatsApp runtime stopped');
      return getSnapshot();
    },
  };
}

// ── Shared singleton (used by instrumentation at server startup) ──────────
let sharedRuntime = null;

/** Start the shared runtime consumer (idempotent, failure-safe). */
export function startWhatsAppRuntime(options = {}) {
  if (!sharedRuntime) sharedRuntime = createWhatsAppRuntime(options);
  return sharedRuntime.start();
}

/** Graceful stop of the shared runtime consumer (idempotent). */
export function stopWhatsAppRuntime() {
  return sharedRuntime ? sharedRuntime.stop() : Promise.resolve(null);
}

/** Status snapshot of the shared runtime consumer. */
export function getWhatsAppRuntimeState() {
  return sharedRuntime ? sharedRuntime.getState() : { phase: 'uninitialized', provider: null };
}
