/**
 * Pipeline orchestrator — dispatches to the correct site pipeline
 * and handles post-navigation filter application.
 *
 * LinkedIn uses the new DOM-based pipeline (no page reloads).
 * Other sites (Indeed) use the legacy URL-based navigation pipeline.
 */

import type { AppSettings } from "../settings/sections"
import { loadSettings } from "../utils/storage"
import { runLinkedInPipeline } from "./linkedin"
import { runIndeedPipeline, applyIndeedExtraFilters } from "./indeed"
import type { ApplyFiltersResult, ScrapeJobResult } from "./types"

export type { ApplyFiltersResult, ScrapeJobResult } from "./types"

async function getSiteSettings(siteId: string): Promise<AppSettings["perSite"][string] | null> {
  const settings: AppSettings = await loadSettings()
  return settings.perSite[siteId] ?? null
}

/**
 * Run the full pipeline for a given site.
 * For LinkedIn: uses DOM-based navigation (no page reload).
 * For Indeed: uses legacy URL-based navigation.
 */
export async function runPipeline(siteId: string): Promise<ApplyFiltersResult> {
  const site = await getSiteSettings(siteId)
  if (!site) return { success: false, appliedCount: 0, errors: ["Site settings not found"] }

  switch (siteId) {
    case "linkedin":
      // Legacy runPipeline entry — LinkedIn now uses the widget-based flow in content.ts
      console.warn("[SOS] runPipeline called for LinkedIn — use content.ts widget flow instead")
      return { success: true, appliedCount: 0, errors: [] }

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
    case "linkedin":
      return { success: true, appliedCount: 0, errors: [] } // LinkedIn handles this internally
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
      return url.includes("/jobs/search/")
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
