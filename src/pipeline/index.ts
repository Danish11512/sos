/**
 * Pipeline orchestrator — dispatches to the correct site pipeline.
 *
 * LinkedIn uses the new DOM-based pipeline (no page reloads).
 * Indeed uses the legacy URL-based navigation pipeline.
 *
 * Features:
 * - Per-stage error recovery with try/catch
 * - Per-job timeout (30s) via AbortSignal
 * - Max consecutive failures threshold (3)
 * - Empty-state / no-more-jobs detection
 * - Structured error/progress events via EventBus
 */

import type { AppSettings } from "../settings/sections"
import { loadSettings } from "../utils/storage"
import { eventBus } from "../utils/event-bus"
import { applyIndeedExtraFilters } from "./indeed"
import type { ApplyFiltersResult, ScrapeJobResult, PipelineError } from "./types"
import { sitePresets } from "../config/sites"

export type { ApplyFiltersResult, ScrapeJobResult, PipelineError }

/* ── Error classes ── */

export class PipelineAbortedError extends Error {
  constructor(msg = "Pipeline aborted") { super(msg); this.name = "PipelineAbortedError" }
}

export class StageFailedError extends Error {
  constructor(msg: string, public stage: string) { super(msg); this.name = "StageFailedError" }
}

/* ── Helpers ── */

/**
 * Create an AbortSignal that auto-aborts after `ms` milliseconds.
 * The returned signal is already linked to the parent signal (if any).
 */
function timeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(new DOMException("Timed out", "TimeoutError")), ms)
  if (parent) {
    const onParentAbort = () => { ctrl.abort(parent.reason); clearTimeout(timer) }
    parent.addEventListener("abort", onParentAbort, { once: true })
  }
  // Clean up timer when child aborts for any reason
  ctrl.signal.addEventListener("abort", () => clearTimeout(timer), { once: true })
  return ctrl.signal
}

/**
 * Emit a progress event to the widget UI.
 */
function emitProgress(stage: string, detail: string, pct?: number): void {
  eventBus.emit("pipeline-progress", { stage, detail, pct })
}

/**
 * Emit an error event to the widget UI.
 */
function emitError(error: PipelineError): void {
  eventBus.emit("pipeline-error", error)
}

/* ── Site settings loader ── */

async function getSiteSettings(siteId: string): Promise<AppSettings["perSite"][string] | null> {
  const settings: AppSettings = await loadSettings()
  return settings.perSite[siteId] ?? null
}

/* ── Orchestrated per-job loop with recovery ── */

/**
 * Pipeline pre-processing orchestrator.
 *
 * This handles pre-processing before site-specific pipelines take over:
 *  1. loadSiteConfig
 *  2. applyPostNavFilters (e.g., Indeed "All filters" modal)
 *
 * Per-job processing (clicking cards, reading descriptions, Easy Apply) is
 * delegated to site-specific pipelines (runLinkedInPipeline, runIndeedPipeline)
 * which are called directly from content.ts, not through this function.
 *
 * If any stage fails we emit an error event.
 */
export async function runPipeline(siteId: string): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }

  emitProgress("init", "Loading site settings…")

  // Stage 1 — load config
  const site = await getSiteSettings(siteId)
  if (!site) {
    const err: PipelineError = { stage: "loadSiteConfig", message: "Site settings not found", fatal: true }
    emitError(err)
    return { success: false, appliedCount: 0, errors: [err.message] }
  }

  // Stage 2 — post-navigation filters (e.g., Indeed's "All filters" modal toggles)
  try {
    emitProgress("filters", "Applying filters…")
    const filterResult = await runPipelineStage("applyPostNavFilters", () => applyPostNavFilters(siteId))
    result.appliedCount += filterResult.appliedCount
    if (filterResult.errors.length) result.errors.push(...filterResult.errors)
  } catch (err: any) {
    const pipelineErr: PipelineError = { stage: "applyPostNavFilters", message: err?.message ?? "Unknown error" }
    emitError(pipelineErr)
    result.errors.push(pipelineErr.message)
    // Filters are non-critical — continue
  }

  // Per-job processing is delegated to site-specific pipelines
  // (runLinkedInPipeline, runIndeedPipeline) which are called directly
  // from content.ts. This orchestrator handles pre-processing only
  // (filter application, etc.).
  // For LinkedIn, runLinkedInPipeline in linkedin.ts is called directly.
  // For Indeed, the legacy pipeline in content.ts handles everything.

  emitProgress("done", "Pipeline complete", 100)
  result.success = result.errors.length === 0
  return result
}

/**
 * Run a single pipeline stage with try/catch safety.
 * Returns the stage result on success, or throws on failure.
 */
async function runPipelineStage<T>(stageName: string, fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
  const signal = timeoutMs ? timeoutSignal(timeoutMs) : undefined
  try {
    return await (signal ? withTimeout(fn(), signal) : fn())
  } catch (err: any) {
    throw new StageFailedError(err?.message ?? "Unknown error", stageName)
  }
}

/**
 * Wraps a promise so it rejects when the signal fires.
 */
function withTimeout<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      if (signal.aborted) reject(new DOMException("Timed out", "TimeoutError"))
      else signal.addEventListener("abort", () => reject(new DOMException("Timed out", "TimeoutError")), { once: true })
    }),
  ])
}

/* ── Post-navigation filter application (delegates to site modules) ── */

export async function applyPostNavFilters(siteId: string): Promise<ApplyFiltersResult> {
  const site = await getSiteSettings(siteId)
  if (!site) return { success: false, appliedCount: 0, errors: [] }

  switch (siteId) {
    case "indeed":
      return applyIndeedExtraFilters(site)
    default:
      return { success: true, appliedCount: 0, errors: [] }
  }
}

/* ── Search results URL detection ── */

export function isOnSearchResultsPage(siteId: string): boolean {
  const url = window.location.href.toLowerCase()
  const preset = sitePresets.find((p) => p.id === siteId)
  if (!preset) return false
  const matchesPattern = preset.searchResultPatterns.some((p) => url.includes(p))
  const hasSearchQuery = preset.requiresSearchQuery ? url.includes("?q=") : true
  return matchesPattern && hasSearchQuery
}

/* ── Job capture (for site pipelines that use it) ── */

export async function captureJobs(siteId: string, maxJobs?: number): Promise<ScrapeJobResult> {
  switch (siteId) {
    case "linkedin":
      console.warn("[SOS] Pipeline: LinkedIn capture handled internally by runLinkedInPipeline — skipping")
      return { success: true, jobs: [], errors: [] }
    default:
      return { success: false, jobs: [], errors: [`Job capture not implemented for: ${siteId}`] }
  }
}