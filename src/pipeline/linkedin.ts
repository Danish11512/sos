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
import { delay, waitForElement, scrollAndClick, findElementByText } from "../utils/dom"
import { applyAllFilterTypes } from "./filter-applier"
import type { ApplyFiltersResult, PipelineSiteConfig } from "./types"

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

/* ── Pipeline site config ── */

export const linkedinPipelineConfig: PipelineSiteConfig = {
  searchUrl: "https://www.linkedin.com/jobs/search/",
  navWaitMs: 4_000,
  clickDelayMs: 600,
  filters: {
    datePosted: {
      openFilterPanelSelector: "button[data-control-name='filter_sort_by']",
      panelContainer: ".search-reusables__filters-bar",
      applyFilterSelector: "",
      panelOpenDelay: 500,
      mappings: [
        { value: "Any time", labelText: "Any time" },
        { value: "Past month", labelText: "Past month" },
        { value: "Past week", labelText: "Past week" },
        { value: "Past 24 hours", labelText: "Past 24 hours" },
      ],
    },
    sortBy: {
      openFilterPanelSelector: "",
      panelContainer: "",
      applyFilterSelector: "",
      panelOpenDelay: 0,
      mappings: [],
    },
    experienceLevel: {
      openFilterPanelSelector: "",
      panelContainer: "",
      applyFilterSelector: "",
      panelOpenDelay: 0,
      mappings: [],
    },
    jobType: {
      openFilterPanelSelector: "",
      panelContainer: "",
      applyFilterSelector: "",
      panelOpenDelay: 0,
      mappings: [],
    },
    onSite: {
      openFilterPanelSelector: "",
      panelContainer: "",
      applyFilterSelector: "",
      panelOpenDelay: 0,
      mappings: [],
    },
    easyApplyOnly: {
      openFilterPanelSelector: "",
      applyFilterSelector: "",
      panelOpenDelay: 0,
      mappings: [],
    },
  },
}

/* ── Build the filtered search URL ── */

function buildSearchUrl(site: SiteSettings): string {
  const base = "https://www.linkedin.com/jobs/search/?"
  const params = new URLSearchParams()

  // Search terms
  const keywords = site.search.searchTerms.join(" ")
  if (keywords) params.set("keywords", keywords)

  // Location
  if (site.search.searchLocation) {
    params.set("location", site.search.searchLocation)
  }

  // Sort By
  const sortVal = SORT_MAP[site.filters.sortBy.trim().toLowerCase()]
  if (sortVal) params.set("f_SB2", sortVal)

  // Date Posted (URL param)
  const dateVal = DATE_POSTED_MAP[site.filters.datePosted.trim().toLowerCase()]
  if (dateVal) params.set("f_TPR", dateVal)

  // Experience Level
  const expCodes = site.filters.experienceLevel
    .map((v) => EXPERIENCE_MAP[v.trim()])
    .filter(Boolean)
  if (expCodes.length > 0) params.set("f_E", expCodes.join(","))

  // Job Type
  const jobCodes = site.filters.jobType
    .map((v) => JOB_TYPE_MAP[v.trim()])
    .filter(Boolean)
  if (jobCodes.length > 0) params.set("f_JT", jobCodes.join(","))

  // On-site / Remote
  const onsiteCodes = site.filters.onSite
    .map((v) => ON_SITE_MAP[v.trim()])
    .filter(Boolean)
  if (onsiteCodes.length > 0) params.set("f_WT", onsiteCodes.join(","))

  // Easy Apply Only
  if (site.filters.easyApplyOnly) {
    params.set("f_AL", "true")
  }

  // Under 10 applicants — no URL param, handled via DOM after landing

  // In your network — no URL param, handled via DOM after landing

  // Fair chance employer — no URL param, handled via DOM after landing

  return base + params.toString()
}

/* ── DOM-based filter application for LinkedIn (post-nav) ── */

/**
 * Apply filters that cannot be set via URL parameters on LinkedIn.
 * This includes "Under 10 applicants", "In your network", "Fair chance employer".
 *
 * Strategy: Click the "All filters" button, toggle the elements inside the modal,
 * then click "Show results".
 */
