/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Configuration Schema Registry  (Milestone 3.1)
 * ─────────────────────────────────────────────────────────────────────
 *  Declarative inventory of every configuration key.
 *
 *  This registry is the single machine-readable source of truth for:
 *    • index.mjs   — builds the runtime `config` object
 *    • validate.mjs — startup validation (Task 5)
 *    • the audit   — Task 1 report (env var classification)
 *
 *  Entry fields:
 *    key        dotted path inside the `config` object
 *    env        environment variable name (null = default only)
 *    defaultKey dotted path into DEFAULTS (defaults.mjs)
 *    required   true = startup fails if unset
 *    type       'string' | 'number' | 'boolean' | 'url' | 'enum'
 *    options    allowed values for type 'enum'
 *    category   logical grouping
 *    status     'required' | 'optional' | 'future'
 *               (legacy/dead vars are listed in LEGACY below)
 *    description purpose + consuming module
 */

export const SCHEMA = [
  // ── Application ────────────────────────────────────────────────────
  {
    key: 'app.name',
    env: null,
    defaultKey: 'app.name',
    required: false,
    type: 'string',
    category: 'application',
    status: 'required',
    description: 'Display name of the application.',
  },
  {
    key: 'app.url',
    env: 'NEXT_PUBLIC_APP_URL',
    defaultKey: 'app.url',
    required: false,
    type: 'url',
    category: 'application',
    status: 'required',
    description: 'Public base URL of the app — used in WhatsApp welcome messages (app/api/patients).',
  },

  // ── HTTP server (future) ───────────────────────────────────────────
  {
    key: 'server.host',
    env: 'SERVER_HOST',
    defaultKey: 'server.host',
    required: false,
    type: 'string',
    category: 'server',
    status: 'future',
    description: 'Bind host for the HTTP server (LAN milestone).',
  },
  {
    key: 'server.port',
    env: 'SERVER_PORT',
    defaultKey: 'server.port',
    required: false,
    type: 'number',
    category: 'server',
    status: 'future',
    description: 'Bind port for the HTTP server (LAN milestone).',
  },

  // ── Session ────────────────────────────────────────────────────────
  {
    key: 'session.idleTimeoutMinutes',
    env: 'SESSION_IDLE_TIMEOUT_MINUTES',
    defaultKey: 'session.idleTimeoutMinutes',
    required: false,
    type: 'number',
    category: 'session',
    status: 'required',
    description: 'JWT lifetime + cookie maxAge. Consumed by app/api/lib/jwt, app/api/auth, middleware.',
  },
  {
    key: 'session.refreshThresholdMinutes',
    env: 'SESSION_REFRESH_THRESHOLD_MINUTES',
    defaultKey: 'session.refreshThresholdMinutes',
    required: false,
    type: 'number',
    category: 'session',
    status: 'required',
    description: 'Sliding-session refresh threshold. Consumed by middleware.',
  },
  {
    key: 'session.clockSkewSeconds',
    env: 'SESSION_CLOCK_SKEW_SECONDS',
    defaultKey: 'session.clockSkewSeconds',
    required: false,
    type: 'number',
    category: 'session',
    status: 'optional',
    description: 'JWT clock-skew tolerance. Consumed by app/api/lib/jwt.',
  },
  {
    key: 'session.cookieName',
    env: 'SESSION_COOKIE_NAME',
    defaultKey: 'session.cookieName',
    required: false,
    type: 'string',
    category: 'session',
    status: 'optional',
    description: 'Auth cookie name. Consumed by middleware, auth routes, app/lib/authHelpers.',
  },
  {
    key: 'session.cookie',
    env: null,
    defaultKey: 'session.cookie',
    required: false,
    type: 'object',
    category: 'session',
    status: 'required',
    description: 'Cookie attributes for login/register/logout (secure is derived from NODE_ENV).',
  },
  {
    key: 'session.refreshCookie',
    env: null,
    defaultKey: 'session.refreshCookie',
    required: false,
    type: 'object',
    category: 'session',
    status: 'required',
    description: 'Cookie attributes for the sliding refresh issued by middleware (secure is derived from NODE_ENV).',
  },

  // ── JWT ────────────────────────────────────────────────────────────
  {
    key: 'jwt.secret',
    env: 'JWT_SECRET',
    defaultKey: 'jwt.secret',
    required: true,
    type: 'string',
    category: 'jwt',
    status: 'required',
    description: 'HMAC secret for signing/verifying tokens. Consumed by app/api/lib/jwt.',
  },

  // ── WhatsApp ───────────────────────────────────────────────────────
  {
    key: 'whatsapp.provider',
    env: 'WA_PROVIDER',
    defaultKey: 'whatsapp.provider',
    required: false,
    type: 'enum',
    options: ['webjs', 'twilio'],
    category: 'whatsapp',
    status: 'required',
    description: 'Delivery provider. Consumed by app/lib/whatsappProvider.',
  },
  {
    key: 'whatsapp.queue.maxSize',
    env: 'WA_QUEUE_MAX_SIZE',
    defaultKey: 'whatsapp.queue.maxSize',
    required: false,
    type: 'number',
    category: 'whatsapp',
    status: 'optional',
    description: 'Max queued messages before eviction. Consumed by app/lib/whatsappProvider.',
  },
  {
    key: 'whatsapp.twilio.apiBase',
    env: null,
    defaultKey: 'whatsapp.twilio.apiBase',
    required: false,
    type: 'string',
    category: 'whatsapp',
    status: 'required',
    description: 'Fixed Twilio REST base URL. Consumed by app/lib/whatsappProvider.',
  },
  {
    key: 'whatsapp.twilio.accountSid',
    env: 'TWILIO_ACCOUNT_SID',
    defaultKey: 'whatsapp.twilio.accountSid',
    required: false,
    type: 'string',
    category: 'whatsapp',
    status: 'optional',
    description: 'Twilio Account SID — required only when WA_PROVIDER=twilio.',
  },
  {
    key: 'whatsapp.twilio.authToken',
    env: 'TWILIO_AUTH_TOKEN',
    defaultKey: 'whatsapp.twilio.authToken',
    required: false,
    type: 'string',
    category: 'whatsapp',
    status: 'optional',
    description: 'Twilio Auth Token — required only when WA_PROVIDER=twilio.',
  },
  {
    key: 'whatsapp.twilio.fromNumber',
    env: 'TWILIO_WHATSAPP_NUMBER',
    defaultKey: 'whatsapp.twilio.fromNumber',
    required: false,
    type: 'string',
    category: 'whatsapp',
    status: 'optional',
    description: 'Twilio WhatsApp sender number — required only when WA_PROVIDER=twilio.',
  },
  {
    key: 'whatsapp.puppeteer.executablePath',
    env: 'PUPPETEER_EXECUTABLE_PATH',
    defaultKey: 'whatsapp.puppeteer.executablePath',
    required: false,
    type: 'string',
    category: 'whatsapp',
    status: 'optional',
    description: 'Chrome binary path for the local WhatsApp client (scripts/wa-init.mjs).',
  },
  {
    key: 'whatsapp.puppeteer.headless',
    env: null,
    defaultKey: 'whatsapp.puppeteer.headless',
    required: false,
    type: 'boolean',
    category: 'whatsapp',
    status: 'required',
    description: 'Headless mode for the local WhatsApp client (scripts/wa-init.mjs).',
  },

  // ── Logging (Milestone 4.2) ───────────────────────────────────────
  {
    key: 'logging.level',
    env: 'LOG_LEVEL',
    defaultKey: 'logging.level',
    required: false,
    type: 'enum',
    options: ['trace', 'debug', 'info', 'warn', 'error', 'fatal'],
    category: 'logging',
    status: 'optional',
    description: 'Minimum log level emitted by app/lib/logging.',
  },
  {
    key: 'logging.console.enabled',
    env: 'LOG_CONSOLE_ENABLED',
    defaultKey: 'logging.console.enabled',
    required: false,
    type: 'boolean',
    category: 'logging',
    status: 'optional',
    description: 'Emit human-readable log lines to the console.',
  },
  {
    key: 'logging.file.enabled',
    env: 'LOG_FILE_ENABLED',
    defaultKey: 'logging.file.enabled',
    required: false,
    type: 'boolean',
    category: 'logging',
    status: 'optional',
    description: 'Persist structured JSONL log entries under the logs directory.',
  },
  {
    key: 'logging.file.maxSize',
    env: 'LOG_FILE_MAX_SIZE',
    defaultKey: 'logging.file.maxSize',
    required: false,
    type: 'number',
    category: 'logging',
    status: 'optional',
    description: 'Rotation threshold (bytes) for the active log file.',
  },
  {
    key: 'logging.file.maxFiles',
    env: 'LOG_FILE_MAX_FILES',
    defaultKey: 'logging.file.maxFiles',
    required: false,
    type: 'number',
    category: 'logging',
    status: 'optional',
    description: 'Maximum retained rotated log files (active + maxFiles - 1).',
  },

  // ── Storage engine (Milestone 4.1) ────────────────────────────────
  {
    key: 'storage.cache.enabled',
    env: 'STORAGE_CACHE_ENABLED',
    defaultKey: 'storage.cache.enabled',
    required: false,
    type: 'boolean',
    category: 'storage',
    status: 'optional',
    description: 'Enable the in-memory read/write-through cache in app/lib/storage.',
  },
  {
    key: 'storage.cache.maxEntries',
    env: 'STORAGE_CACHE_MAX_ENTRIES',
    defaultKey: 'storage.cache.maxEntries',
    required: false,
    type: 'number',
    category: 'storage',
    status: 'optional',
    description: 'Maximum cached documents before LRU eviction in app/lib/storage.',
  },

  // ── Backup framework (Milestone 4.3) ──────────────────────────────
  // Consumed by app/lib/backup. All values flow exclusively through
  // config.get() — no process.env access outside the config system.
  {
    key: 'backup.enabled',
    env: 'BACKUP_ENABLED',
    defaultKey: 'backup.enabled',
    required: false,
    type: 'boolean',
    category: 'backup',
    status: 'optional',
    description: 'Master switch for the backup framework — manual backups are refused when false.',
  },
  {
    key: 'backup.directory',
    env: 'BACKUP_DIRECTORY',
    defaultKey: 'backup.directory',
    required: false,
    type: 'string',
    category: 'backup',
    status: 'optional',
    description: 'Backup root directory — resolved by app/lib/local/paths (default data/backups).',
  },
  {
    key: 'backup.compression.enabled',
    env: 'BACKUP_COMPRESSION_ENABLED',
    defaultKey: 'backup.compression.enabled',
    required: false,
    type: 'boolean',
    category: 'backup',
    status: 'optional',
    description: 'Compress backup payloads with gzip (backup manager API is independent of this).',
  },
  {
    key: 'backup.retention.maxBackups',
    env: 'BACKUP_RETENTION_MAX_BACKUPS',
    defaultKey: 'backup.retention.maxBackups',
    required: false,
    type: 'number',
    category: 'backup',
    status: 'optional',
    description: 'Maximum retained backups — the oldest are pruned beyond this.',
  },
  {
    key: 'backup.schedule.enabled',
    env: 'BACKUP_SCHEDULE_ENABLED',
    defaultKey: 'backup.schedule.enabled',
    required: false,
    type: 'boolean',
    category: 'backup',
    status: 'optional',
    description: 'Enable scheduled backups (infrastructure exists, remains disabled — manual only).',
  },
  {
    key: 'backup.schedule.intervalSeconds',
    env: 'BACKUP_SCHEDULE_INTERVAL_SECONDS',
    defaultKey: 'backup.schedule.intervalSeconds',
    required: false,
    type: 'number',
    category: 'backup',
    status: 'optional',
    description: 'Interval between scheduled backups when enabled.',
  },

  // ── Health & diagnostics (Milestone 4.4) ──────────────────────────
  // Consumed by app/lib/health. Local-only — no telemetry, no cloud.
  {
    key: 'health.enabled',
    env: 'HEALTH_ENABLED',
    defaultKey: 'health.enabled',
    required: false,
    type: 'boolean',
    category: 'health',
    status: 'optional',
    description: 'Master switch for the health & diagnostics framework.',
  },
  {
    key: 'diagnostics.enabled',
    env: 'DIAGNOSTICS_ENABLED',
    defaultKey: 'diagnostics.enabled',
    required: false,
    type: 'boolean',
    category: 'health',
    status: 'optional',
    description: 'Enable runtime diagnostics collection (app/lib/health).',
  },
  {
    key: 'diagnostics.reportDirectory',
    env: 'DIAGNOSTICS_REPORT_DIRECTORY',
    defaultKey: 'diagnostics.reportDirectory',
    required: false,
    type: 'string',
    category: 'health',
    status: 'optional',
    description: 'Directory for saved health reports (default data/diagnostics).',
  },
  {
    key: 'selfTest.enabled',
    env: 'SELF_TEST_ENABLED',
    defaultKey: 'selfTest.enabled',
    required: false,
    type: 'boolean',
    category: 'health',
    status: 'optional',
    description: 'Enable executable self-tests (read-only, never business data).',
  },

  // ── Future milestones — structure only ─────────────────────────────
  {
    key: 'future.apiBaseUrl',
    env: 'API_BASE_URL',
    defaultKey: 'future.apiBaseUrl',
    required: false,
    type: 'url',
    category: 'future',
    status: 'future',
    description: 'Absolute API base URL for LAN/offline clients.',
  },
  {
    key: 'future.lanDiscovery.enabled',
    env: 'LAN_DISCOVERY_ENABLED',
    defaultKey: 'future.lanDiscovery.enabled',
    required: false,
    type: 'boolean',
    category: 'future',
    status: 'future',
    description: 'Enable LAN discovery (LAN milestone).',
  },
  {
    key: 'future.lanDiscovery.multicastAddress',
    env: 'LAN_DISCOVERY_MULTICAST',
    defaultKey: 'future.lanDiscovery.multicastAddress',
    required: false,
    type: 'string',
    category: 'future',
    status: 'future',
    description: 'Multicast group used for LAN discovery.',
  },
  {
    key: 'future.lanDiscovery.port',
    env: 'LAN_DISCOVERY_PORT',
    defaultKey: 'future.lanDiscovery.port',
    required: false,
    type: 'number',
    category: 'future',
    status: 'future',
    description: 'UDP port used for LAN discovery.',
  },
  {
    key: 'future.lanMode.enabled',
    env: 'LAN_MODE_ENABLED',
    defaultKey: 'future.lanMode.enabled',
    required: false,
    type: 'boolean',
    category: 'future',
    status: 'future',
    description: 'Enable LAN mode (LAN milestone). Consumed by app/lib/local/flags.',
  },
  {
    key: 'future.offlineMode.enabled',
    env: 'OFFLINE_MODE_ENABLED',
    defaultKey: 'future.offlineMode.enabled',
    required: false,
    type: 'boolean',
    category: 'future',
    status: 'future',
    description: 'Enable offline mode (offline milestone). Consumed by app/lib/local/flags.',
  },
  {
    key: 'future.sync.enabled',
    env: 'SYNC_ENABLED',
    defaultKey: 'future.sync.enabled',
    required: false,
    type: 'boolean',
    category: 'future',
    status: 'future',
    description: 'Enable data synchronization (sync milestone).',
  },
  {
    key: 'future.sync.intervalSeconds',
    env: 'SYNC_INTERVAL_SECONDS',
    defaultKey: 'future.sync.intervalSeconds',
    required: false,
    type: 'number',
    category: 'future',
    status: 'future',
    description: 'Synchronization polling interval.',
  },
  {
    key: 'future.paths.installation',
    env: 'INSTALLATION_PATH',
    defaultKey: 'future.paths.installation',
    required: false,
    type: 'string',
    category: 'future',
    status: 'future',
    description: 'Installation directory (installer milestone).',
  },
  {
    key: 'future.paths.database',
    env: 'DATABASE_LOCATION',
    defaultKey: 'future.paths.database',
    required: false,
    type: 'string',
    category: 'future',
    status: 'future',
    description: 'SQLite database file location (database milestone).',
  },
  {
    key: 'future.paths.logs',
    env: 'LOG_DIRECTORY',
    defaultKey: 'future.paths.logs',
    required: false,
    type: 'string',
    category: 'future',
    status: 'future',
    description: 'Log directory (logging milestone).',
  },
];

