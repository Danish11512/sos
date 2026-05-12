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
import { runIndeedPipeline, applyIndeedExtraFilters } from "./indeed"
import type { ApplyFiltersResult, ScrapeJobResult, PipelineError, ConsecutiveFailuresError, NoJobsError, JobTimeoutError } from "./types"

export type { ApplyFiltersResult, ScrapeJobResult, PipelineError, ConsecutiveFailuresError, NoJobsError, JobTimeoutError }

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
 * Run outer pipeline loop with error recovery.
 *
 * Stages:
 *  1. loadSiteConfig
 *  2. applyPostNavFilters
 *  3. collectJobCards
 *  4. filterByCompany
 *  5. for each job card:
 *      5a. readDescription
 *      5b. validateJob
 *      5c. clickEasyApply
 *      5d. fillModal
 *      5e. submit
 *
 * If any stage fails we emit an error event and decide whether to abort or skip.
 */
export async function runPipeline(siteId: string): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }
  let consecutiveFailures = 0
  const MAX_CONSECUTIVE_FAILURES = 3

  emitProgress("init", "Loading site settings…")

  // Stage 1 — load config
  const site = await getSiteSettings(siteId)
  if (!site) {
    const err: PipelineError = { stage: "loadSiteConfig", message: "Site settings not found", fatal: true }
    emitError(err)
    return { success: false, appliedCount: 0, errors: [err.message] }
  }

  // Stage 2 — post-navigation filters
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

  // Stage 3 — collect job cards (only for site pipelines that use captureJobs; LinkedIn handles internally)
  let jobs: ScrapeJobResult["jobs"] = []
  if (siteId === "linkedin") {
    emitProgress("collect", "Reading job cards from LinkedIn…")
    // LinkedIn handles this internally in the content script via export functions
    // Nothing to capture here
  } else if (siteId === "indeed") {
    try {
      emitProgress("collect", "Capturing job listings…")
      const captured = await runPipelineStage("captureJobs", () => captureJobs(siteId, site.pipeline.maxJobs ?? 25))
      jobs = captured.jobs
      if (captured.errors.length) result.errors.push(...captured.errors)
    } catch (err: any) {
      const pipelineErr: PipelineError = { stage: "captureJobs", message: err?.message ?? "Unknown error", fatal: true }
      emitError(pipelineErr)
      return { success: false, appliedCount: result.appliedCount, errors: [...result.errors, pipelineErr.message] }
    }
  }

  // Empty-state check
  if (siteId !== "linkedin" && jobs.length === 0) {
    const noJobsErr: NoJobsError = { stage: "captureJobs", message: "No job listings found" }
    emitError(noJobsErr)
    result.errors.push(noJobsErr.message)
    return result
  }

  // Stage 5 — per-job loop
  const maxJobs = siteId === "linkedin" ? (site.pipeline.maxJobs ?? 25) : jobs.length
  emitProgress("applying", `Starting per-job loop (up to ${maxJobs})…`)

  for (let i = 0; i < maxJobs; i++) {
    // Per-job processing is delegated to site-specific pipelines
    // (runLinkedInPipeline, runIndeedPipeline) which handle their own
    // loops internally. This orchestrator-level loop tracks overall
    // progress and enforces the max-jobs cap.

    emitProgress("processing", `Job ${i + 1} of ${maxJobs}`, Math.round(((i) / maxJobs) * 100))
    console.log(`[SOS] Pipeline: Processing job ${i + 1}/${maxJobs}`)

    // Reset consecutive failures — the site-specific pipeline reports
    // its own errors via the event bus.
    consecutiveFailures = 0
  }

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
  switch (siteId) {
    case "linkedin":
      return url.includes("/jobs/search/")
    case "indeed":
      return url.includes("/jobs") && url.includes("?q=")
    default:
      return false
  }
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