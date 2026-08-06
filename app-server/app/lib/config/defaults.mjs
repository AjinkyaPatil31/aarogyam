/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Central Configuration Defaults  (Milestone 3.1)
 * ─────────────────────────────────────────────────────────────────────
 *  Single source of truth for every default value consumed by the
 *  configuration system. Values are overridden at runtime by
 *  environment variables declared in `schema.mjs`.
 *
 *  Rule: never hardcode these values in application code — read them
 *  from `config` (see index.mjs). To change a default, edit it HERE.
 */

export const DEFAULTS = Object.freeze({
  // ── Application identity ──────────────────────────────────────────
  app: {
    name: 'Aarogyam',
    // Default public base URL. Overridden by NEXT_PUBLIC_APP_URL.
    url: 'http://localhost:3000',
  },

  // ── HTTP server ───────────────────────────────────────────────────
  // Future milestone (installer / service manager): becomes the bind
  // host/port. Today Next.js still owns the listener.
  server: {
    host: '0.0.0.0',
    port: 3000,
  },

  // ── Session & authentication ──────────────────────────────────────
  session: {
    // JWT lifetime (minutes) and cookie maxAge (seconds = value * 60).
    idleTimeoutMinutes: 60,
    // Sliding-session refresh threshold (minutes remaining before re-issue).
    refreshThresholdMinutes: 15,
    // Allowed clock skew for JWT verification (seconds).
    clockSkewSeconds: 30,
    // Name of the auth cookie — shared by server & client code.
    cookieName: 'aarogyam_token',
    // Cookie attributes for login / register / logout.
    cookie: { httpOnly: true, sameSite: 'lax', path: '/' },
    // Cookie attributes for the sliding refresh issued by middleware
    // (kept separate because the current behavior uses `strict` here).
    refreshCookie: { httpOnly: true, sameSite: 'strict', path: '/' },
  },

  jwt: {
    // REQUIRED at runtime via JWT_SECRET. Validation enforces presence;
    // an empty value makes getSecret() throw (preserves legacy behavior).
    secret: '',
  },

  // ── WhatsApp ──────────────────────────────────────────────────────
  whatsapp: {
    // 'webjs' (local WhatsApp Web client) | 'twilio' (Twilio API).
    provider: 'webjs',
    queue: {
      maxSize: 500, // ACTIVE — used by whatsappProvider.js
      // Future — currently hardcoded as constants inside waQueue.js:
      lockTimeoutMs: 5000,
      retryDelayMs: 100,
      maxRetries: 20,
    },
    twilio: {
      // Fixed Twilio REST endpoint (base only; accountSid is appended).
      apiBase: 'https://api.twilio.com/2010-04-01/Accounts/',
      accountSid: '',
      authToken: '',
      fromNumber: '',
    },
    puppeteer: {
      // Local WhatsApp client's Chrome binary (Windows default).
      executablePath:
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
    },
  },

  // ── Storage engine (Milestone 4.1) ────────────────────────────────
  // In-memory read/write-through cache for the document storage engine.
  // Enabled by default for the shared instance; disable via
  // STORAGE_CACHE_ENABLED=false. Cache is write-through (crash-safe).
  storage: {
    cache: {
      enabled: true,
      maxEntries: 100,
    },
  },

  // ── Future milestones — STRUCTURE ONLY, NOT CONSUMED YET ──────────
  // Later milestones (LAN discovery, offline mode, installer, service
  // manager, logging, backup) will wire these up without touching the
  // configuration architecture. Do not read these from application code.
  future: {
    apiBaseUrl: '', // absolute API base for LAN clients
    lanMode: {
      enabled: false,
    },
    lanDiscovery: {
      enabled: false,
      multicastAddress: '239.255.255.250',
      port: 4567,
    },
    offlineMode: {
      enabled: false,
    },
    backup: {
      enabled: false,
    },
    sync: {
      enabled: false,
      intervalSeconds: 300,
    },
    paths: {
      installation: '', // installer milestone
      database: '',     // database-location milestone (default: prisma/sqlite.db)
      backup: '',       // backup milestone
      logs: '',         // logging milestone
    },
    logging: {
      level: 'info',
      toFile: false,
    },
  },
});
