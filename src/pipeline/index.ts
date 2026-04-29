/**
 * Pipeline orchestrator — dispatches to the correct site pipeline
 * and handles post-navigation filter application.
 */

import type { AppSettings } from "../settings/sections"
import { loadSettings } from "../utils/storage"
import { runLinkedInPipeline, applyLinkedInExtraFilters } from "./linkedin"
import { runIndeedPipeline, applyIndeedExtraFilters } from "./indeed"
import type { ApplyFiltersResult } from "./types"

export type { ApplyFiltersResult } from "./types"

async function getSiteSettings(siteId: string): Promise<AppSettings["perSite"][string] | null> {
  const settings: AppSettings = await loadSettings()
  return settings.perSite[siteId] ?? null
}

/**
 * Run the full pipeline for a given site. Navigates to search results with URL-based filters.
 */
export async function runPipeline(siteId: string): Promise<ApplyFiltersResult> {
  const site = await getSiteSettings(siteId)
  if (!site) return { success: false, appliedCount: 0, errors: ["Site settings not found"] }

  switch (siteId) {
    case "linkedin":
      return runLinkedInPipeline(site)
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
      return applyLinkedInExtraFilters(site)
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
