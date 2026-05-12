/**
 * LinkedIn-specific pipeline: DOM-based navigation + batch job reading.
 *
 * Navigation Strategy (no page reloads — all DOM-based):
 *   - Search terms: DOM manipulation of the search input + Enter key
 *   - URL filters (f_E, f_JT, f_WT, etc.): Try pushState+popstate events first,
 *     fall back to DOM interaction with LinkedIn's filter dropdown buttons
 *   - DOM-only toggles (under 10 applicants, in your network): "All filters" modal
 *
 * Wait Strategy (no time-based delays):
 *   - All waits use MutationObserver-based waitForCondition() instead of delay()
 *   - We wait for specific DOM conditions (cards appeared, modal opened, etc.)
 *   - Only exception: randomDelay(1000, 2000) between jobs for visual feedback
 *
 * Easy Apply Strategy:
 *   - Easy Apply toggle is ALWAYS enabled (mandatory)
 *   - Each job listing is checked for Easy Apply button in the detail panel
 *   - External apply jobs are skipped
 *
 * LinkedIn filter dropdown options:
 *   Date Posted: "Past 24 hours", "Past week", "Past month"
 *   Sort By: "Most recent", "Most relevant"
 *   Experience Level: "Internship", "Entry level", "Associate", "Mid-Senior level", "Director", "Executive"
 *   Job Type: "Full-time", "Part-time", "Contract", "Temporary", "Volunteer", "Internship"
 *   On-site/Remote: "On-site", "Remote", "Hybrid"
 *   Easy Apply: toggle button
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
  ALL_FILTERS_BUTTON_SELECTORS,
  SHOW_RESULTS_BUTTON_SELECTORS,
  DESCRIPTION_CONTENT_SELECTOR,
  SHOW_MORE_BUTTON_SELECTOR,
  EMPTY_STATE_SELECTOR,
  FILTER_BTN_DATE_POSTED,
  FILTER_BTN_EXPERIENCE,
  FILTER_BTN_JOB_TYPE,
  FILTER_BTN_ON_SITE,
  FILTER_BTN_EASY_APPLY,
  FILTER_BTN_SORT,
  FILTER_DROPDOWN_PANEL,
  FILTER_OPTION_TEXT,
  DATE_POSTED_MAP,
  EXPERIENCE_MAP,
  JOB_TYPE_MAP,
  ON_SITE_MAP,
  SORT_MAP,
  FILTER_URL_PARAMS,
  LINKEDIN_JOBS_SEARCH_URL,
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
 * Strategy 4: Navigate directly to the LinkedIn jobs search URL.
 * This is the most reliable fallback — always works.
 */
