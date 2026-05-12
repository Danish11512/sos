/**
 * LinkedIn-specific pipeline: URL-based filter navigation + DOM toggle application.
 *
 * Navigation Strategy (URL-first, no page reloads):
 *   - Search terms: URL navigation to search results page with keyword
 *   - URL filters (f_AL, f_E, f_JT, f_WT, f_TPR, f_SB2): Embedded directly in the
 *     navigation URL via buildFilterUrl — no separate DOM filter dropdown interaction
 *   - Filter-bar toggles (under10Applicants, inYourNetwork): Direct radio/checkbox
 *     toggles in the search results filter bar (NOT the "All filters" modal)
 *   - DOM-only toggle (fairChanceEmployer): "All filters" modal via toggleCheckboxItems
 *
 * Wait Strategy (no time-based delays):
 *   - All waits use MutationObserver-based waitForCondition() instead of delay()
 *   - We wait for specific DOM conditions (cards appeared, modal opened, etc.)
 *   - Only exception: randomDelay(1000, 2000) between jobs for visual feedback
 *
 * Easy Apply Strategy:
 *   - Easy Apply toggle is ALWAYS enabled (mandatory, set as f_AL=true in URL)
 *   - Each job listing is checked for Easy Apply button in the detail panel
 *   - External apply jobs are skipped
 */


import type { SiteSettings, FilterSettings } from "../settings/sections"
import type { ApplyFiltersResult, ApplyToJobResult, JobPreview, ModalResult } from "./types"
import {
  checkCompanyList,
  extractSalary,
  validateJobForApplication,
} from "./job-validator"

import {
  waitForElement,
  scrollAndClick,
  getVisibleText,
  toggleCheckboxItems,
  findButtonByText,
  pushStateNavigate,
  setReactInputValue,
  dispatchEnterKey,
  waitForCondition,
  randomDelay,
  detectAntiBotInterstitial,
  isLinkedInLoggedIn,
  detectExternalApply,
  retryApply,
  delay,
} from "../utils/dom"

import {
  GLOBAL_SEARCH_SELECTOR,
  SEMANTIC_SEARCH_SELECTOR,
  SEARCH_INPUT_SELECTOR,
  CARD_SELECTOR,
  DETAIL_PANEL_SELECTOR,
  LIST_SCROLLER_SELECTOR,
  EASY_APPLY_MODAL_SELECTOR,
  DATE_POSTED_VALUES,
  SORT_VALUES,
  IN_YOUR_NETWORK_RADIO_SELECTOR,
  UNDER_10_APPLICANTS_SELECTOR,
  ALL_FILTERS_BUTTON_SELECTORS,
  SHOW_RESULTS_BUTTON_SELECTORS,
  DESCRIPTION_CONTENT_SELECTOR,
  SHOW_MORE_BUTTON_SELECTOR,
  EMPTY_STATE_SELECTOR,
  DATE_POSTED_MAP,
  EXPERIENCE_MAP,
  JOB_TYPE_MAP,
  ON_SITE_MAP,
  SORT_MAP,
  FILTER_URL_PARAMS,
  LINKEDIN_JOBS_SEARCH_RESULTS_URL,
  NEW_CARD_TITLE_SELECTOR,
  NEW_CARD_COMPANY_SELECTOR,
  NEW_CARD_LOCATION_SELECTOR,
  NEW_LIST_COLUMN_SELECTOR,
  NEW_DETAIL_COLUMN_SELECTOR,
  SEARCH_RESULTS_FILTER_BAR,
} from "./linkedin-constants"

import { fillEasyApplyModal, clickEasyApplyButton, closeEasyApplyModal } from "./easy-apply-modal"
import { savePipelineState, clearPipelineState, saveResumeState, clearResumeState } from "../utils/storage"


/* ── Condition helpers ── */

/**
 * Wait for job cards to appear in the results list (or empty state).
 * Used after search navigation and filter application.
 */
async function waitForResults(timeoutMs = 15_000, signal?: AbortSignal): Promise<void> {
  await waitForCondition(
    () => {
      const cards = document.querySelectorAll(CARD_SELECTOR)
      const empty = document.querySelector(EMPTY_STATE_SELECTOR)
      return cards.length > 0 || empty !== null
    },
    { timeoutMs, signal }
  )
}

/**
 * Wait for the detail panel to load with content matching the expected job title.
 * This prevents reading stale content from a previously selected job.
 */
async function waitForDetailPanel(
  expectedTitle: string,
  timeoutMs = 10_000,
  signal?: AbortSignal
): Promise<Element | null> {
  try {
    await waitForCondition(
      () => {
        const panel = document.querySelector(DETAIL_PANEL_SELECTOR)
        if (!panel) return false
        // Check that the detail panel has actual text content
        const text = (panel.textContent || "").trim()
        if (text.length < 50) return false
        // Check that the title matches (avoids stale content from previous job)
        const titleMatch = text.toLowerCase().includes(expectedTitle.toLowerCase())
        return titleMatch
      },
      { timeoutMs, signal }
    )
    return document.querySelector(DETAIL_PANEL_SELECTOR)
  } catch {
    return null
  }
}

/* ── Easy Apply: Validate + fill modal (combined) ── */

/**
 * Apply to a job: validate against ALL user filter criteria, then open the
 * Easy Apply modal and fill/submit it automatically.
 *
 * Easy Apply check is always performed (mandatory).
 */
export async function applyToJob(
  job: JobPreview,
  description: string,
  filters: FilterSettings,
  detailPanel: Element,
  signal?: AbortSignal,
  site?: SiteSettings,
  onProgress?: (msg: string) => void
): Promise<ApplyToJobResult> {
  signal?.throwIfAborted()

  // Step 1: Validate the job against ALL user filter criteria
  const isValid = validateJobForApplication(
    job.company,
    job.title,
    description,
    filters
  )

  if (!isValid) {
    console.log(
      `[SOS] Skipping "${job.title}" @ "${job.company}" — failed filter validation`
    )
    return {
      applied: false,
      reason: `Failed filter validation: "${job.title}" @ "${job.company}"`,
    }
  }

  // Check salary filter
  if (filters.salary) {
    const minSalary = parseFloat(filters.salary.replace(/[^0-9.]/g, ""))
    if (!isNaN(minSalary) && minSalary > 0) {
      const jobSalary = extractSalary(description)
      if (jobSalary > 0 && jobSalary < minSalary) {
        console.log(
          `[SOS] Skipping "${job.title}" @ "${job.company}" — salary $${jobSalary} below minimum $${minSalary}`
        )
        return {
          applied: false,
          reason: `Salary $${jobSalary} below minimum $${minSalary}: "${job.title}" @ "${job.company}"`,
        }
      }
    }
  }

  console.log(
    `[SOS] Job "${job.title}" @ "${job.company}" passed all criteria — clicking Easy Apply`
  )

  // Step 2: Check for external apply (always — Easy Apply is mandatory)
  const externalUrl = detectExternalApply(detailPanel)
  if (externalUrl) {
    console.log(`[SOS] Skipping "${job.title}" — external apply (Easy Apply is mandatory)`)
    return {
      applied: false,
      reason: `External apply: "${job.title}" @ "${job.company}"`,
    }
  }

  // Step 3: Click the Easy Apply button
  const modal = await clickEasyApplyButton(detailPanel, signal)

  if (!modal) {
    return {
      applied: false,
      reason: `Easy Apply button not found or modal did not appear for "${job.title}" @ "${job.company}"`,
    }
  }

  // Step 4: Fill and submit the modal (if site settings provided)
  if (site) {
    onProgress?.(`Filling application for ${job.title} @ ${job.company}...`)
    const modalResult: ModalResult = await fillEasyApplyModal(
      modal,
      site,
      signal,
      onProgress
    )

    switch (modalResult.status) {
      case "success":
        console.log(`[SOS] LinkedIn: ${modalResult.reason}`)
        return {
          applied: true,
          reason: `Applied to "${job.title}" @ "${job.company}"`,
        }

      case "dailyLimitReached":
        console.warn(`[SOS] LinkedIn: ${modalResult.reason}`)
        return {
          applied: false,
          reason: `Daily limit reached: "${job.title}" @ "${job.company}"`,
        }

      case "failed":
        console.warn(`[SOS] LinkedIn: ${modalResult.reason}`)
        return {
          applied: false,
          reason: `Failed: ${modalResult.reason} for "${job.title}" @ "${job.company}"`,
        }

      case "skipped":
        console.log(`[SOS] LinkedIn: ${modalResult.reason}`)
        return {
          applied: false,
          reason: `Skipped: ${modalResult.reason} for "${job.title}" @ "${job.company}"`,
        }
    }
  }

  return {
    applied: true,
    reason: `Modal opened for "${job.title}" @ "${job.company}"`,
  }
}

