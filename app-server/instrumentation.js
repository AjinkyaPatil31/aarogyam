/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Aarogyam — Next.js Runtime Instrumentation  (M1.6 Phase B, W-01)
 * ─────────────────────────────────────────────────────────────────────────────
 *  Activates the EXISTING runtime bootstrap manager (app/lib/bootstrap) at
 *  the Next.js server startup boundary (`next start` / `next dev`). The
 *  bootstrap manager drives the deterministic startup sequence built in
 *  Milestones 3.3 / 4.x:
 *
 *    configuration coherence → installation (idempotent) → upgrade
 *    detection → infrastructure service registry → health attach
 *
 *  This is the wiring the framework was built for — no new architecture,
 *  no duplicated initialization. The manager's initialize() is idempotent
 *  (a READY bootstrap is left untouched) and performs no database
 *  migrations; the installer's directory creation is transactional.
 *
 *  Safety properties:
 *    • Build-phase no-op — register() returns immediately during
 *      `next build` (NEXT_PHASE=phase-production-build), so a production
 *      build never requires a live runtime environment and performs no
 *      filesystem writes.
 *    • Node-only — bootstrap never runs in the edge runtime.
 *    • Edge-safe compilation — Next.js compiles instrumentation.js for
 *      the Edge runtime as well as Node, and the Edge compilation cannot
 *      bundle `node:` built-in modules. The bootstrap/logging module
 *      specifiers are therefore assembled at runtime with webpackIgnore:
 *      the Edge compile never traces that graph, while the Node runtime
 *      resolves it natively against process.cwd() — the SAME cwd
 *      assumption the path manager already makes (app/lib/local/paths.mjs
 *      resolves appRoot from process.cwd()).
 *    • Failure-safe — a bootstrap failure is logged through the logging
 *      framework (structured, no secrets) and the server continues
 *      serving; the health framework reports the FAILED bootstrap state
 *      to the clinic operator via /api/health.
 *    • Graceful shutdown — SIGINT/SIGTERM run the existing shutdown()
 *      sequence (reverse-dependency service stop + log flush).
 *
 *  Dependencies: app/lib/bootstrap (existing). No new dependencies.
 */

export async function register() {
  // Never run during `next build` or outside the Node.js server runtime.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  // The bootstrap module graph uses Node.js built-ins (node:fs, node:crypto,
  // …). Next.js compiles instrumentation.js for the Edge runtime as well as
  // Node, and the Edge compilation cannot bundle `node:` schemes — so the
  // module specifiers below are assembled at runtime (webpackIgnore): the
  // Edge compile never traces the bootstrap graph, while the Node runtime
  // resolves it natively. Absolute paths (Windows drive letters, spaces,
  // special characters) are converted to proper file:// URLs with
  // node:url pathToFileURL — imported at runtime, never bundled.
  const cwd = process.cwd();
  const { pathToFileURL } = await import(/* webpackIgnore: true */ 'node:url');
  const { createBootstrapManager } = await import(
    /* webpackIgnore: true */ pathToFileURL(`${cwd}/app/lib/bootstrap/index.mjs`).href
  );
  const { createLogger } = await import(
    /* webpackIgnore: true */ pathToFileURL(`${cwd}/app/lib/logging/index.mjs`).href
  );
  const log = createLogger('startup');

  let manager = null;
  try {
    manager = createBootstrapManager();
    const status = await manager.initialize();
    log.info('Bootstrap initialization complete', {
      state: status.state,
      services: Object.keys(status.registry ?? {}).length,
    });
  } catch (err) {
    // Failure-safe: log the structured diagnostic and keep the server
    // running — core application routes do not depend on the bootstrap
    // services. /api/health surfaces the FAILED state to the operator.
    log.error('Bootstrap initialization failed — continuing in degraded mode', err);
  }

  // M1.6 Phase C (W-04) — WhatsApp runtime consumer. Same Node-only,
  // edge-safe import pattern. Fire-and-forget: the consumer is failure-safe
  // internally (no Chrome/session → logged no-op; client init failure →
  // logged, queue stays persisted) and must never block or crash startup.
  const whatsappUrl = pathToFileURL(`${cwd}/app/lib/whatsappConsumer.mjs`).href;
  try {
    const { startWhatsAppRuntime } = await import(/* webpackIgnore: true */ whatsappUrl);
    startWhatsAppRuntime().catch((err) => {
      log.error('WhatsApp runtime consumer failed to start', err);
    });
  } catch (err) {
    // Module unavailable (e.g. missing optional runtime) — never fatal.
    log.warn('WhatsApp runtime consumer module unavailable', err);
  }

  // Graceful shutdown: run the existing bootstrap shutdown sequence
  // (registry services stopped in reverse dependency order, buffered log
  // writes flushed), then stop the WhatsApp runtime consumer (poll timer
  // cleared, client destroyed). Next.js's own signal handlers lead the
  // graceful drain and process exit; ours only flush the infrastructure
  // layer. A short-grace unref'd fallback guarantees exit if the process
  // lingers.
  const shutdown = async () => {
    try {
      await manager?.shutdown();
    } catch (err) {
      log.error('Bootstrap shutdown sequence failed', err);
    }
    try {
      const { stopWhatsAppRuntime } = await import(/* webpackIgnore: true */ whatsappUrl);
      await stopWhatsAppRuntime();
    } catch (err) {
      log.warn('WhatsApp runtime consumer stop failed', err);
    }
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
