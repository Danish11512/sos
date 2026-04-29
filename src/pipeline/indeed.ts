/**
 * Indeed-specific pipeline: filter application + search navigation.
 *
 * Indeed filter URL params:
 *   q=search+terms
 *   l=location
 *   sort=date (date), relevance
 *   fromage=1 (last 24h), 7 (week), 14 (2 weeks), 30 (month)
 *   filter=0 / 1
 *   sc=0kf: (advanced filter encoded param)
 *     - Remote: attr(DSQF7,FC.)
 *     - Hybrid: attr(DSQF7,HYBRID.)
 *     - On-site: attr(DSQF7,ONSITE.)
 *     - Full-time: attr(S,S), Part-time: attr(S,P), Contract: attr(S,C), Temporary: attr(S,T)
 */

import type { SiteSettings } from "../settings/sections"
import { delay, waitForElement, scrollAndClick, findElementByText } from "../utils/dom"
import type { ApplyFiltersResult } from "./types"

/* ── Indeed pipeline entry ── */

export async function runIndeedPipeline(site: SiteSettings): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }

  // Build the search URL with URL-based filters
  const searchUrl = buildIndeedSearchUrl(site)
  console.log(`[SOS] Indeed: Navigating to search URL: ${searchUrl}`)
  window.location.href = searchUrl

  return result
}

/**
 * Apply extra filters on Indeed after the search results page has loaded.
 */
export async function applyIndeedExtraFilters(
  site: SiteSettings,
  options?: { clickDelayMs?: number }
): Promise<ApplyFiltersResult> {
  const clickDelay = options?.clickDelayMs ?? 600
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }

  // Determine which filters need DOM manipulation on Indeed
  // Indeed has an "All Filters" button that opens a filter panel
  const hasFiltersToApply =
    site.filters.under10Applicants ||
    site.filters.inYourNetwork ||
    site.filters.fairChanceEmployer ||
    site.filters.easyApplyOnly

  if (!hasFiltersToApply) {
    console.log("[SOS] Indeed: No DOM-only filters to apply")
    return result
  }

  console.log("[SOS] Indeed: Opening filter panel for DOM-based filters")

  // Wait for the job search page to stabilize
  await delay(2_000)

  // Indeed filter panel — look for "Filter" button
  const filterBtns = document.querySelectorAll("button")
  let filterBtn: Element | null = null
  for (const btn of filterBtns) {
    const text = btn.textContent?.trim().toLowerCase() || ""
    if (text === "filter" || text.includes("all filters")) {
      filterBtn = btn
      break
    }
  }

  if (!filterBtn) {
    // Try aria-label
    filterBtn = document.querySelector('button[aria-label*="filter" i]')
  }

  if (!filterBtn) {
    result.errors.push("Could not find 'Filter' button on Indeed")
    result.success = false
    return result
  }

  scrollAndClick(filterBtn)
  await delay(1_500)

  // Wait for the filter modal
  const filterModal = await waitForElement(
    ".filter-modal-container, [data-testid='filter-modal'], div[class*='filters-modal']",
    5_000
  )

  if (!filterModal) {
    result.errors.push("Could not find Indeed filter modal")
    result.success = false
    return result
  }

  // Map SOS filters → Indeed filter labels
  const indeedFilters: Array<{ enabled: boolean; label: string }> = [
    { enabled: site.filters.easyApplyOnly, label: "Easy Apply" },
    { enabled: site.filters.under10Applicants, label: "Under 10 applicants" },
    { enabled: site.filters.inYourNetwork, label: "In your network" },
    { enabled: site.filters.fairChanceEmployer, label: "Fair chance employer" },
  ]

  for (const f of indeedFilters) {
    if (!f.enabled) continue

    // Try to find checkbox by label text within modal
    const labels = filterModal.querySelectorAll("label, span, div[role='checkbox']")
    let found = false

    for (const label of labels) {
      const text = label.textContent?.trim().toLowerCase() || ""
      if (text.includes(f.label.toLowerCase())) {
        scrollAndClick(label)
        await delay(clickDelay)
        result.appliedCount++
        console.log(`[SOS] Indeed: Toggled "${f.label}"`)
        found = true
        break
      }
    }

    if (!found) {
      console.log(`[SOS] Indeed: Could not find element for "${f.label}"`)
    }
  }

  // Click "Show results" / "Apply" button
  const applyBtns = filterModal.querySelectorAll("button")
  let applyBtn: Element | null = null
  for (const btn of applyBtns) {
    const text = btn.textContent?.trim().toLowerCase() || ""
    if (text.includes("show results") || text.includes("apply")) {
      applyBtn = btn
      break
    }
  }

  if (applyBtn) {
    scrollAndClick(applyBtn)
    await delay(1_000)
    console.log("[SOS] Indeed: Clicked 'Show results' to apply filters")
  }

  return result
}

/* ── URL builder ── */

function buildIndeedSearchUrl(site: SiteSettings): string {
  const base = "https://www.indeed.com/jobs?"
  const params = new URLSearchParams()

  // Search terms
  const keywords = site.search.searchTerms.join(" ")
  if (keywords) params.set("q", keywords)

  // Location
  if (site.search.searchLocation) {
    params.set("l", site.search.searchLocation)
  }

  // Sort By
  const sortVal = site.filters.sortBy.trim().toLowerCase()
  if (sortVal === "most recent") params.set("sort", "date")
  else if (sortVal === "most relevant") params.set("sort", "relevance")

  // Date posted (fromage in days)
  const dateFromageMap: Record<string, string> = {
    "past 24 hours": "1",
    "past week": "7",
    "past 14 days": "14",
    "past month": "30",
  }
  const dateVal = dateFromageMap[site.filters.datePosted.trim().toLowerCase()]
  if (dateVal) params.set("fromage", dateVal)

  // Experience level — Indeed uses "sc" (search criteria) parameter
  // This is complex, so we skip it for now and handle via DOM if needed

  // Job type — Indeed uses "jt" parameter
  const indeedJobTypeMap: Record<string, string> = {
    "Full-time": "fulltime",
    "Part-time": "parttime",
    "Contract": "contract",
    "Temporary": "temporary",
    "Internship": "internship",
  }
  const jobTypes = site.filters.jobType
    .map((v) => indeedJobTypeMap[v.trim()])
    .filter(Boolean)
  if (jobTypes.length > 0) {
    params.set("jt", jobTypes.join(","))
  }

  return base + params.toString()
}