/* ── Navigation: Search Term (multi-strategy) ── */

/**
 * Type a value into an input element with full React/SPA compatibility.
 * Dispatches focus, input, change, blur events after setting the native value.
 */
function typeIntoInput(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  input.focus()
  input.click()
  setReactInputValue(input, value)
}

/**
 * Submit a search by dispatching Enter key and also trying form submit.
 * Some SPA frameworks need the form submit event in addition to keyboard events.
 *
 * On current LinkedIn (May 2026), the global search bar typeahead intercepts the
 * Enter key for its own functionality — pressing Enter no longer triggers navigation.
 * This function now also attempts to click a typeahead suggestion item as a fallback.
 *
 * @returns true if the search successfully navigated to the jobs search page
 */
async function submitSearch(input: Element, signal?: AbortSignal): Promise<boolean> {
  // 1. Dispatch Enter key events (may work on some LinkedIn layouts)
  dispatchEnterKey(input)

  // 2. Also try to submit the parent form if it exists
  const form = input.closest("form")
  if (form) {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  }

  // 3. Try clicking any visible search/submit button near the input
  const container = input.closest("div, nav, header, form")
  if (container) {
    const searchBtn = container.querySelector<HTMLElement>(
      "button[type='submit'], " +
      "button[aria-label*='Search'], " +
      "button[aria-label*='search'], " +
      "button.search-global-typeahead__search-button"
    )
    if (searchBtn) {
      searchBtn.click()
    }
  }

  // 4. If we're ALREADY on a jobs page (semantic/jobs search bars), Enter key behavior
  //    still works — no need for the typeahead fallback. Just return false and let the
  //    caller (searchViaSemanticBar / searchViaJobsBar) handle result waiting.
  const isAlreadyOnJobsPage = window.location.href.includes("/jobs/")
  if (isAlreadyOnJobsPage) {
    return false
  }

  // 5. Wait briefly and check if Enter + form submit navigated us to /jobs/
  try {
    await delay(1500, signal)
    if (window.location.href.includes("/jobs/")) {
      return true
    }
  } catch {
    return false
  }

  // 6. Enter didn't work — try clicking a typeahead suggestion item.
  //    LinkedIn's global search bar typeahead requires clicking one of the suggestion
  //    items (like the 'Jobs' filter button) to navigate to search results.
  try {
    const typeahead = document.querySelector(
      "[data-test-typeahead], " +
      ".search-global-typeahead__typeahead, " +
      "div[role='listbox']"
    )
    if (typeahead) {
      const suggestions = typeahead.querySelectorAll<HTMLElement>(
        "a[role='radio'], " +
        "div[role='button'][tabindex='0'], " +
        "a[role='link'], " +
        "li[role='option']"
      )
      for (const suggestion of suggestions) {
        const text = suggestion.textContent?.trim().toLowerCase() || ""
        // Look for any suggestion that mentions 'search' or 'jobs'
        if (text.includes("search") || text.includes("jobs")) {
          scrollAndClick(suggestion)
          // Wait for URL to change to /jobs/
          try {
            await waitForCondition(
              () => window.location.href.includes("/jobs/"),
              { timeoutMs: 5_000, signal, pollIntervalMs: 200 }
            )
            return true
          } catch {
            // This suggestion didn't trigger navigation — try the next one
            continue
          }
        }
      }
    }
  } catch {
    // Typeahead suggestion clicking failed — fall through to return false
  }

  return false
}

/**
 * Strategy 1: Use LinkedIn's global search bar (top nav, present on ALL pages).
 * Types the job title, then clicks the "Jobs" filter button in the typeahead dropdown
 * to navigate to the jobs search results page.
 *
 * IMPORTANT: Clicking the "Jobs" radio button causes a FULL PAGE REFRESH.
 * Before clicking, we save resume state to storage so the pipeline can
 * continue automatically after the page reloads.
 */
async function searchViaGlobalBar(
  term: string,
  signal?: AbortSignal,
  /** SiteSettings to save for resume after page refresh. */
  site?: SiteSettings,
  /** Current term index for resume. */
  termIdx?: number
): Promise<boolean> {
  console.log("[SOS] LinkedIn: Trying global search bar...")

  const input = await waitForElement<HTMLInputElement>(GLOBAL_SEARCH_SELECTOR, 5_000, signal)
  if (!input) {
    console.log("[SOS] LinkedIn: Global search bar not found")
    return false
  }

  console.log("[SOS] LinkedIn: Found global search bar")

  // Clear and type the term
  typeIntoInput(input, term)

  // Wait for the typeahead dropdown to appear (MutationObserver-based, no fixed delay)
  // The dropdown appears as a positioned panel below the search bar after typing
  let typeaheadDropdown: Element | null = null
  try {
    // Scope the search to the nav/header area where the global search bar lives
    const navContainer = input.closest("nav, header, #global-nav-search, form")
    await waitForCondition(
      () => {
        if (!navContainer) return false
        // The typeahead dropdown may be inside the nav or as a sibling
        return (
          navContainer.querySelector(
            "div[role='listbox'], " +
            "[data-test-typeahead], " +
            ".search-global-typeahead__typeahead"
          ) !== null ||
          (navContainer.parentElement?.querySelector(
            "div[role='listbox'], " +
            "[data-test-typeahead], " +
            ".search-global-typeahead__typeahead"
          ) ?? null) !== null
        )
      },
      { timeoutMs: 3_000, signal, pollIntervalMs: 100 }
    )
    // Found — resolve the dropdown element
    typeaheadDropdown =
      navContainer?.querySelector(
        "div[role='listbox'], " +
        "[data-test-typeahead], " +
        ".search-global-typeahead__typeahead"
      ) ??
      navContainer?.parentElement?.querySelector(
        "div[role='listbox'], " +
        "[data-test-typeahead], " +
        ".search-global-typeahead__typeahead"
      ) ??
      null
  } catch {
    // No dropdown appeared (e.g., already on a jobs search results page,
    // or LinkedIn's SPA didn't render the typeahead)
    console.log("[SOS] LinkedIn: Typeahead dropdown did not appear — returning false")
    return false
  }

  // Find the "Jobs" filter button WITHIN the typeahead dropdown
  // Strategy: look for any clickable element whose inner content/text indicates "Jobs"
  let jobsBtn: HTMLElement | null = null

  if (typeaheadDropdown) {
    // Find the element within the dropdown whose text/label mentions "Jobs"
    const allCandidates = typeaheadDropdown.querySelectorAll<HTMLElement>(
      "div[role='button'], " +
      "a[role='radio'], " +
      "a[aria-label*='Jobs'], " +
      "a[aria-label*='jobs'], " +
      "div[role='button'][tabindex='0']"
    )

    for (const candidate of Array.from(allCandidates)) {
      const text = candidate.textContent?.toLowerCase() || ""
      const label = candidate.getAttribute("aria-label")?.toLowerCase() || ""
      // Use includes() instead of === because the outer button contains
      // nested SVG icons, hidden text, and whitespace
      if (text.includes("jobs") || label.includes("jobs")) {
        jobsBtn = candidate
        break
      }
    }

    // Fallback: check any descendant element with "Jobs" text
    if (!jobsBtn) {
      const jobsLabel = typeaheadDropdown.querySelector<HTMLElement>(
        "[aria-label*='Jobs'], " +
        "[aria-label*='jobs'], " +
        "span:not([aria-hidden]), div:not([role='button'])"
      )
      if (jobsLabel) {
        const labelText = jobsLabel.textContent?.toLowerCase() || ""
        const labelAttr = jobsLabel.getAttribute("aria-label")?.toLowerCase() || ""
        if (labelText.includes("jobs") || labelAttr.includes("jobs")) {
          // Walk up to find the clickable ancestor
          const clickable = jobsLabel.closest<HTMLElement>(
            "div[role='button'], a[role='radio']"
          )
          if (clickable) jobsBtn = clickable
        }
      }
    }
  }


  if (jobsBtn) {
    console.log("[SOS] LinkedIn: Clicking 'Jobs' filter in typeahead dropdown")

    // Save resume state BEFORE clicking — this click causes a full page refresh
    if (site && termIdx !== undefined) {
      await saveResumeState({
        searchTerm: term,
        siteSettings: site as unknown as Record<string, unknown>,
        termIndex: termIdx,
        timestamp: Date.now(),
      })
      console.log("[SOS] LinkedIn: Saved resume state before page refresh")
    }

    scrollAndClick(jobsBtn)
  } else {
    console.log("[SOS] LinkedIn: 'Jobs' filter not found in typeahead — attempting fallback search strategies")
    const submitted = await submitSearch(input, signal)

    if (submitted) {
      // submitSearch already confirmed URL changed to /jobs/
      console.log("[SOS] LinkedIn: Fallback search navigated to jobs page")
      return true
    }

    // submitSearch confirmed it couldn't navigate — short-circuit the 10s wait
    // so navigateToSearchTerm proceeds to Strategy 4 (URL navigation) faster
    console.log("[SOS] LinkedIn: Fallback search did not navigate — trying next strategy")
    return false
  }

  // Wait for URL to change to jobs search results
  // Note: When jobsBtn was found and clicked (above), execution continues here.
  // The click may cause a full page refresh, so this wait is still needed for that path.
  try {
    await waitForCondition(
      () => window.location.href.includes("/jobs/"),
      { timeoutMs: 10_000, signal, pollIntervalMs: 200 }
    )
    console.log("[SOS] LinkedIn: Global search navigated to jobs page")
    return true
  } catch {
    console.log("[SOS] LinkedIn: Global search did not navigate to jobs page")
    return false
  }
}