/**
 * Environment variables that once existed but are now REMOVED.
 * Kept here as the machine-readable audit record (Task 4).
 */
export const LEGACY = [
  {
    env: 'JWT_EXPIRES_IN',
    status: 'dead',
    removedIn: '3.1',
    reason:
      'Never read by application code. JWT expiry is derived from SESSION_IDLE_TIMEOUT_MINUTES (app/api/lib/jwt.js).',
  },
  {
    env: 'VERCEL_OIDC_TOKEN',
    status: 'dead',
    removedIn: '3.1',
    reason:
      'Vercel CLI cloud artifact from the pre-Local-Edition era. Never read by application code.',
  },
  {
    env: 'LOG_TO_FILE',
    status: 'dead',
    removedIn: '4.2',
    reason:
      'Replaced by LOG_FILE_ENABLED (logging.file.enabled) when the logging framework was completed in Milestone 4.2.',
  },
  {
    env: 'future.backup.enabled',
    status: 'dead',
    removedIn: '4.3',
    reason:
      'Config key replaced by backup.schedule.enabled when the backup framework was completed in Milestone 4.3 (env var renamed AUTOMATIC_BACKUPS_ENABLED → BACKUP_SCHEDULE_ENABLED).',
  },
  {
    env: 'future.paths.backup',
    status: 'dead',
    removedIn: '4.3',
    reason:
      'Config key moved to backup.directory in Milestone 4.3; the BACKUP_DIRECTORY environment variable remains in use by backup.directory.',
  },
];
