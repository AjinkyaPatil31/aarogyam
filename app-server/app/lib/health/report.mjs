/**
 * ─────────────────────────────────────────────────────────────────────
 *  Aarogyam — Diagnostic Reports  (Milestone 4.4)
 * ─────────────────────────────────────────────────────────────────────
 *  Responsibility:
 *    Structured diagnostic reports with pluggable renderers. The JSON
 *    renderer is the canonical machine-readable form; the text renderer
 *    is the human-readable form. New formats register a renderer and
 *    are immediately available (REPORT_FORMATS).
 *
 *  Report document shape (formatter-independent):
 *    {
 *      $schema: 'aarogyam-health-report',
 *      formatVersion: 1,
 *      generatedAt, appVersion,
 *      overall,            // aggregate health state
 *      health: [results],  // per-provider results
 *      diagnostics: {…},   // runtime information
 *      selfTests: [results] | null,
 *      recommendations: [string],
 *      metadata: { platform, arch, hostname, nodeVersion, pid }
 *    }
 *
 *  Dependencies: app/lib/health/model. No cycles.
 */

import { HEALTH_SEVERITY, worstState } from './model.mjs';

/** Canonical report document version. */
export const REPORT_FORMAT_VERSION = 1;

/** Renderer registry — extensible (json | text). */
export const REPORT_FORMATS = Object.freeze(['json', 'text']);

function severityOf(status) {
  return HEALTH_SEVERITY[status] ?? HEALTH_SEVERITY.UNKNOWN;
}

/** Aggregate recommendations across all results (deduplicated). */
export function collectRecommendations(results) {
  const seen = new Set();
  const out = [];
  for (const result of results ?? []) {
    for (const rec of result.recommendations ?? []) {
      if (!seen.has(rec)) {
        seen.add(rec);
        out.push(rec);
      }
    }
  }
  return out;
}

/** Render a report document as pretty JSON. */
export function renderJsonReport(report) {
  return JSON.stringify(report, null, 2);
}

/** Render a report document as human-readable text. */
export function renderTextReport(report) {
  const lines = [];
  const bar = '='.repeat(60);
  lines.push(bar);
  lines.push('AAROGYAM HEALTH REPORT');
  lines.push(bar);
  lines.push(`Generated : ${report.generatedAt}`);
  lines.push(`App       : ${report.appVersion ?? 'unknown'}`);
  lines.push(`Overall   : ${report.overall}`);
  lines.push('');

  lines.push('HEALTH SUMMARY');
  lines.push('-'.repeat(60));
  for (const result of report.health ?? []) {
    const pad = result.status.padEnd(8);
    lines.push(`  ${pad} ${result.component.padEnd(14)} ${result.message}`);
    if (result.recommendations?.length > 0) {
      for (const rec of result.recommendations) lines.push(`           → ${rec}`);
    }
    if (result.duration !== undefined) lines.push(`           (${result.duration} ms)`);
  }
  lines.push('');

  if (report.selfTests && report.selfTests.length > 0) {
    lines.push('SELF-TESTS');
    lines.push('-'.repeat(60));
    for (const result of report.selfTests) {
      const pad = result.status.padEnd(8);
      lines.push(`  ${pad} ${result.component.padEnd(20)} ${result.message}`);
    }
    lines.push('');
  }

  lines.push('RUNTIME INFORMATION');
  lines.push('-'.repeat(60));
  const diag = report.diagnostics ?? {};
  if (diag.system) {
    lines.push(`  Platform      : ${diag.system.platform}/${diag.system.arch} (${diag.system.hostname})`);
    lines.push(`  Node          : ${diag.system.nodeVersion} (pid ${diag.system.pid})`);
    lines.push(`  Uptime        : ${diag.system.uptimeSeconds}s`);
    if (diag.system.memory) {
      lines.push(`  Heap used     : ${(diag.system.memory.heapUsed / 1024 / 1024).toFixed(1)} MB`);
    }
    if (diag.system.disk?.dataDisk) {
      lines.push(`  Data disk free: ${(diag.system.disk.dataDisk.freeBytes / 1024 / 1024).toFixed(0)} MB`);
    }
  }
  if (diag.storage) lines.push(`  Storage       : ${diag.storage.state} (cache ${diag.storage.cache?.entries ?? '?'} entries)`);
  if (diag.logging) lines.push(`  Logging       : ${diag.logging.state} (${diag.logging.written ?? 0} written)`);
  if (diag.backup?.registry) lines.push(`  Backups       : ${diag.backup.registry.count} retained, latest ${diag.backup.registry.latest?.id ?? 'none'}`);
  if (diag.lifecycle) lines.push(`  Lifecycle     : ${diag.lifecycle.managerState}`);
  lines.push('');

  if (report.recommendations && report.recommendations.length > 0) {
    lines.push('RECOMMENDATIONS');
    lines.push('-'.repeat(60));
    report.recommendations.forEach((rec, i) => lines.push(`  ${i + 1}. ${rec}`));
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Resolve the overall state of a report document (used when the caller
 * only supplies pieces).
 */
export function reportOverall(results) {
  return worstState((results ?? []).map((r) => r.status));
}

/** Sort results by severity (worst first) for stable output. */
export function sortBySeverity(results) {
  return [...(results ?? [])].sort((a, b) => severityOf(b.status) - severityOf(a.status));
}

export { severityOf };