/**
 * Strategy 2: Use LinkedIn's new semantic job search input (on jobs pages).
 * This is LinkedIn's AI-powered search with placeholder "Describe the job you want".
 * Uses data-testid="typeahead-input" and componentkey="semanticSearchBox".
 */
async function searchViaSemanticBar(term: string, signal?: AbortSignal): Promise<boolean> {
  console.log("[SOS] LinkedIn: Trying semantic search bar...")

  const input = await waitForElement<HTMLInputElement>(SEMANTIC_SEARCH_SELECTOR, 5_000, signal)
  if (!input) {
    console.log("[SOS] LinkedIn: Semantic search bar not found")
    return false
  }

  console.log("[SOS] LinkedIn: Found semantic search bar")

  // Clear and type the term
  typeIntoInput(input, term)

  // Submit the search
  await submitSearch(input, signal)

  // Wait for results to appear (cards or empty state)
  try {
    await waitForResults(15_000, signal)
    console.log("[SOS] LinkedIn: Semantic search returned results")
    return true
  } catch {
    console.log("[SOS] LinkedIn: Semantic search did not return results")
    return false
  }
}

/**
 * Strategy 3: Use LinkedIn's jobs-specific search bar (only on /jobs/ pages).
 * This is used when we're already on a jobs page.
 */
async function searchViaJobsBar(term: string, signal?: AbortSignal): Promise<boolean> {
  console.log("[SOS] LinkedIn: Trying jobs-specific search bar...")

  const input = await waitForElement<HTMLInputElement>(SEARCH_INPUT_SELECTOR, 5_000, signal)
  if (!input) {
    console.log("[SOS] LinkedIn: Jobs search bar not found")
    return false
  }

  console.log("[SOS] LinkedIn: Found jobs search bar")

  // Clear and type the term
  typeIntoInput(input, term)

  // Submit the search
  await submitSearch(input, signal)

  // Wait for results to appear (cards or empty state)
  try {
    await waitForResults(15_000, signal)
    console.log("[SOS] LinkedIn: Jobs search returned results")
    return true
  } catch {
    console.log("[SOS] LinkedIn: Jobs search did not return results")
    return false
  }
}

/**
 * Strategy 4: Navigate directly to the LinkedIn jobs search results URL
 * with all filter params included. This is the most reliable — always works.
 */
async function searchViaUrlNavigation(
  term: string,
  signal?: AbortSignal,
  site?: SiteSettings,
  overrides?: { datePosted?: string; sortBy?: string }
): Promise<void> {
  console.log("[SOS] LinkedIn: Navigating via search-results URL with filter params")

  const url = buildFilterUrl(LINKEDIN_JOBS_SEARCH_RESULTS_URL, site ?? {} as SiteSettings, overrides)
  url.searchParams.set("keywords", term)
  url.searchParams.set("sos_nav", "1")

  // Use pushStateNavigate first (no page reload)
  pushStateNavigate(url)

  // Wait for results
  try {
    await waitForResults(15_000, signal)
    console.log("[SOS] LinkedIn: URL navigation returned results")
    return
  } catch {
    // pushState didn't work — do a full page navigation
    console.log("[SOS] LinkedIn: pushState navigation failed — doing full page load")
  }

  // Full page navigation as last resort
  window.location.href = url.toString()

  // This will cause a page reload, so we throw to stop execution
  throw new Error(`Navigating to jobs search page for "${term}" — page will reload`)
}

/**
 * Navigate to a new search term.
 *
 * Strategy (URL-first, per user request):
 *   1. Navigate directly to the search-results URL with the keyword
 *   2. If already on a jobs search results page, update keyword param via pushState
 *   3. Try the jobs-specific search bar (on /jobs/ pages) for refinement
 *   4. Try LinkedIn's semantic search bar (AI-powered, on jobs pages)
 *   5. Fall back to global search bar (top nav)
 *
 * "One change. Instead of typing in the search bar in the beginning, let's
 *  first route to the link that I gave you. And then we can type in the
 *  search bar to have the jobs button automatically be clicked."
 *
 * Uses waitForCondition to confirm the input value was set before dispatching Enter.
 * Uses waitForResults to wait for cards or empty state after search.
 *
 * @param site - SiteSettings (needed for resume state before page refresh)
 * @param termIdx - Current term index (needed for resume state)
 * @param overrides - Optional date/sort cycling overrides to embed in the URL
 */
export async function navigateToSearchTerm(
  term: string,
  signal?: AbortSignal,
  site?: SiteSettings,
  termIdx?: number,
  overrides?: { datePosted?: string; sortBy?: string }
): Promise<void> {
  console.log(`[SOS] LinkedIn: Navigating to search term "${term}"`)

  // Guard: If already on a LinkedIn jobs search results page (any /jobs/search* URL),
  // update keyword param AND filter params via pushState instead of navigating again.
  const currentUrl = window.location.href.toLowerCase()
  const onJobsSearchResults = currentUrl.includes("/jobs/search/") ||
    currentUrl.includes("/jobs/search-results/") ||
    (currentUrl.includes("/jobs/") && currentUrl.includes("keywords="))

  if (onJobsSearchResults) {
    console.log("[SOS] LinkedIn: Already on jobs search results page — building filter URL with keyword")
    try {
      const url = buildFilterUrl(window.location.href, site ?? {} as SiteSettings, overrides)
      url.searchParams.set("keywords", term)
      pushStateNavigate(url)
      await waitForResults(10_000, signal)
      return
    } catch (err) {
      console.warn("[SOS] LinkedIn: URL param update failed — falling back to search strategies", err)
    }
  }

  // Strategy 1 (NEW PRIMARY): Navigate directly to the search-results URL with all filter params
  // This avoids the fragile global search bar typeahead and full page refreshes.
  try {
    await searchViaUrlNavigation(term, signal, site, overrides)
    return
  } catch (err) {
    // If searchViaUrlNavigation threw, it means it triggered a full page reload.
    // The pipeline will resume via the resume-state mechanism.
    if (err instanceof Error && err.message.includes("page will reload")) {
      throw err // Re-throw so runLinkedInPipeline handles resume correctly
    }
    console.warn("[SOS] LinkedIn: URL navigation failed — trying search bar fallbacks", err)
  }

  // Strategy 2: Jobs-specific search bar (on /jobs/ pages)
  const jobsResult = await searchViaJobsBar(term, signal)
  if (jobsResult) return

  // Strategy 3: Semantic search bar (AI-powered, on jobs pages)
  const semanticResult = await searchViaSemanticBar(term, signal)
  if (semanticResult) return

  // Strategy 4: Global search bar (works from ANY LinkedIn page — last resort)
  const globalResult = await searchViaGlobalBar(term, signal, site, termIdx)
  if (globalResult) return
}