async function applyDomFilters(site: SiteSettings, clickDelayMs: number): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }

  // Determine which DOM-only filters are enabled
  const domFilters: Array<{ enabled: boolean; label: string; selector: string }> = [
    {
      enabled: site.filters.under10Applicants,
      label: "Under 10 applicants",
      selector: "label[for*='under-10-applicants'] input, label:has(input[value*='under']), label:contains('Under 10')",
    },
    {
      enabled: site.filters.inYourNetwork,
      label: "In your network",
      selector: "label[for*='in-network'] input, label:has(input[value*='network'])",
    },
    {
      enabled: site.filters.fairChanceEmployer,
      label: "Fair chance employer",
      selector: "label[for*='fair-chance'] input, label:has(input[value*='fair'])",
    },
  ]

  const hasDomFilters = domFilters.some((f) => f.enabled)
  if (!hasDomFilters) {
    console.log("[SOS] LinkedIn: No DOM-only filters to apply")
    return result
  }

  console.log("[SOS] LinkedIn: Opening 'All filters' modal for DOM-based filters")

  // Click the "All filters" button
  const allFiltersBtn = await waitForElement(
    "button[aria-label*='All filters'], button.jobs-search-dropdown__trigger--all-filters",
    6_000
  )

  let filterTriggerEl: Element | null = allFiltersBtn

  // If the standard button wasn't found, try to find by text
  if (!filterTriggerEl) {
    // Try the "All filters" button specifically
    const buttons = document.querySelectorAll("button")
    for (const btn of buttons) {
      if (btn.textContent?.trim().toLowerCase() === "all filters") {
        filterTriggerEl = btn
        break
      }
    }
  }

  if (!filterTriggerEl) {
    result.errors.push("Could not find 'All filters' button on LinkedIn")
    result.success = false
    return result
  }

  scrollAndClick(filterTriggerEl)
  await delay(1_500)

  // Wait for the filter modal to appear
  const modalContainer = await waitForElement(
    ".jobs-search-all-filters__content, div[data-test-all-filters-modal]",
    5_000
  )

  if (!modalContainer) {
    result.errors.push("Could not find LinkedIn filter modal")
    result.success = false
    return result
  }

  // For each active DOM filter, find and click its checkbox/label
  for (const df of domFilters) {
    if (!df.enabled) continue

    // Try various selectors to find the checkbox
    let checkboxEl: Element | null = null

    // Try by label text
    const allLabels = modalContainer.querySelectorAll("label, span, div")
    for (const label of allLabels) {
      const text = label.textContent?.trim().toLowerCase() || ""
      if (text.includes(df.label.toLowerCase())) {
        // Click the label (which toggles the checkbox)
        checkboxEl = label
        break
      }
    }

    if (!checkboxEl) {
      // Try by input inside the modal
      const inputs = modalContainer.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]'
      )
      for (const input of inputs) {
        const parentText = input.closest("label")?.textContent?.toLowerCase() || ""
        if (parentText.includes(df.label.toLowerCase())) {
          checkboxEl = input
          break
        }
      }
    }

    if (checkboxEl) {
      scrollAndClick(checkboxEl)
      await delay(clickDelayMs)
      result.appliedCount++
      console.log(`[SOS] LinkedIn: Toggled "${df.label}" in filter modal`)
    } else {
      console.log(`[SOS] LinkedIn: Could not find element for "${df.label}"`)
    }
  }

  // Click "Show results" button to apply modal filters
  const showResultsBtn = await waitForElement(
    "button[aria-label*='Show results'], button.jobs-search-all-filters__apply-button",
    5_000
  )

  let resultsBtn: Element | null = showResultsBtn

  if (!resultsBtn) {
    // Try finding by text
    const buttons = modalContainer.querySelectorAll("button")
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase() || ""
      if (text.includes("show results") || text.includes("apply")) {
        resultsBtn = btn
        break
      }
    }
  }

  if (resultsBtn) {
    scrollAndClick(resultsBtn)
    await delay(1_000)
    console.log("[SOS] LinkedIn: Clicked 'Show results' to apply filters")
  } else {
    result.errors.push("Could not find 'Show results' button in filter modal")
  }

  return result
}

/* ── Main pipeline entry ── */

export async function runLinkedInPipeline(site: SiteSettings): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }
  const cfg = linkedinPipelineConfig

  // Step 1: Navigate to the search URL with URL-based filters
  const searchUrl = buildSearchUrl(site)
  console.log(`[SOS] LinkedIn: Navigating to search URL: ${searchUrl}`)
  window.location.href = searchUrl

  return result
}

/**
 * Apply extra filters on LinkedIn after the search results page has loaded.
 * This is called from the content script when it detects we're on a LinkedIn
 * jobs search page.
 */
export async function applyLinkedInExtraFilters(
  site: SiteSettings,
  options?: { clickDelayMs?: number }
): Promise<ApplyFiltersResult> {
  const clickDelay = options?.clickDelayMs ?? 600
  const result = await applyDomFilters(site, clickDelay)
  return result
}