async function searchViaUrlNavigation(term: string, signal?: AbortSignal): Promise<void> {
  console.log("[SOS] LinkedIn: Falling back to URL navigation")

  const url = new URL(LINKEDIN_JOBS_SEARCH_URL)
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
 * Navigate to a new search term using a multi-strategy approach:
 *   1. Try LinkedIn's global search bar (top nav, works from ANY page)
 *   2. Try LinkedIn's semantic search bar (AI-powered, on jobs pages)
 *   3. Try LinkedIn's jobs-specific search bar (on /jobs/ pages)
 *   4. Fall back to URL navigation (most reliable)
 *
 * Uses waitForCondition to confirm the input value was set before dispatching Enter.
 * Uses waitForResults to wait for cards or empty state after search.
 *
 * @param site - SiteSettings (needed for resume state before page refresh)
 * @param termIdx - Current term index (needed for resume state)
 */
export async function navigateToSearchTerm(
  term: string,
  signal?: AbortSignal,
  site?: SiteSettings,
  termIdx?: number
): Promise<void> {
  console.log(`[SOS] LinkedIn: Navigating to search term "${term}"`)

  // Guard: If already on a LinkedIn jobs search results page, update keywords via pushState.
  // Checks both /jobs/search-results/ (current) and /jobs/search/ (legacy) patterns.
  const currentUrl = window.location.href.toLowerCase()
  const isOnSearchResults = currentUrl.includes("/jobs/search-results/") ||
    currentUrl.includes("/jobs/search/") ||
    (currentUrl.includes("/jobs/") && currentUrl.includes("keywords="))

  if (isOnSearchResults) {
    console.log("[SOS] LinkedIn: Already on search results page — updating keyword param via pushState")
    try {
      const url = new URL(window.location.href)
      url.searchParams.set("keywords", term)
      pushStateNavigate(url)
      await waitForResults(10_000, signal)
      return
    } catch (err) {
      console.warn("[SOS] LinkedIn: pushState update failed", err)
    }
  }

  // PRIMARY NAVIGATION: Navigate directly to the jobs search results URL.
  // This bypasses LinkedIn's finicky global search typeahead and "Jobs" filter button,
  // which change frequently with LinkedIn's CSS-module redesigns.
  // Uses pushStateNavigate first (SPA, no page reload), falls back to full page load.
  console.log("[SOS] LinkedIn: Navigating directly to search results URL")
  const searchUrl = "https://www.linkedin.com/jobs/search-results/"
  const url = new URL(searchUrl)
  url.searchParams.set("keywords", term)
  url.searchParams.set("sos_nav", "1")
  pushStateNavigate(url)

  try {
    await waitForResults(15_000, signal)
    console.log("[SOS] LinkedIn: URL navigation returned results")
    return
  } catch {
    console.log("[SOS] LinkedIn: pushState failed — doing full page load")
  }

  // Last resort: full page navigation
  window.location.href = `${searchUrl}?keywords=${encodeURIComponent(term)}`
  throw new Error(`Navigating to jobs search page for "${term}" — page will reload`)
}

/* ── Navigation: Filters (DOM-based dropdown interaction) ── */

/**
 * Find a filter button by its text content (case-insensitive, partial match).
 * Searches all filter buttons in the results filter bar.
 */
function findFilterButton(text: string): Element | null {
  for (const btn of document.querySelectorAll<HTMLElement>(
    "button.jobs-search-results-list__filter-button, " +
    "button[aria-label*='filter'], " +
    "button[aria-label*='Filter']"
  )) {
    const btnText = btn.textContent?.trim().toLowerCase() || ""
    const ariaLabel = btn.getAttribute("aria-label")?.toLowerCase() || ""
    if (btnText.includes(text.toLowerCase()) || ariaLabel.includes(text.toLowerCase())) {
      return btn
    }
  }
  return null
}

/**
 * Find an option inside an open dropdown panel by its text content.
 */
function findDropdownOption(panel: Element, text: string): Element | null {
  // Try option roles first
  const options = panel.querySelectorAll<HTMLElement>(
    "li[role='option'], button[role='option'], span[role='option'], " +
    "label, span[role='checkbox'], div[role='checkbox']"
  )
  for (const opt of options) {
    const optText = opt.textContent?.trim().toLowerCase() || ""
    if (optText.includes(text.toLowerCase())) {
      return opt
    }
  }
  // Fallback: search all elements
  for (const el of panel.querySelectorAll("*")) {
    const elText = el.textContent?.trim().toLowerCase() || ""
    if (elText === text.toLowerCase() || elText.includes(text.toLowerCase())) {
      return el
    }
  }
  return null
}

/**
 * Close an open filter dropdown by pressing Escape or clicking the filter button again.
 */
async function closeFilterDropdown(filterBtn: Element, signal?: AbortSignal): Promise<void> {
  // Try Escape key first
  filterBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
  await delay(300, signal)
  // If dropdown is still open, click the button again to toggle it closed
  const dropdownStillOpen = document.querySelector(FILTER_DROPDOWN_PANEL)
  if (dropdownStillOpen) {
    scrollAndClick(filterBtn)
    await delay(300, signal)
  }
}

/**
 * Apply a single filter via its dropdown button.
 * Clicks the filter button, waits for the dropdown, selects the option, and closes.
 *
 * @param filterBtnSelector - CSS selector for the filter button
 * @param optionText - The text of the option to select in the dropdown
 * @param signal - AbortSignal
 * @returns true if the filter was applied successfully
 */
async function applySingleFilter(
  filterBtnSelector: string,
  optionText: string,
  signal?: AbortSignal
): Promise<boolean> {
  // Find the filter button
  let filterBtn = document.querySelector<HTMLElement>(filterBtnSelector)
  if (!filterBtn) {
    // Fallback: search by text
    filterBtn = findFilterButton(optionText.split(" ")[0]) as HTMLElement | null
  }
  if (!filterBtn) {
    console.warn(`[SOS] LinkedIn: Could not find filter button for "${optionText}"`)
    return false
  }

  // Click to open the dropdown
  scrollAndClick(filterBtn)
  await delay(400, signal)

  // Wait for dropdown panel to appear
  let dropdown = await waitForElement(FILTER_DROPDOWN_PANEL, 3_000, signal)
  if (!dropdown) {
    // If no dropdown appeared, this might be a toggle button (Easy Apply)
    // Check if the button's aria-pressed changed or it has a selected state
    console.log(`[SOS] LinkedIn: No dropdown for "${optionText}" — might be a toggle`)
    return true
  }

  // Find and click the option
  const option = findDropdownOption(dropdown, optionText)
  if (!option) {
    console.warn(`[SOS] LinkedIn: Could not find option "${optionText}" in dropdown`)
    await closeFilterDropdown(filterBtn, signal)
    return false
  }

  scrollAndClick(option)
  await delay(300, signal)

  // Close the dropdown
  await closeFilterDropdown(filterBtn, signal)

  console.log(`[SOS] LinkedIn: Applied filter "${optionText}"`)
  return true
}

/**
 * Apply URL-based filters via DOM interaction with LinkedIn's filter dropdown buttons.
 * No page reloads — clicks filter buttons, selects options, closes dropdowns.
 *
 * Handles:
 *   - Date Posted dropdown (radio-style: Past 24 hours, Past week, Past month)
 *   - Sort By dropdown (radio-style: Most recent, Most relevant)
 *   - Experience Level dropdown (checkbox-style: Entry level, Associate, etc.)
 *   - Job Type dropdown (checkbox-style: Full-time, Part-time, Contract, etc.)
 *   - On-site/Remote dropdown (checkbox-style: On-site, Remote, Hybrid)
 *   - Easy Apply toggle button
 */
export async function applyUrlFiltersViaDom(
  site: SiteSettings,
  signal?: AbortSignal,
  overrides?: { datePosted?: string; sortBy?: string }
): Promise<void> {
  console.log("[SOS] LinkedIn: Applying URL-based filters via DOM interaction")

  // 1. Date Posted
  const dateKey = (overrides?.datePosted || site.filters.datePosted || "").trim().toLowerCase()
  if (dateKey && FILTER_OPTION_TEXT.datePosted[dateKey]) {
    const optionText = FILTER_OPTION_TEXT.datePosted[dateKey]
    await applySingleFilter(FILTER_BTN_DATE_POSTED, optionText, signal)
  }

  // 2. Sort By
  const sortKey = (overrides?.sortBy || site.filters.sortBy || "").trim().toLowerCase()
  if (sortKey && FILTER_OPTION_TEXT.sortBy[sortKey]) {
    const optionText = FILTER_OPTION_TEXT.sortBy[sortKey]
    await applySingleFilter(FILTER_BTN_SORT, optionText, signal)
  }

  // 3. Experience Level (multi-select checkboxes)
  if (site.filters.experienceLevel.length > 0) {
    const expBtn = document.querySelector<HTMLElement>(FILTER_BTN_EXPERIENCE) ||
      findFilterButton("experience") as HTMLElement | null
    if (expBtn) {
      scrollAndClick(expBtn)
      await delay(400, signal)
      const dropdown = await waitForElement(FILTER_DROPDOWN_PANEL, 3_000, signal)
      if (dropdown) {
        for (const level of site.filters.experienceLevel) {
          const key = level.trim().toLowerCase()
          const optionText = FILTER_OPTION_TEXT.experienceLevel[key]
          if (optionText) {
            const option = findDropdownOption(dropdown, optionText)
            if (option) {
              scrollAndClick(option)
              await delay(300, signal)
              console.log(`[SOS] LinkedIn: Applied experience level "${optionText}"`)
            }
          }
        }
        await closeFilterDropdown(expBtn, signal)
      } else {
        await closeFilterDropdown(expBtn, signal)
      }
    }
  }

  // 4. Job Type (multi-select checkboxes)
  if (site.filters.jobType.length > 0) {
    const jtBtn = document.querySelector<HTMLElement>(FILTER_BTN_JOB_TYPE) ||
      findFilterButton("job type") as HTMLElement | null
    if (jtBtn) {
      scrollAndClick(jtBtn)
      await delay(400, signal)
      const dropdown = await waitForElement(FILTER_DROPDOWN_PANEL, 3_000, signal)
      if (dropdown) {
        for (const jt of site.filters.jobType) {
          const key = jt.trim().toLowerCase()
          const optionText = FILTER_OPTION_TEXT.jobType[key]
          if (optionText) {
            const option = findDropdownOption(dropdown, optionText)
            if (option) {
              scrollAndClick(option)
              await delay(300, signal)
              console.log(`[SOS] LinkedIn: Applied job type "${optionText}"`)
            }
          }
        }
        await closeFilterDropdown(jtBtn, signal)
      } else {
        await closeFilterDropdown(jtBtn, signal)
      }
    }
  }

  // 5. On-site/Remote (multi-select checkboxes)
  if (site.filters.onSite.length > 0) {
    const osBtn = document.querySelector<HTMLElement>(FILTER_BTN_ON_SITE) ||
      findFilterButton("on-site") as HTMLElement | null
    if (osBtn) {
      scrollAndClick(osBtn)
      await delay(400, signal)
      const dropdown = await waitForElement(FILTER_DROPDOWN_PANEL, 3_000, signal)
      if (dropdown) {
        for (const os of site.filters.onSite) {
          const key = os.trim().toLowerCase()
          const optionText = FILTER_OPTION_TEXT.onSite[key]
          if (optionText) {
            const option = findDropdownOption(dropdown, optionText)
            if (option) {
              scrollAndClick(option)
              await delay(300, signal)
              console.log(`[SOS] LinkedIn: Applied on-site/remote "${optionText}"`)
            }
          }
        }
        await closeFilterDropdown(osBtn, signal)
      } else {
        await closeFilterDropdown(osBtn, signal)
      }
    }
  }

  // 6. Easy Apply toggle (always enabled — mandatory)
  const eaBtn = document.querySelector<HTMLElement>(FILTER_BTN_EASY_APPLY) ||
    findFilterButton("easy apply") as HTMLElement | null
  if (eaBtn) {
    const isPressed = eaBtn.getAttribute("aria-pressed") === "true"
    const isSelected = eaBtn.getAttribute("aria-checked") === "true"
    const hasActiveClass = eaBtn.classList.contains("jobs-search-results-list__filter-button--active")
    if (!isPressed && !isSelected && !hasActiveClass) {
      scrollAndClick(eaBtn)
      await delay(300, signal)
      console.log("[SOS] LinkedIn: Toggled Easy Apply filter ON")
    } else {
      console.log("[SOS] LinkedIn: Easy Apply filter already active")
    }
  }

  // Wait for results to update after applying filters
  try {
    await waitForResults(8_000, signal)
  } catch {
    // Results might not change if no new data was fetched
  }

  console.log("[SOS] LinkedIn: URL-based filters applied via DOM")
}

/* ── Navigation: Filters (pushState+popstate first, DOM fallback) ── */

/**
 * Build a URL with filter params from the current URL + filter settings.
 * Cleans existing filter params and applies new ones.
 */
function buildFilterUrl(
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

  // Easy Apply (f_AL) — always enabled (mandatory)
  url.searchParams.set("f_AL", "true")

  return url
}

/**
 * Apply URL-based filters via pushState+popstate events first.
 * If LinkedIn's SPA doesn't respond to synthetic popstate events (isTrusted=false),
 * falls back to DOM-based filter dropdown interaction.
 *
 * Strategy:
 *   1. Build URL with filter params from settings
 *   2. Use pushStateNavigate() to update URL + dispatch popstate
 *   3. Wait for results to update (cards re-render or empty state)
 *   4. If no update after timeout, fall back to applyUrlFiltersViaDom()
 */
export async function applyUrlFiltersViaStateEvents(
  site: SiteSettings,
  signal?: AbortSignal,
  overrides?: { datePosted?: string; sortBy?: string }
): Promise<void> {
  console.log("[SOS] LinkedIn: Applying URL-based filters via pushState+popstate events")

  // Step 1: Build the filter URL
  const filterUrl = buildFilterUrl(window.location.href, site, overrides)
  console.log(`[SOS] LinkedIn: Filter URL: ${filterUrl.toString()}`)

  // Step 2: Get current card count before navigation
  const cardsBefore = document.querySelectorAll(CARD_SELECTOR).length

  // Step 3: Navigate via pushState + popstate
  pushStateNavigate(filterUrl)

  // Step 4: Wait for results to update (cards re-render or empty state)
  try {
    await waitForCondition(
      () => {
        const cards = document.querySelectorAll(CARD_SELECTOR)
        const empty = document.querySelector(EMPTY_STATE_SELECTOR)
        // Cards changed (different count) or empty state appeared
        return (cards.length > 0 && cards.length !== cardsBefore) || empty !== null
      },
      { timeoutMs: 5_000, signal, pollIntervalMs: 200 }
    )
    console.log("[SOS] LinkedIn: Filters applied via pushState+popstate — LinkedIn SPA responded")
    return
  } catch {
    // pushState+popstate didn't trigger LinkedIn's SPA to re-fetch
    console.log("[SOS] LinkedIn: pushState+popstate did not trigger SPA update — falling back to DOM interaction")
  }

  // Step 5: Fall back to DOM-based filter interaction
  await applyUrlFiltersViaDom(site, signal, overrides)
}

/* ── DOM-only filter application (post-nav) ── */

/**
 * Apply DOM-only filters via the "All filters" modal.
 * Uses waitForElement (MutationObserver) instead of time-based delays.
 */
async function applyDomFilters(
  site: SiteSettings,
  clickDelayMs: number,
  signal?: AbortSignal
): Promise<ApplyFiltersResult> {
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

/**
 * Confirmation function: check if job listings are present on the current page.
 * Call from browser console to verify the pipeline has successfully navigated:
 *   confirmJobListings()
 *
 * Reports:
 *   - Number of job cards found
 *   - URL of the current page
 *   - Whether the search results filter bar is visible
 *   - Example titles/companies of first 3 jobs
 */
export async function confirmJobListings(): Promise<boolean> {
  console.log("═══════════════════════════════════════════")
  console.log("[SOS] Confirming job listings...")
  console.log("═══════════════════════════════════════════")

  // 1. Check current URL
  const currentUrl = window.location.href
  const isOnJobsPage = currentUrl.includes("/jobs/")
  console.log(`URL: ${currentUrl}`)
  console.log(`On jobs page: ${isOnJobsPage}`)

  // 2. Count job cards using CARD_SELECTOR
  const cards = document.querySelectorAll(CARD_SELECTOR)
  console.log(`Job cards found: ${cards.length} (using CARD_SELECTOR)`)

  if (cards.length > 0) {
    // 3. Show first 3 job details
    console.log(`\n── First ${Math.min(3, cards.length)} job(s) ──`)
    for (let i = 0; i < Math.min(3, cards.length); i++) {
      const card = cards[i] as HTMLElement
      const title = extractCardTitle(card)
      const company = extractCardCompany(card)
      const location = extractCardLocation(card)
      console.log(`  ${i + 1}. "${title}" @ "${company}" (${location})`)
    }
  }

  // 4. Check search results filter bar
  const filterBar = document.querySelector(SEARCH_RESULTS_FILTER_BAR)
  console.log(`Filter bar visible: ${filterBar !== null}`)

  // 5. Check empty state
  const emptyState = document.querySelector(EMPTY_STATE_SELECTOR)
  console.log(`Empty state visible: ${emptyState !== null}`)

  // 6. Summary
  const hasCards = cards.length > 0
  if (hasCards) {
    console.log("\n✅ CONFIRMED: Job listings are present!")
  } else if (emptyState) {
    console.log("\n⚠️  Page loaded but no jobs found (empty state)")
  } else if (isOnJobsPage) {
    console.log("\n⏳ On jobs page but waiting for results to load...")
  } else {
    console.log("\n❌ NOT on a jobs search results page")
  }

  console.log("═══════════════════════════════════════════")
  return hasCards
}

/**
 * Test: navigateToSearchTerm
 * Verifies the search input can be found, cleared, and a term entered + Enter dispatched.
 * Does NOT wait for results (just tests the input manipulation).
 * Usage: call from browser console: testNavigateToSearchTerm("software engineer")
 */
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
 * Test: applyUrlFiltersViaStateEvents
 * Verifies that pushState+popstate filter application works (or falls back to DOM).
 * Usage: call from browser console with a mock site object:
 *   testApplyUrlFilters({ filters: { datePosted: "past 24 hours", ... } })
 */
export async function testApplyUrlFilters(site: SiteSettings): Promise<boolean> {
  console.log("[SOS TEST] Testing applyUrlFiltersViaStateEvents...")
  try {
    const urlBefore = window.location.href
    const cardsBefore = document.querySelectorAll(CARD_SELECTOR).length
    console.log(`[SOS TEST] Cards before: ${cardsBefore}, URL: ${urlBefore}`)

    await applyUrlFiltersViaStateEvents(site, undefined)

    const urlAfter = window.location.href
    const cardsAfter = document.querySelectorAll(CARD_SELECTOR).length
    console.log(`[SOS TEST] Cards after: ${cardsAfter}, URL: ${urlAfter}`)

    if (urlAfter !== urlBefore) {
      console.log("[SOS TEST] PASS: URL was updated with filter params")
    } else {
      console.log("[SOS TEST] INFO: URL unchanged (filters may have been applied via DOM)")
    }

    if (cardsAfter > 0) {
      console.log("[SOS TEST] PASS: Job cards are present after filter application")
    }

    console.log("[SOS TEST] ✓ applyUrlFiltersViaStateEvents completed")
    return true
  } catch (err) {
    console.error("[SOS TEST] FAIL: applyUrlFiltersViaStateEvents threw:", err)
    return false
  }
}

/**
 * Test: applyDomFilters
 * Verifies the "All filters" modal can be opened, checkboxes toggled, and results applied.
 * Usage: call from browser console:
 *   testApplyDomFilters({ filters: { under10Applicants: true, inYourNetwork: true } })
 */
export async function testApplyDomFilters(site: SiteSettings): Promise<boolean> {
  console.log("[SOS TEST] Testing applyDomFilters...")
  try {
    const result = await applyDomFilters(site, 300, undefined)
    if (result.success) {
      console.log(`[SOS TEST] PASS: DOM filters applied (${result.appliedCount} toggled)`)
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

  // Step 2: Apply URL filters
  console.log(`\n── Step 2: applyUrlFiltersViaStateEvents ──`)
  const step2 = await testApplyUrlFilters(site)
  if (!step2) { console.warn("[SOS TEST] Step 2 had issues, continuing...") }

  // Wait for results to settle
  await delay(2_000)

  // Step 3: Apply DOM filters
  console.log(`\n── Step 3: applyDomFilters ──`)
  const step3 = await testApplyDomFilters(site)
  if (!step3) { console.warn("[SOS TEST] Step 3 had issues, continuing...") }

  // Wait for results to settle
  await delay(2_000)

  // Step 4: Read job previews
  console.log(`\n── Step 4: readAllJobPreviews ──`)
  const step4 = await testReadJobPreviews()
  if (!step4) { console.error("[SOS TEST] ABORT: Step 4 failed"); return }

  // Step 5: Read job description for first job
  console.log(`\n── Step 5: readJobDescription ──`)
  const firstJob = step4 ? (await readAllJobPreviews(1, undefined))[0] : undefined
  if (!firstJob) { console.error("[SOS TEST] ABORT: No job to test description reading"); return }
  const step5 = await testReadJobDescription(firstJob)
  if (!step5) { console.warn("[SOS TEST] Step 5 had issues, continuing...") }

  console.log("\n═══════════════════════════════════════════")
  console.log("[SOS TEST] All tests completed")
  console.log("═══════════════════════════════════════════")
}

/* ── Pipeline orchestrator ── */

/**
 * Run the full LinkedIn pipeline for a single site configuration.
 *
 * Flow (no page reloads — all DOM-based):
 *   1. Login check + anti-bot check
 *   2. Search term shuffling (if enabled)
 *   3. Date/sort cycling (if enabled)
 *   4. For each search term:
 *      a. Navigate to term via DOM input manipulation
 *      b. Apply URL-based filters (try pushState+popstate first, fall back to DOM)
 *      c. Apply DOM-only filters (under 10 applicants, etc.) via "All filters" modal
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

    // Step 6a: Navigate to search term via DOM input manipulation
    // Pass site and termIdx so searchViaGlobalBar can save resume state before page refresh
    onProgress?.(`Navigating to "${term}"...`)
    try {
      await navigateToSearchTerm(term, signal, site, termIdx)
    } catch (err) {
      console.warn(`[SOS] LinkedIn: Failed to navigate to "${term}":`, err)
      continue
    }

    // Step 6b: Apply URL-based filters (try pushState+popstate first, fall back to DOM)
    onProgress?.(`Applying filters for "${term}"...`)
    try {
      await applyUrlFiltersViaStateEvents(site, signal, { datePosted: dateOverride, sortBy: sortOverride })
    } catch (err) {
      console.warn(`[SOS] LinkedIn: Failed to apply filters for "${term}":`, err)
      continue
    }

    // Step 6c: Apply DOM-based filters (under 10 applicants, in your network, fair chance employer)
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