/* ── Navigation: Filters (pushState+popstate) ── */

/**
 * Build a URL with filter params from the current URL + filter settings.
 * Cleans existing filter params and applies new ones.
 */
export function buildFilterUrl(
  baseUrl: string,
  site: SiteSettings,
  overrides?: { datePosted?: string; sortBy?: string }
): URL {
  const url = new URL(baseUrl)

  // Clean existing filter params
  for (const param of FILTER_URL_PARAMS) {
    url.searchParams.delete(param)
  }

  // Date Posted (f_TPR)
  const dateKey = (overrides?.datePosted || site.filters.datePosted || "").trim().toLowerCase()
  if (dateKey && DATE_POSTED_MAP[dateKey]) {
    url.searchParams.set("f_TPR", DATE_POSTED_MAP[dateKey])
  }

  // Sort By
  const sortKey = (overrides?.sortBy || site.filters.sortBy || "").trim().toLowerCase()
  if (sortKey && SORT_MAP[sortKey]) {
    url.searchParams.set("f_SB2", SORT_MAP[sortKey])
  }

  // Experience Level (f_E) — comma-separated
  if (site.filters.experienceLevel.length > 0) {
    const expValues = site.filters.experienceLevel
      .map((l) => EXPERIENCE_MAP[l.trim()])
      .filter(Boolean)
    if (expValues.length > 0) {
      url.searchParams.set("f_E", expValues.join(","))
    }
  }

  // Job Type (f_JT) — comma-separated
  if (site.filters.jobType.length > 0) {
    const jtValues = site.filters.jobType
      .map((jt) => JOB_TYPE_MAP[jt.trim()])
      .filter(Boolean)
    if (jtValues.length > 0) {
      url.searchParams.set("f_JT", jtValues.join(","))
    }
  }

  // On-site/Remote (f_WT) — comma-separated
  if (site.filters.onSite.length > 0) {
    const osValues = site.filters.onSite
      .map((os) => ON_SITE_MAP[os.trim()])
      .filter(Boolean)
    if (osValues.length > 0) {
      url.searchParams.set("f_WT", osValues.join(","))
    }
  }

  // Easy Apply (f_AL) — controlled by UI toggle
  if (site.filters.easyApplyOnly) {
    url.searchParams.set("f_AL", "true")
  }

  // Fair Chance Employer (f_FC) — optional toggle
  if (site.filters.fairChanceEmployer) {
    url.searchParams.set("f_FC", "true")
  }

  return url
}

/* ── \"In Your Network\" radio toggle (filter bar, NOT modal) ── */

/**
 * Toggle the "In Your Network" filter radio in the LinkedIn search results filter bar.
 * This is a direct radio toggle (NOT in the All Filters modal).
 *
 * DOM structure: div[role='radio'][aria-label='Filter by In my network']
 * Contains a checkbox input and label. Uses aria-checked for state.
 *
 * Standalone — works independently of the modal-based applyDomFilters.
 *
 * @param enabled - true to turn the filter ON, false to turn it OFF
 * @param signal  - Optional AbortSignal for cancellation
 * @returns true if the toggle was interacted with, false if not found or already in correct state
 */
export async function toggleInYourNetworkFilter(
  enabled: boolean,
  signal?: AbortSignal
): Promise<boolean> {
  // Find the radio toggle by selector (uses aria-label matching)
  const radio = document.querySelector<HTMLElement>(IN_YOUR_NETWORK_RADIO_SELECTOR)
  if (!radio) {
    console.warn('[SOS] LinkedIn: Could not find "In Your Network" radio toggle in filter bar')
    return false
  }

  // Check current state via aria-checked
  const isChecked = radio.getAttribute('aria-checked') === 'true'

  if (isChecked === enabled) {
    console.log(`[SOS] LinkedIn: "In Your Network" already ${enabled ? 'enabled' : 'disabled'} — no action needed`)
    return false
  }

  // Click to toggle
  scrollAndClick(radio)
  await delay(300, signal)
  console.log(`[SOS] LinkedIn: Toggled "In Your Network" ${enabled ? 'ON' : 'OFF'}`)
  return true
}

/* ── Filter bar toggles (under10Applicants, inYourNetwork) ── */

/**
 * Toggle the "Under 10 Applicants" filter bar radio/checkbox.
 * Similar to toggleInYourNetworkFilter — uses aria-checked and scrolling click.
 */
export async function toggleUnder10ApplicantsFilter(
  enabled: boolean,
  signal?: AbortSignal
): Promise<boolean> {
  const toggle = document.querySelector<HTMLElement>(UNDER_10_APPLICANTS_SELECTOR)
  if (!toggle) {
    console.warn('[SOS] LinkedIn: Could not find "Under 10 Applicants" toggle in filter bar')
    return false
  }

  const isChecked = toggle.getAttribute('aria-checked') === 'true'
  if (isChecked === enabled) {
    console.log(`[SOS] LinkedIn: "Under 10 Applicants" already ${enabled ? 'enabled' : 'disabled'} — no action needed`)
    return false
  }

  scrollAndClick(toggle)
  await delay(300, signal)
  console.log(`[SOS] LinkedIn: Toggled "Under 10 Applicants" ${enabled ? 'ON' : 'OFF'}`)
  return true
}

/**
 * Apply filter bar toggles for under10Applicants and inYourNetwork.
 * These are direct radio/checkbox toggles in the search results filter bar
 * (NOT in the "All Filters" modal). Called after navigateToSearchTerm.
 */
export async function applyFilterBarToggles(
  site: SiteSettings,
  signal?: AbortSignal
): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }

  // "In Your Network" — direct radio toggle in the filter bar
  if (site.filters.inYourNetwork) {
    try {
      const toggled = await toggleInYourNetworkFilter(true, signal)
      if (toggled) result.appliedCount++
    } catch (err) {
      result.errors.push(`inYourNetwork toggle failed: ${err}`)
    }
  }

  // "Under 10 Applicants" — direct radio/checkbox toggle in the filter bar
  if (site.filters.under10Applicants) {
    try {
      const toggled = await toggleUnder10ApplicantsFilter(true, signal)
      if (toggled) result.appliedCount++
    } catch (err) {
      result.errors.push(`under10Applicants toggle failed: ${err}`)
    }
  }

  if (result.errors.length > 0) {
    result.success = false
  }

  console.log(`[SOS] LinkedIn: Filter bar toggles applied (${result.appliedCount} toggled)`)
  return result
}

/* ── DOM-only filter application (post-nav, only fairChanceEmployer) ── */

/**
 * Apply DOM-only filters via the "All filters" modal.
 * Only handles fairChanceEmployer — under10Applicants and inYourNetwork are
 * handled via applyFilterBarToggles (filter bar radio/checkbox toggles).
 * Uses waitForElement (MutationObserver) instead of time-based delays.
 */
