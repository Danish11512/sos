/**
 * LinkedIn-specific pipeline: filter application + search navigation.
 *
 * Strategy: Use URL query parameters for filters where possible (more reliable),
 * and DOM manipulation for toggles that must be set via the UI.
 *
 * LinkedIn filter URL params:
 *   f_TPR=r86400 (past 24h), r604800 (week), r2592000 (month)
 *   f_SB2=1 (most recent), 2 (most relevant)
 *   f_E=2 (entry), 3 (associate), 4 (mid-senior), 5 (director), 6 (executive)
 *   f_JT=F (full-time), P (part-time), C (contract), T (temporary), V (volunteer), I (internship)
 *   f_WT=1 (on-site), 2 (remote), 3 (hybrid)
 *   f_AL=true (easy apply)
 */

import type { SiteSettings } from "../settings/sections"
import { delay, waitForElement, scrollAndClick, toggleCheckboxItems, findButtonByText } from "../utils/dom"
import type { ApplyFiltersResult } from "./types"

/* ── URL parameter mapping ── */

const DATE_POSTED_MAP: Record<string, string> = {
  "past 24 hours": "r86400",
  "past week": "r604800",
  "past month": "r2592000",
}

const EXPERIENCE_MAP: Record<string, string> = {
  "Internship": "1",
  "Entry level": "2",
  "Associate": "3",
  "Mid-Senior level": "4",
  "Director": "5",
  "Executive": "6",
}

const JOB_TYPE_MAP: Record<string, string> = {
  "Full-time": "F",
  "Part-time": "P",
  "Contract": "C",
  "Temporary": "T",
  "Volunteer": "V",
  "Internship": "I",
}

const ON_SITE_MAP: Record<string, string> = {
  "On-site": "1",
  "Remote": "2",
  "Hybrid": "3",
}

const SORT_MAP: Record<string, string> = {
  "most recent": "1",
  "most relevant": "2",
}

/* ── Build the filtered search URL ── */

function buildSearchUrl(site: SiteSettings): string {
  const params = new URLSearchParams()

  const keywords = site.search.searchTerms.join(" ")
  if (keywords) params.set("keywords", keywords)
  if (site.search.searchLocation) params.set("location", site.search.searchLocation)

  const sortVal = SORT_MAP[site.filters.sortBy.trim().toLowerCase()]
  if (sortVal) params.set("f_SB2", sortVal)

  const dateVal = DATE_POSTED_MAP[site.filters.datePosted.trim().toLowerCase()]
  if (dateVal) params.set("f_TPR", dateVal)

  const expCodes = site.filters.experienceLevel.map((v) => EXPERIENCE_MAP[v.trim()]).filter(Boolean)
  if (expCodes.length > 0) params.set("f_E", expCodes.join(","))

  const jobCodes = site.filters.jobType.map((v) => JOB_TYPE_MAP[v.trim()]).filter(Boolean)
  if (jobCodes.length > 0) params.set("f_JT", jobCodes.join(","))

  const onsiteCodes = site.filters.onSite.map((v) => ON_SITE_MAP[v.trim()]).filter(Boolean)
  if (onsiteCodes.length > 0) params.set("f_WT", onsiteCodes.join(","))

  if (site.filters.easyApplyOnly) params.set("f_AL", "true")

  return `https://www.linkedin.com/jobs/search/?${params.toString()}`
}

/* ── DOM-based filter application for LinkedIn (post-nav) ── */

async function applyDomFilters(site: SiteSettings, clickDelayMs: number): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }

  const domFilters = [
    { enabled: site.filters.under10Applicants, label: "Under 10 applicants" },
    { enabled: site.filters.inYourNetwork, label: "In your network" },
    { enabled: site.filters.fairChanceEmployer, label: "Fair chance employer" },
  ]

  if (!domFilters.some((f) => f.enabled)) {
    console.log("[SOS] LinkedIn: No DOM-only filters to apply")
    return result
  }

  console.log("[SOS] LinkedIn: Opening 'All filters' modal for DOM-based filters")

  const allFiltersBtn = await waitForElement(
    "button[aria-label*='All filters'], button.jobs-search-dropdown__trigger--all-filters",
    6_000
  ) ?? (() => {
    for (const btn of document.querySelectorAll("button")) {
      if (btn.textContent?.trim().toLowerCase() === "all filters") return btn
    }
    return null
  })()

  if (!allFiltersBtn) {
    result.errors.push("Could not find 'All filters' button on LinkedIn")
    result.success = false
    return result
  }

  scrollAndClick(allFiltersBtn)
  await delay(1_500)

  const modalContainer = await waitForElement(
    ".jobs-search-all-filters__content, div[data-test-all-filters-modal]",
    5_000
  )

  if (!modalContainer) {
    result.errors.push("Could not find LinkedIn filter modal")
    result.success = false
    return result
  }

  result.appliedCount += await toggleCheckboxItems(modalContainer, domFilters, clickDelayMs)

  const applyBtn = await waitForElement(
    "button[aria-label*='Show results'], button.jobs-search-all-filters__apply-button",
    5_000
  ) ?? findButtonByText(modalContainer, "show results", "apply")

  if (applyBtn) {
    scrollAndClick(applyBtn)
    await delay(1_000)
    console.log("[SOS] LinkedIn: Clicked 'Show results' to apply filters")
  } else {
    result.errors.push("Could not find 'Show results' button in filter modal")
  }

  return result
}

/* ── Main pipeline entry ── */

export async function runLinkedInPipeline(site: SiteSettings): Promise<ApplyFiltersResult> {
  const searchUrl = buildSearchUrl(site)
  console.log(`[SOS] LinkedIn: Navigating to search URL: ${searchUrl}`)
  window.location.href = searchUrl
  return { success: true, appliedCount: 0, errors: [] }
}

/**
 * Apply extra filters on LinkedIn after the search results page has loaded.
 */
export async function applyLinkedInExtraFilters(
  site: SiteSettings,
  options?: { clickDelayMs?: number }
): Promise<ApplyFiltersResult> {
  return applyDomFilters(site, options?.clickDelayMs ?? 600)
}
