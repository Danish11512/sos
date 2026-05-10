/**
 * Pipeline orchestrator — dispatches to the correct site pipeline.
 *
 * LinkedIn uses the new DOM-based pipeline (no page reloads).
 * Indeed uses the legacy URL-based navigation pipeline.
 */

import type { AppSettings } from "../settings/sections"
import { loadSettings } from "../utils/storage"
import { runIndeedPipeline, applyIndeedExtraFilters } from "./indeed"
import type { ApplyFiltersResult, ScrapeJobResult } from "./types"

export type { ApplyFiltersResult, ScrapeJobResult } from "./types"

async function getSiteSettings(siteId: string): Promise<AppSettings["perSite"][string] | null> {
  const settings: AppSettings = await loadSettings()
  return settings.perSite[siteId] ?? null
}

/**
 * Run the full pipeline for a given site.
 * LinkedIn uses widget-based flow in content.ts — this only handles Indeed.
 */
export async function runPipeline(siteId: string): Promise<ApplyFiltersResult> {
  const site = await getSiteSettings(siteId)
  if (!site) return { success: false, appliedCount: 0, errors: ["Site settings not found"] }

  switch (siteId) {
    case "indeed":
      return runIndeedPipeline(site)
    default:
      return { success: false, appliedCount: 0, errors: [`No pipeline for site: ${siteId}`] }
  }
}

/**
 * Apply post-navigation (DOM-based) filters on a search results page.
 */
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

/**
 * Check if the current URL indicates we're on a search results page.
 */
export function isOnSearchResultsPage(siteId: string): boolean {
  const url = window.location.href.toLowerCase()
  switch (siteId) {
    case "linkedin":
      return url.includes("/jobs/search-results/")
    case "indeed":
      return url.includes("/jobs") && url.includes("?q=")
    default:
      return false
  }
}

/**
 * Capture up to maxJobs job listings from the search results page.
 * Used by the legacy pipeline (Indeed). LinkedIn handles capture internally.
 */
export async function captureJobs(siteId: string, maxJobs?: number): Promise<ScrapeJobResult> {
  switch (siteId) {
    case "linkedin":
      return { success: false, jobs: [], errors: ["LinkedIn capture handled internally by runLinkedInPipeline"] }
    default:
      return { success: false, jobs: [], errors: [`Job capture not implemented for: ${siteId}`] }
  }
}