async function applyDomFilters(
  site: SiteSettings,
  clickDelayMs: number,
  signal?: AbortSignal
): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }

  // Only fairChanceEmployer goes through the "All filters" modal now
  const domFilters = [
    { enabled: site.filters.fairChanceEmployer, label: "Fair chance employer" },
  ]

  if (!domFilters.some((f) => f.enabled)) {
    console.log("[SOS] LinkedIn: No remaining DOM-only filters to apply via modal")
    return result
  }

  console.log("[SOS] LinkedIn: Opening 'All filters' modal for DOM-based filters")

  const allFiltersBtn =
    (await waitForElement(ALL_FILTERS_BUTTON_SELECTORS, 6_000, signal)) ??
    (() => {
      for (const btn of document.querySelectorAll("button")) {
        const text = btn.textContent?.trim().toLowerCase() || ""
        const ariaLabel = btn.getAttribute("aria-label")?.toLowerCase() || ""
        if (text.includes("all filters") || ariaLabel.includes("all filters") ||
            btn.hasAttribute("data-control-name")) {
          return btn
        }
      }
      return null
    })()

  if (!allFiltersBtn) {
    result.errors.push("Could not find 'All filters' button on LinkedIn")
    result.success = false
    console.warn("[SOS] LinkedIn: ⚠️ Could not find 'All filters' button — DOM-only filters will not be applied")
    return result
  }

  scrollAndClick(allFiltersBtn)

  // Wait for filter modal to appear (MutationObserver-based)
  let modalContainer = await waitForElement(
    ".jobs-search-all-filters__content, div[data-test-all-filters-modal]",
    6_000,
    signal
  )

  if (!modalContainer) {
    console.log("[SOS] LinkedIn: Filter modal did not appear — retrying click")
    scrollAndClick(allFiltersBtn)
    modalContainer = await waitForElement(
      ".jobs-search-all-filters__content, div[data-test-all-filters-modal]",
      6_000,
      signal
    )
  }

  if (!modalContainer) {
    result.errors.push("Could not find LinkedIn filter modal")
    result.success = false
    console.warn("[SOS] LinkedIn: ⚠️ Could not open filter modal — DOM-only filters skipped")
    return result
  }

  result.appliedCount += await toggleCheckboxItems(modalContainer, domFilters, clickDelayMs, signal)

  const applyBtn =
    (await waitForElement(SHOW_RESULTS_BUTTON_SELECTORS, 5_000, signal)) ??
    findButtonByText(modalContainer, "show results", "apply")

  if (applyBtn) {
    scrollAndClick(applyBtn)
    // Wait for results to update after applying DOM filters
    try {
      await waitForResults(8_000, signal)
    } catch {
      // Results might not change if no new data was fetched
    }
    console.log("[SOS] LinkedIn: Clicked 'Show results' to apply filters")
  } else {
    result.errors.push("Could not find 'Show results' button in filter modal")
    console.warn("[SOS] LinkedIn: ⚠️ Could not find 'Show results' button")
  }

  return result
}

/* ── Batch job card reading ── */

/** Extract title from a LinkedIn job card. Returns clean text without extra characters.
 *  Supports both old LinkedIn (anchor-based) and new CSS-module design (div[role='button']).
 *  Current LinkedIn CSS-module design (May 2026): title is in a <p> containing both a
 *  <span class='e94a47cd'> (screen-reader text) and a <span aria-hidden='true'> (visual text).
 *  We prefer the visual text (aria-hidden) to avoid screen-reader prefix noise. */
function extractCardTitle(card: HTMLElement): string {
  // Current LinkedIn CSS-module design: visual span with aria-hidden inside a p with span.e94a47cd sibling
  // This is more specific than the broad span[aria-hidden='true'] selector
  const visualTitle = card.querySelector<HTMLElement>(
    "p:has(> span.e94a47cd) span[aria-hidden='true']"
  )
  if (visualTitle?.textContent?.trim()) {
    return visualTitle.textContent.trim().replace(/\s+/g, " ")
  }

  // Fallback: use the general NEW_CARD_TITLE_SELECTOR (supports both old and new designs)
  const srTitle = card.querySelector<HTMLElement>(NEW_CARD_TITLE_SELECTOR)
  if (srTitle?.textContent?.trim()) {
    return srTitle.textContent.trim().replace(/\s+/g, " ")
  }

  // Old LinkedIn design: job card title link
  const titleEl = card.querySelector(
    ".job-card-list__title, " +
    ".job-card-container__link, " +
    ".artdeco-entity-lockup__title"
  )
  if (titleEl?.textContent?.trim()) {
    return titleEl.textContent.trim().replace(/\s+/g, " ")
  }

  // Fallback: use the full card text but only take the first meaningful line
  const raw = card.textContent?.trim() || ""
  // Take the first line or first sentence-like segment
  const firstLine = raw.split("\n").map((s) => s.trim()).filter(Boolean)[0] || raw
  return firstLine.replace(/\s+/g, " ").trim()
}

/** Extract company name from a LinkedIn job card. Returns clean text without extra characters.
 *  Supports both old LinkedIn (anchor-based) and new CSS-module design (div[role='button']). */
function extractCardCompany(card: HTMLElement): string {
  // New LinkedIn CSS-module design: company name in hashed-class p element
  const newCompany = card.querySelector<HTMLElement>(NEW_CARD_COMPANY_SELECTOR)
  if (newCompany?.textContent?.trim()) {
    return newCompany.textContent.trim().replace(/\s+/g, " ")
  }

  // Old LinkedIn design: direct card selectors
  const fromCard = card.querySelector(
    ".job-card-container__company-name, " +
    ".artdeco-entity-lockup__subtitle, " +
    ".job-card-list__company-name"
  )?.textContent?.trim()
  if (fromCard) return fromCard.replace(/\s+/g, " ")

  // Old LinkedIn design: parent container fallback
  const parent = card.closest("li, div, .job-card-container, .jobs-search-results__list-item")
  if (parent) {
    const fromParent = parent.querySelector<HTMLElement>(
      ".job-card-container__company-name, " +
      ".artdeco-entity-lockup__subtitle, " +
      ".job-card-list__company-name, " +
      ".artdeco-entity-lockup__caption"
    )?.textContent?.trim()
    if (fromParent) return fromParent.replace(/\s+/g, " ")
  }

  return "unknown"
}

/** Extract location from a LinkedIn job card.
 *  Supports both old LinkedIn (anchor-based) and new CSS-module design (div[role='button']). */
function extractCardLocation(card: HTMLElement): string {
  // New LinkedIn CSS-module design: location in hashed-class p element
  const newLocation = card.querySelector<HTMLElement>(NEW_CARD_LOCATION_SELECTOR)
  if (newLocation?.textContent?.trim()) {
    return newLocation.textContent.trim().replace(/\s+/g, " ")
  }

  // Old LinkedIn design: direct card selectors
  const fromCard = card.querySelector(
    ".job-card-container__metadata-item, " +
    ".artdeco-entity-lockup__caption, " +
    ".job-card-list__metadata-item"
  )?.textContent?.trim()
  if (fromCard) return fromCard

  // Old LinkedIn design: parent container fallback
  const parent = card.closest("li, div, .job-card-container, .jobs-search-results__list-item")
  if (parent) {
    const fromParent = parent.querySelector<HTMLElement>(
      ".job-card-container__metadata-item, " +
      ".artdeco-entity-lockup__caption, " +
      ".job-card-list__metadata-item"
    )?.textContent?.trim()
    if (fromParent) return fromParent
  }

  return ""
}

/**
 * Wait for at least one job card to appear in the DOM, using MutationObserver.
 * Supports both old LinkedIn (anchor-based) and new CSS-module design (div[role='button']).
 */
