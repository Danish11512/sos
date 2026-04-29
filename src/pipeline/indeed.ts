/**
 * Indeed-specific pipeline: filter application + search navigation.
 *
 * Indeed filter URL params:
 *   q=search+terms
 *   l=location
 *   sort=date (date), relevance
 *   fromage=1 (last 24h), 7 (week), 14 (2 weeks), 30 (month)
 *   jt=fulltime, parttime, contract, temporary, internship
 */

import type { SiteSettings } from "../settings/sections"
import { delay, waitForElement, scrollAndClick, toggleCheckboxItems, findButtonByText } from "../utils/dom"
import type { ApplyFiltersResult } from "./types"

/* ── Indeed pipeline entry ── */

export async function runIndeedPipeline(site: SiteSettings): Promise<ApplyFiltersResult> {
  const searchUrl = buildIndeedSearchUrl(site)
  console.log(`[SOS] Indeed: Navigating to search URL: ${searchUrl}`)
  window.location.href = searchUrl
  return { success: true, appliedCount: 0, errors: [] }
}

/**
 * Apply extra filters on Indeed after the search results page has loaded.
 */
export async function applyIndeedExtraFilters(
  site: SiteSettings,
  options?: { clickDelayMs?: number }
): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }
  const clickDelay = options?.clickDelayMs ?? 600

  const filterItems = [
    { enabled: site.filters.easyApplyOnly, label: "Easy Apply" },
    { enabled: site.filters.under10Applicants, label: "Under 10 applicants" },
    { enabled: site.filters.inYourNetwork, label: "In your network" },
    { enabled: site.filters.fairChanceEmployer, label: "Fair chance employer" },
  ]

  if (!filterItems.some((f) => f.enabled)) {
    console.log("[SOS] Indeed: No DOM-only filters to apply")
    return result
  }

  console.log("[SOS] Indeed: Opening filter panel for DOM-based filters")
  await delay(2_000)

  // Find the filter button by text
  let filterBtn: Element | null = null
  for (const btn of document.querySelectorAll("button")) {
    const text = btn.textContent?.trim().toLowerCase() || ""
    if (text === "filter" || text.includes("all filters")) {
      filterBtn = btn
      break
    }
  }
  filterBtn ??= document.querySelector('button[aria-label*="filter" i]')

  if (!filterBtn) {
    result.errors.push("Could not find 'Filter' button on Indeed")
    result.success = false
    return result
  }

  scrollAndClick(filterBtn)
  await delay(1_500)

  const filterModal = await waitForElement(
    ".filter-modal-container, [data-testid='filter-modal'], div[class*='filters-modal']",
    5_000
  )

  if (!filterModal) {
    result.errors.push("Could not find Indeed filter modal")
    result.success = false
    return result
  }

  result.appliedCount += await toggleCheckboxItems(filterModal, filterItems, clickDelay)

  const applyBtn = findButtonByText(filterModal, "show results", "apply")
  if (applyBtn) {
    scrollAndClick(applyBtn)
    await delay(1_000)
    console.log("[SOS] Indeed: Clicked 'Show results' to apply filters")
  }

  return result
}

/* ── URL builder ── */

function buildIndeedSearchUrl(site: SiteSettings): string {
  const params = new URLSearchParams()

  const keywords = site.search.searchTerms.join(" ")
  if (keywords) params.set("q", keywords)
  if (site.search.searchLocation) params.set("l", site.search.searchLocation)

  const sortVal = site.filters.sortBy.trim().toLowerCase()
  if (sortVal === "most recent") params.set("sort", "date")
  else if (sortVal === "most relevant") params.set("sort", "relevance")

  const dateFromageMap: Record<string, string> = {
    "past 24 hours": "1",
    "past week": "7",
    "past 14 days": "14",
    "past month": "30",
  }
  const dateVal = dateFromageMap[site.filters.datePosted.trim().toLowerCase()]
  if (dateVal) params.set("fromage", dateVal)

  const indeedJobTypeMap: Record<string, string> = {
    "Full-time": "fulltime",
    "Part-time": "parttime",
    "Contract": "contract",
    "Temporary": "temporary",
    "Internship": "internship",
  }
  const jobTypes = site.filters.jobType.map((v) => indeedJobTypeMap[v.trim()]).filter(Boolean)
  if (jobTypes.length > 0) params.set("jt", jobTypes.join(","))

  return `https://www.indeed.com/jobs?${params.toString()}`
}