async function waitForJobCards(timeoutMs = 15_000, signal?: AbortSignal): Promise<HTMLElement[] | null> {
  const existing = document.querySelectorAll<HTMLElement>(CARD_SELECTOR)
  if (existing.length > 0) return Array.from(existing)
  if (signal?.aborted) return null

  return new Promise((resolve) => {
    function onAbort(): void {
      observer.disconnect()
      clearTimeout(timer)
      resolve(null)
    }

    const observer = new MutationObserver(() => {
      const cards = document.querySelectorAll<HTMLElement>(CARD_SELECTOR)
      if (cards.length > 0) {
        observer.disconnect()
        if (signal) signal.removeEventListener("abort", onAbort)
        clearTimeout(timer)
        resolve(Array.from(cards))
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
    }

    const timer = setTimeout(() => {
      observer.disconnect()
      if (signal) signal.removeEventListener("abort", onAbort)
      const cards = document.querySelectorAll<HTMLElement>(CARD_SELECTOR)
      resolve(cards.length > 0 ? Array.from(cards) : null)
    }, timeoutMs)
  })
}

/**
 * Wait for the search results page to finish loading by checking for the
 * search results filter bar (Jobs, Posts, Courses toggles) and job cards.
 * Current LinkedIn CSS-module design: div[role='button'][tabindex='0'] with
 * checkbox-style toggles. Old design used a[role='radio'] links.
 */
async function waitForSearchResultsPageReady(timeoutMs = 15_000, signal?: AbortSignal): Promise<boolean> {
  try {
    // Wait for either the search results filter bar OR job cards to appear
    await waitForCondition(
      () => {
        const filterBar = document.querySelector(SEARCH_RESULTS_FILTER_BAR)
        const cards = document.querySelectorAll(CARD_SELECTOR)
        return (filterBar !== null) || (cards.length > 0)
      },
      { timeoutMs, signal, pollIntervalMs: 200 }
    )
    return true
  } catch {
    return false
  }
}

/**
 * Read job cards currently rendered in the list view.
 * No scrolling — just reads whatever cards are currently visible in the DOM.
 * After filters are applied, the first job is immediately clickable.
 * Supports both old LinkedIn (anchor-based) and new CSS-module design (div[role='button']).
 */
export async function readAllJobPreviews(maxCards: number, signal?: AbortSignal): Promise<JobPreview[]> {
  const cardLinks = await waitForJobCards(15_000, signal)
  if (!cardLinks || cardLinks.length === 0) return []

  const readLimit = Math.min(cardLinks.length, maxCards)
  const previews: JobPreview[] = []

  for (let i = 0; i < readLimit; i++) {
    signal?.throwIfAborted()
    const card = cardLinks[i]
    if (!card) continue

    // Extract job ID from various possible attributes
    const jobId =
      card.getAttribute("data-occludable-job-id") ||
      card.closest("[data-occludable-job-id]")?.getAttribute("data-occludable-job-id") ||
      card.getAttribute("componentkey") || // New LinkedIn design uses componentkey
      card.getAttribute("href")?.match(/\/jobs\/view\/(\d+)/)?.[1] ||
      `fallback-${i}`

    // Extract URL: new design cards are div[role='button'] (not anchors), old design are anchors
    const href =
      (card instanceof HTMLAnchorElement ? card.href : "") ||
      card.querySelector("a")?.getAttribute("href") ||
      card.getAttribute("href") ||
      ""

    previews.push({
      title: extractCardTitle(card),
      company: extractCardCompany(card),
      location: extractCardLocation(card),
      url: href,
      element: card,
      jobId,
    })
  }

  console.log(`[SOS] LinkedIn: Read ${previews.length} job previews (no scrolling)`)
  return previews
}

/* ── Filter job previews ── */

/**
 * Filter job previews by company allow/block list.
 */
export function filterJobPreviews(
  previews: JobPreview[],
  companies: string[]
): JobPreview[] {
  if (!companies || companies.length === 0) return previews

  const filtered = previews.filter((p) => checkCompanyList(p.company, companies))
  const removed = previews.length - filtered.length
  if (removed > 0) {
    console.log(`[SOS] LinkedIn: Filtered out ${removed} jobs by company list`)
  }
  return filtered
}

/* ── Scroll to next job card ── */

/**
 * Scroll the job list sidebar to bring the next job card into view.
 * Uses the list scroller element if available, otherwise scrolls the window.
 */
async function scrollToNextJob(nextCard: HTMLElement, signal?: AbortSignal): Promise<void> {
  const scroller = document.querySelector(LIST_SCROLLER_SELECTOR)
  if (scroller) {
    // Scroll the list scroller to bring the next card into view
    nextCard.scrollIntoView({ behavior: "smooth", block: "nearest" })
  } else {
    // Fallback: scroll the window
    nextCard.scrollIntoView({ behavior: "smooth", block: "center" })
  }
  // Brief wait for scroll animation
  await randomDelay(500, 1000, signal)
}

/* ── Read job description ── */

/**
 * Read the full job description from the detail panel.
 * Uses waitForDetailPanel to wait for the panel to load with matching content.
 * Uses waitForCondition to wait for "Show more" expansion instead of delay().
 */
export async function readJobDescription(
  job: JobPreview,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()

  // Click the job card to load its detail panel
  if (job.element) {
    scrollAndClick(job.element)
  }

  // Wait for the detail panel to appear with content matching this job's title
  const detailPanel = await waitForDetailPanel(job.title, 10_000, signal)
  if (!detailPanel) {
    console.warn("[SOS] LinkedIn: Could not find detail panel for job")
    return ""
  }

  // Wait for description content element
  const descriptionContent = await waitForElement(
    DESCRIPTION_CONTENT_SELECTOR,
    8_000,
    signal
  )

  if (!descriptionContent) {
    console.warn("[SOS] LinkedIn: Could not find description content element")
    return ""
  }

  // Click "Show more" button to expand full description
  const showMoreBtn = descriptionContent.querySelector<HTMLElement>(SHOW_MORE_BUTTON_SELECTOR)
  if (showMoreBtn) {
    const beforeLen = (descriptionContent.textContent || "").length
    scrollAndClick(showMoreBtn)

    // Wait for description text to grow (mutation-based)
    try {
      await waitForCondition(
        () => {
          const current = document.querySelector(DESCRIPTION_CONTENT_SELECTOR)
          return current !== null && (current.textContent || "").length > beforeLen + 20
        },
        { timeoutMs: 5_000, signal }
      )
    } catch {
      // "Show more" might not have expanded — continue with what we have
    }
  }

  // Check for iframes in the description
  const iframe = descriptionContent.querySelector("iframe")
  if (iframe) {
    console.log("[SOS] LinkedIn: Description contains iframe — attempting to extract content")
    try {
      // Try to get content from iframe's srcdoc or src
      const srcDoc = iframe.getAttribute("srcdoc")
      if (srcDoc) {
        console.log("[SOS] LinkedIn: Extracted content from iframe srcdoc")
        return getVisibleText(descriptionContent) + "\n\n[iframe content]: " + srcDoc
      }
    } catch (e) {
      console.warn("[SOS] LinkedIn: Failed to extract iframe content:", e)
    }
  }

  // Return the visible text from the description
  const text = getVisibleText(descriptionContent)
  console.log(`[SOS] LinkedIn: Read job description (${text.length} chars)`)
  return text
}

/* ── Test functions for each pipeline step ── */

export async function testNavigateToSearchTerm(term: string): Promise<boolean> {
  console.log(`[SOS TEST] Testing navigateToSearchTerm("${term}")...`)
  try {
    const input = await waitForElement<HTMLInputElement>(SEARCH_INPUT_SELECTOR, 5_000)
    if (!input) {
      console.error("[SOS TEST] FAIL: Could not find search input")
      return false
    }
    console.log("[SOS TEST] PASS: Found search input")

    input.focus()
    input.click()
    setReactInputValue(input, "")
    console.log("[SOS TEST] PASS: Cleared search input")

    setReactInputValue(input, term)
    console.log(`[SOS TEST] PASS: Set input value to "${term}"`)

    dispatchEnterKey(input)
    console.log("[SOS TEST] PASS: Dispatched Enter key")

    console.log("[SOS TEST] ✓ navigateToSearchTerm works (results may take a moment)")
    return true
  } catch (err) {
    console.error("[SOS TEST] FAIL: navigateToSearchTerm threw:", err)
    return false
  }
}

/**
 * Test: buildFilterUrl
 * Verifies that filter URL params are correctly built from site settings.
 * Usage: call from browser console with a mock site object:
 *   testBuildFilterUrl({ filters: { datePosted: "past 24 hours", ... } })
 */
export function testBuildFilterUrl(site: SiteSettings): boolean {
  console.log("[SOS TEST] Testing buildFilterUrl...")
  try {
    const url = buildFilterUrl(window.location.href, site, undefined)
    console.log(`[SOS TEST] Built filter URL: ${url.toString()}`)

    // Verify Easy Apply is always set
    if (url.searchParams.get("f_AL") === "true") {
      console.log("[SOS TEST] PASS: Easy Apply (f_AL) is set to true")
    } else {
      console.warn("[SOS TEST] WARN: Easy Apply (f_AL) not set")
    }

    if (site.filters.datePosted) {
      const val = url.searchParams.get("f_TPR")
      console.log(`[SOS TEST] Date posted (f_TPR): ${val || "not set"}`)
    }
    if (site.filters.sortBy) {
      const val = url.searchParams.get("f_SB2")
      console.log(`[SOS TEST] Sort by (f_SB2): ${val || "not set"}`)
    }

    console.log("[SOS TEST] ✓ buildFilterUrl completed")
    return true
  } catch (err) {
    console.error("[SOS TEST] FAIL: buildFilterUrl threw:", err)
    return false
  }
}

/**
 * Test: applyDomFilters
 * Verifies the "All filters" modal can be opened, checkboxes toggled, and results applied.
 * "In Your Network" is handled via the filter-bar radio toggle (not in the modal).
 * Usage: call from browser console:
 *   testApplyDomFilters({ filters: { under10Applicants: true, inYourNetwork: true, fairChanceEmployer: true } })
 */
export async function testApplyDomFilters(site: SiteSettings): Promise<boolean> {
  console.log("[SOS TEST] Testing applyDomFilters...")
  try {
    const result = await applyDomFilters(site, 300, undefined)
    if (result.success) {
      console.log(`[SOS TEST] PASS: DOM filters applied (${result.appliedCount} toggled)`)
      if (site.filters.fairChanceEmployer) {
        console.log("[SOS TEST]   - Fair chance employer was requested (check filter bar or modal)")
      }
    } else {
      console.warn("[SOS TEST] WARN: DOM filters had errors:", result.errors)
    }
    console.log("[SOS TEST] ✓ applyDomFilters completed")
    return result.success
  } catch (err) {
    console.error("[SOS TEST] FAIL: applyDomFilters threw:", err)
    return false
  }
}

/**
 * Test: readAllJobPreviews
 * Verifies job cards can be read from the current results list.
 * Usage: call from browser console: testReadJobPreviews()
 */
export async function testReadJobPreviews(): Promise<boolean> {
  console.log("[SOS TEST] Testing readAllJobPreviews...")
  try {
    const previews = await readAllJobPreviews(10, undefined)
    if (previews.length === 0) {
      console.warn("[SOS TEST] WARN: No job previews found (may need to search first)")
      return false
    }
    console.log(`[SOS TEST] PASS: Read ${previews.length} job previews`)
    for (const p of previews.slice(0, 3)) {
      console.log(`  - "${p.title}" @ "${p.company}" (${p.location})`)
    }
    if (previews.length > 3) {
      console.log(`  ... and ${previews.length - 3} more`)
    }
    console.log("[SOS TEST] ✓ readAllJobPreviews works")
    return true
  } catch (err) {
    console.error("[SOS TEST] FAIL: readAllJobPreviews threw:", err)
    return false
  }
}

/**
 * Test: readJobDescription
 * Verifies a job card can be clicked and its description read from the detail panel.
 * Usage: call from browser console after testReadJobPreviews:
 *   testReadJobDescription(previews[0])
 */
export async function testReadJobDescription(job: JobPreview): Promise<boolean> {
  console.log(`[SOS TEST] Testing readJobDescription for "${job.title}" @ "${job.company}"...`)
  try {
    const description = await readJobDescription(job, undefined)
    if (!description) {
      console.error("[SOS TEST] FAIL: Could not read job description")
      return false
    }
    console.log(`[SOS TEST] PASS: Read description (${description.length} chars)`)
    console.log(`[SOS TEST] Description preview: "${description.slice(0, 200)}..."`)
    console.log("[SOS TEST] ✓ readJobDescription works")
    return true
  } catch (err) {
    console.error("[SOS TEST] FAIL: readJobDescription threw:", err)
    return false
  }
}

/**
 * Test: applyToJob
 * Verifies the Easy Apply flow for a given job (validation + modal).
 * Usage: call from browser console after testReadJobDescription:
 *   testApplyToJob(job, description, site.filters, detailPanel)
 */
export async function testApplyToJob(
  job: JobPreview,
  description: string,
  filters: FilterSettings,
  detailPanel: Element
): Promise<boolean> {
  console.log(`[SOS TEST] Testing applyToJob for "${job.title}" @ "${job.company}"...`)
  try {
    const result = await applyToJob(job, description, filters, detailPanel, undefined)
    console.log(`[SOS TEST] Result: ${result.applied ? "APPLIED" : "SKIPPED"} — ${result.reason}`)
    console.log("[SOS TEST] ✓ applyToJob completed")
    return true
  } catch (err) {
    console.error("[SOS TEST] FAIL: applyToJob threw:", err)
    return false
  }
}

/**
 * Run all pipeline step tests sequentially.
 * Usage: call from browser console:
 *   testAllSteps(siteSettingsObject)
 */
export async function testAllSteps(site: SiteSettings): Promise<void> {
  console.log("═══════════════════════════════════════════")
  console.log("[SOS TEST] Running all pipeline step tests")
  console.log("═══════════════════════════════════════════")

  // Step 1: Navigate to search term
  const term = site.search.searchTerms[0]
  if (!term) {
    console.error("[SOS TEST] No search terms configured — cannot test")
    return
  }
  console.log(`\n── Step 1: navigateToSearchTerm("${term}") ──`)
  const step1 = await testNavigateToSearchTerm(term)
  if (!step1) { console.error("[SOS TEST] ABORT: Step 1 failed"); return }

  // Wait for results to settle
  await delay(3_000)

  // Step 2: Build filter URL
  console.log(`\n── Step 2: buildFilterUrl ──`)
  const step2 = testBuildFilterUrl(site)
  if (!step2) { console.warn("[SOS TEST] Step 2 had issues, continuing...") }

  // Step 3: Apply filter bar toggles
  console.log(`\n── Step 3: applyFilterBarToggles ──`)
  const step3bar = await applyFilterBarToggles(site, undefined)
  console.log(`[SOS TEST] Filter bar toggles result: ${step3bar.appliedCount} toggled, errors: ${step3bar.errors.length}`)

  // Step 4: Apply DOM filters (fairChanceEmployer via modal)
  console.log(`\n── Step 4: applyDomFilters ──`)
  const step4 = await testApplyDomFilters(site)
  if (!step4) { console.warn("[SOS TEST] Step 4 had issues, continuing...") }

  // Wait for results to settle
  await delay(2_000)

  // Step 5: Read job previews
  console.log(`\n── Step 5: readAllJobPreviews ──`)
  const step5 = await testReadJobPreviews()
  if (!step5) { console.error("[SOS TEST] ABORT: Step 5 failed"); return }

  // Step 6: Read job description for first job
  console.log(`\n── Step 6: readJobDescription ──`)
  const firstJob = step5 ? (await readAllJobPreviews(1, undefined))[0] : undefined
  if (!firstJob) { console.error("[SOS TEST] ABORT: No job to test description reading"); return }
  const step6 = await testReadJobDescription(firstJob)
  if (!step6) { console.warn("[SOS TEST] Step 6 had issues, continuing...") }

  console.log("\n═══════════════════════════════════════════")
  console.log("[SOS TEST] All tests completed")
  console.log("═══════════════════════════════════════════")
}

/* ── Job listing confirmation ── */

/**
 * Confirm that job listings are visible on the current search results page.
 * Checks DOM for elements matching CARD_SELECTOR.
 * Usage: call from browser console: confirmJobListings()
 *
 * @returns { found: boolean; count: number; message: string }
 */
export function confirmJobListings(): { found: boolean; count: number; message: string } {
  const cards = document.querySelectorAll(CARD_SELECTOR)
  const count = cards.length
  if (count > 0) {
    return { found: true, count, message: `Found ${count} job listing(s) on the page` }
  }
  const empty = document.querySelector(EMPTY_STATE_SELECTOR)
  if (empty) {
    return { found: false, count: 0, message: "No job listings found — empty state detected" }
  }
  return { found: false, count: 0, message: "No job listings found — could not detect job cards or empty state" }
}

/* ── Pipeline orchestrator ── */

/**
 * Run the full LinkedIn pipeline for a single site configuration.
 *
 * Flow (URL-first navigation, filter-bar toggles, modal only for fairChanceEmployer):
 *   1. Login check + anti-bot check
 *   2. Search term shuffling (if enabled)
 *   3. Date/sort cycling (if enabled)
 *   4. For each search term:
 *      a. Navigate via URL with all filter params (buildFilterUrl + keyword)
 *      b. Apply filter bar toggles (under10Applicants, inYourNetwork)
 *      c. Apply DOM-only filter (fairChanceEmployer) via "All filters" modal
 *      d. Read all job previews (no scrolling — reads visible cards)
 *      e. Filter by company allow/block list
 *      f. For each job:
 *         - Read job description (wait for detail panel)
 *         - Apply to job (validate + Easy Apply)
 *         - randomDelay(1000, 2000) between jobs for visual feedback
 *         - Modal double-close check
 *   5. State persistence between jobs (crash recovery)
 */

export async function runLinkedInPipeline(
  site: SiteSettings,
  signal: AbortSignal,
  onProgress?: (msg: string) => void,
  startTermIndex: number = 0
): Promise<void> {
  console.log("[SOS] LinkedIn: Pipeline started")

  // Step 1: Login check
  if (!isLinkedInLoggedIn()) {
    throw new Error("Not logged into LinkedIn — please log in first")
  }

  // Step 3: Anti-bot check
  if (detectAntiBotInterstitial()) {
    throw new Error("LinkedIn anti-bot interstitial detected — please complete verification")
  }

  // Step 4: Prepare search terms
  let searchTerms = [...site.search.searchTerms]
  if (site.search.randomizeSearchOrder) {
    searchTerms = searchTerms.sort(() => Math.random() - 0.5)
    console.log("[SOS] LinkedIn: Randomized search term order")
  }

  // Step 5: Date/sort cycling setup
  const cycleDate = site.pipeline.cycleDatePosted
  const alternateSort = site.pipeline.alternateSortby
  const stopAt24hr = site.pipeline.stopDateCycleAt24hr

  // Pipeline state (no page reloads — all state is in-memory)
  let startJobIndex = 0
  let totalProcessed = 0
  let sortToggle = false
  let dateCycleIndex = 0

  // Step 6: Process each search term
  // startTermIndex > 0 means resume after page refresh — skip already-processed terms
  for (let termIdx = startTermIndex; termIdx < searchTerms.length; termIdx++) {
    signal?.throwIfAborted()
    const term = searchTerms[termIdx]
    onProgress?.(`Searching: "${term}" (${termIdx + 1}/${searchTerms.length})`)

    // Determine date posted and sort for this term
    const dateOverride = cycleDate ? DATE_POSTED_VALUES[dateCycleIndex % DATE_POSTED_VALUES.length] : undefined
    const sortOverride = alternateSort ? SORT_VALUES[sortToggle ? 1 : 0] : undefined

    // Step 6a: Navigate to search term via URL with all filter params
    // URL-based filters (date, sort, experience, job type, on-site, easy apply)
    // are embedded in the navigation URL via buildFilterUrl.
    // Pass site, termIdx, and overrides so searchViaUrlNavigation builds the full filter URL.
    onProgress?.(`Navigating to "${term}"...`)
    try {
      await navigateToSearchTerm(term, signal, site, termIdx, { datePosted: dateOverride, sortBy: sortOverride })
    } catch (err) {
      console.warn(`[SOS] LinkedIn: Failed to navigate to "${term}":`, err)
      continue
    }

    // Step 6b: Apply filter bar toggles (under10Applicants via filter-bar toggle, inYourNetwork via radio toggle)
    // These are direct filter-bar toggles, NOT the "All Filters" modal.
    onProgress?.(`Applying filter bar toggles for "${term}"...`)
    try {
      const barResult = await applyFilterBarToggles(site, signal)
      if (!barResult.success) {
        console.warn("[SOS] LinkedIn: Filter bar toggles had errors:", barResult.errors)
      }
    } catch (err) {
      console.warn(`[SOS] LinkedIn: Failed to apply filter bar toggles for "${term}":`, err)
    }

    // Step 6c: Apply DOM-based filter (fairChanceEmployer only — via "All Filters" modal)
    onProgress?.(`Applying DOM filters for "${term}"...`)
    const domResult = await applyDomFilters(site, site.pipeline.clickDelayMs, signal)
    if (!domResult.success) {
      console.warn("[SOS] LinkedIn: DOM filter application had errors:", domResult.errors)
    }

    // Step 6d: Read all job previews
    onProgress?.(`Reading job listings for "${term}"...`)
    const allPreviews = await readAllJobPreviews(site.search.switchNumber, signal)
    if (allPreviews.length === 0) {
      console.log(`[SOS] LinkedIn: No jobs found for "${term}" — skipping`)
      // Cycle date/sort for next term
      if (cycleDate) dateCycleIndex++
      if (alternateSort) sortToggle = !sortToggle
      continue
    }

    // Step 6e: Filter by company allow/block list
    const filteredPreviews = filterJobPreviews(allPreviews, site.filters.companies)
    console.log(
      `[SOS] LinkedIn: ${filteredPreviews.length} jobs after company filtering ` +
      `(from ${allPreviews.length} total)`
    )

    // Step 6f: Process each job — click first job, check Easy Apply, then scroll to next
    for (let jobIdx = startJobIndex; jobIdx < filteredPreviews.length; jobIdx++) {
      signal?.throwIfAborted()
      const job = filteredPreviews[jobIdx]
      totalProcessed++

      onProgress?.(`Reading: "${job.title}" @ "${job.company}" (${jobIdx + 1}/${filteredPreviews.length})`)

      // Read job description (this clicks the job card to load its detail panel)
      const description = await readJobDescription(job, signal)
      if (!description) {
        console.warn(`[SOS] LinkedIn: Could not read description for "${job.title}" — skipping`)
        // Scroll to next job before continuing
        const nextJob = filteredPreviews[jobIdx + 1]
        if (nextJob?.element) {
          await scrollToNextJob(nextJob.element, signal)
        }
        continue
      }

      // Find the detail panel for Easy Apply
      const detailPanel = document.querySelector(DETAIL_PANEL_SELECTOR)
      if (!detailPanel) {
        console.warn("[SOS] LinkedIn: Detail panel not found after reading description")
        // Scroll to next job before continuing
        const nextJob = filteredPreviews[jobIdx + 1]
        if (nextJob?.element) {
          await scrollToNextJob(nextJob.element, signal)
        }
        continue
      }

      // Apply to job (validate + Easy Apply)
      onProgress?.(`Applying to: "${job.title}" @ "${job.company}"...`)
      const result = await retryApply(
        () => applyToJob(job, description, site.filters, detailPanel, signal, site, onProgress),
        2,
        signal
      )

      console.log(`[SOS] LinkedIn: Job result — ${result.applied ? "APPLIED" : "SKIPPED"}: ${result.reason}`)

      // Modal double-close check: ensure no leftover modal is open before moving on
      const modalStillOpen = document.querySelector(EASY_APPLY_MODAL_SELECTOR)
      if (modalStillOpen) {
        console.warn("[SOS] LinkedIn: Modal still open after job processing — closing")
        await closeEasyApplyModal()
      }

      // Save state after each job (crash recovery)
      await savePipelineState({
        termIndex: termIdx,
        jobIndex: jobIdx + 1,
        totalProcessed,
        sortToggle,
        dateCycleIndex,
        timestamp: Date.now(),
      })

      // Scroll to the next job card in the list before moving on
      const nextJob = filteredPreviews[jobIdx + 1]
      if (nextJob?.element) {
        onProgress?.(`Scrolling to next job...`)
        await scrollToNextJob(nextJob.element, signal)
      }
    }

    // Reset startJobIndex for next term (only first term uses persisted job index)
    startJobIndex = 0

    // Cycle date/sort for next term
    if (cycleDate) {
      dateCycleIndex++
      // If stopDateCycleAt24hr is enabled, clamp to 24h (index 0) once we cycle past it
      if (stopAt24hr && dateCycleIndex >= 1) {
        dateCycleIndex = 0 // Stay at 24h (r86400)
      }
    }

    if (alternateSort) sortToggle = !sortToggle
  }

  // Clear persisted state on successful completion
  await clearPipelineState()
  await clearResumeState()
  console.log("[SOS] LinkedIn: Pipeline completed successfully")
  onProgress?.(`Pipeline complete — processed ${totalProcessed} jobs`)
}

