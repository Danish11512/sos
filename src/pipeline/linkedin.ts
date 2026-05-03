/**
 * LinkedIn-specific pipeline: DOM-based navigation + batch job reading.
 *
 * Navigation Strategy (no page reloads):
 *   - Search terms: DOM manipulation of the search input + Enter key
 *   - URL filters (f_E, f_JT, f_WT, etc.): history.pushState + PopStateEvent
 *   - DOM-only toggles (under 10 applicants, in your network): "All filters" modal
 *
 * Wait Strategy (no time-based delays):
 *   - All waits use MutationObserver-based waitForCondition() instead of delay()
 *   - We wait for specific DOM conditions (cards appeared, modal opened, etc.)
 *   - Only exception: randomDelay(1000, 2000) between jobs for visual feedback
 *
 * Easy Apply Strategy:
 *   - f_AL=true is ALWAYS set in the URL (Easy Apply filter is mandatory)
 *   - Each job listing is checked for Easy Apply button in the detail panel
 *   - External apply jobs are skipped
 *
 * LinkedIn filter URL params:
 *   f_TPR=r86400 (past 24h), r604800 (week), r2592000 (month)
 *   f_SB2=1 (most recent), 2 (most relevant)
 *   f_E=2 (entry), 3 (associate), 4 (mid-senior), 5 (director), 6 (executive)
 *   f_JT=F (full-time), P (part-time), C (contract), T (temporary), V (volunteer), I (internship)
 *   f_WT=1 (on-site), 2 (remote), 3 (hybrid)
 *   f_AL=true (easy apply) — ALWAYS SET
 */

import type { SiteSettings, FilterSettings } from "../settings/sections"
import type { ApplyFiltersResult, ApplyToJobResult, JobPreview } from "./types"
import type { ModalResult } from "./modal-result"
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
  dispatchEscapeKey,
  waitForCondition,
  waitForNewElements,
  randomDelay,
  detectAntiBotInterstitial,
  isLinkedInLoggedIn,
} from "../utils/dom"

import { eventBus } from "../utils/event-bus"
import { browser } from "wxt/browser"


import {
  SEARCH_INPUT_SELECTOR,
  LINKEDIN_RESULTS_SELECTOR,
  CARD_SELECTOR,
  DETAIL_PANEL_SELECTOR,
  LIST_SCROLLER_SELECTOR,
  EASY_APPLY_BUTTON_SELECTOR,
  EXTERNAL_APPLY_SELECTOR,
  EASY_APPLY_MODAL_SELECTOR,
  EASY_APPLY_CLOSE_SELECTOR,
  LINKEDIN_JOBS_SEARCH_URL,
  SEARCH_PAGE_PATH,
  DATE_POSTED_MAP,
  EXPERIENCE_MAP,
  JOB_TYPE_MAP,
  ON_SITE_MAP,
  SORT_MAP,
  FILTER_URL_PARAMS,
  DATE_POSTED_VALUES,
  SORT_VALUES,
  ALL_FILTERS_BUTTON_SELECTORS,
  SHOW_RESULTS_BUTTON_SELECTORS,
  DESCRIPTION_CONTENT_SELECTOR,
  SHOW_MORE_BUTTON_SELECTOR,
  EMPTY_STATE_SELECTOR,
} from "./linkedin-constants"

import { fillEasyApplyModal, detectExternalApply } from "./easy-apply-modal"

/* ── Pipeline state persistence key ── */
const PIPELINE_STATE_KEY = "sos_linkedin_pipeline_state"

interface PipelinePersistedState {
  termIndex: number
  jobIndex: number
  totalProcessed: number
  sortToggle: boolean
  dateCycleIndex: number
  timestamp: number
}

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

/**
 * Wait for the Easy Apply modal to appear and be fully loaded (has form content).
 */
async function waitForEasyApplyModal(timeoutMs = 8_000, signal?: AbortSignal): Promise<Element | null> {
  const modal = await waitForElement(EASY_APPLY_MODAL_SELECTOR, timeoutMs, signal)
  if (!modal) return null

  // Wait for modal to have actual form content
  try {
    await waitForCondition(
      () => {
        const m = document.querySelector(EASY_APPLY_MODAL_SELECTOR)
        return m?.querySelector("form, input, select, textarea") !== null
      },
      { timeoutMs: 3_000, signal }
    )
  } catch {
    // Modal appeared but no form content — still return it
  }

  return modal
}

/**
 * Wait for the modal to close (disappear from DOM).
 */
async function waitForModalClose(timeoutMs = 3_000, signal?: AbortSignal): Promise<boolean> {
  try {
    await waitForCondition(
      () => !document.querySelector(EASY_APPLY_MODAL_SELECTOR),
      { timeoutMs, signal }
    )
    return true
  } catch {
    return false
  }
}

/* ── Filtered URL params helper (for pushState updates) ── */

/**
 * Build only the filter-related URL params from site settings.
 * Preserves the existing page URL's keywords, location, and other params.
 * Returns a new URL that can be pushState'd.
 *
 * Always sets f_AL=true (Easy Apply filter is mandatory).
 */
function buildFilterUrl(
  site: SiteSettings,
  overrides?: { datePosted?: string; sortBy?: string },
  explicitKeywords?: string
): URL {
  const url = new URL(LINKEDIN_JOBS_SEARCH_URL)

  // Preserve keywords, location, geoId from current URL
  const currentUrl = new URL(window.location.href)
  for (const key of ["keywords", "location", "geoId", "original_referer"]) {
    const val = currentUrl.searchParams.get(key)
    if (val) url.searchParams.set(key, val)
  }

  // If explicit keywords provided, use them
  if (explicitKeywords) {
    url.searchParams.set("keywords", explicitKeywords)
  }

  // Remove previous SOS filter params (clean slate)
  for (const key of FILTER_URL_PARAMS) {
    url.searchParams.delete(key)
  }

  // Sort (use override if provided, otherwise from settings)
  const sortKey = overrides?.sortBy ?? site.filters.sortBy
  const sortVal = SORT_MAP[sortKey.trim().toLowerCase()]
  if (sortVal) url.searchParams.set("f_SB2", sortVal)

  // Date posted (use override if provided, otherwise from settings)
  const dateKey = overrides?.datePosted ?? site.filters.datePosted
  const dateVal = DATE_POSTED_MAP[dateKey.trim().toLowerCase()]
  if (dateVal) url.searchParams.set("f_TPR", dateVal)

  // Experience level
  const expCodes = site.filters.experienceLevel.map((v) => EXPERIENCE_MAP[v.trim()]).filter(Boolean)
  if (expCodes.length > 0) url.searchParams.set("f_E", expCodes.join(","))

  // Job type
  const jobCodes = site.filters.jobType.map((v) => JOB_TYPE_MAP[v.trim()]).filter(Boolean)
  if (jobCodes.length > 0) url.searchParams.set("f_JT", jobCodes.join(","))

  // On-site / remote
  const onsiteCodes = site.filters.onSite.map((v) => ON_SITE_MAP[v.trim()]).filter(Boolean)
  if (onsiteCodes.length > 0) url.searchParams.set("f_WT", onsiteCodes.join(","))

  // Easy Apply only — ALWAYS SET (mandatory)
  url.searchParams.set("f_AL", "true")

  return url
}

/* ── Navigation: Search Page (full redirect) ── */

/**
 * Navigate to the LinkedIn jobs search page.
 */
export function navigateToSearchPage(): void {
  if (window.location.pathname.includes(SEARCH_PAGE_PATH)) {
    console.log("[SOS] LinkedIn: Already on search page — skipping redirect")
    return
  }
  console.log("[SOS] LinkedIn: Navigating to jobs search page")

  // Try pushState first
  try {
    pushStateNavigate(LINKEDIN_JOBS_SEARCH_URL)
    if (window.location.pathname.includes(SEARCH_PAGE_PATH)) {
      console.log("[SOS] LinkedIn: SPA navigation succeeded")
      return
    }
  } catch {
    // Fall through to full redirect
  }

  // Fallback: full page redirect
  window.location.href = LINKEDIN_JOBS_SEARCH_URL
}

/* ── Easy Apply: Click button ── */

/**
 * Click the Easy Apply button in the job detail panel and wait for the
 * apply modal to appear.
 *
 * Uses MutationObserver-based waiting instead of retry loops with delays.
 * The waitForElement call handles the "wait for button to appear" part.
 *
 * Returns the modal element if found, null otherwise.
 */
export async function clickEasyApplyButton(
  detailPanel: Element,
  signal?: AbortSignal
): Promise<Element | null> {
  signal?.throwIfAborted()

  // Check if the job has already been applied to
  const allButtons = detailPanel.querySelectorAll("button")
  for (const btn of allButtons) {
    const text = btn.textContent?.trim().toLowerCase() || ""
    if (text.includes("applied") || text.includes("submitted") || text.includes("withdrawn")) {
      console.log(`[SOS] LinkedIn: Job already applied to — button text: "${text}"`)
      return null
    }
  }

  // Check for external apply link early and skip
  const externalBtn = detailPanel.querySelector<HTMLAnchorElement>(EXTERNAL_APPLY_SELECTOR)
  if (externalBtn) {
    console.log("[SOS] LinkedIn: Found external apply link — skipping job (no new tab)")
    return null
  }

  // Wait for the Easy Apply button to appear in the detail panel
  const applyBtn = await waitForElement<HTMLElement>(EASY_APPLY_BUTTON_SELECTOR, 8_000, signal)
  if (!applyBtn) {
    // Fallback: scan all buttons in detail panel for text match
    const fallbackBtn = (() => {
      for (const btn of detailPanel.querySelectorAll("button")) {
        const text = btn.textContent?.trim().toLowerCase() || ""
        const negativeIndicators = ["applied", "submitted", "withdrawn"]
        if (negativeIndicators.some((neg) => text.includes(neg))) continue
        if (text.includes("easy apply") || text.includes("apply now") || text === "apply") {
          return btn
        }
      }
      return null
    })()

    if (!fallbackBtn) {
      console.warn("[SOS] LinkedIn: Could not find Easy Apply button in detail panel")
      return null
    }

    console.log("[SOS] LinkedIn: Clicking Easy Apply button (text-based fallback)")
    scrollAndClick(fallbackBtn)
  } else {
    console.log("[SOS] LinkedIn: Clicking Easy Apply button")
    scrollAndClick(applyBtn)
  }

  // Wait for modal to appear and be fully loaded
  const modal = await waitForEasyApplyModal(8_000, signal)
  if (modal) {
    console.log("[SOS] LinkedIn: Easy Apply modal opened successfully")
    return modal
  }

  console.warn("[SOS] LinkedIn: Easy Apply modal did not appear")
  return null
}

/* ── Easy Apply: Close modal ── */

/**
 * Close the Easy Apply modal by trying up to 3 strategies.
 * Uses waitForCondition to confirm the modal actually closed.
 */
export async function closeEasyApplyModal(): Promise<boolean> {
  const modal = document.querySelector(EASY_APPLY_MODAL_SELECTOR)
  if (!modal) {
    console.log("[SOS] LinkedIn: Modal already closed — skipping close")
    return true
  }

  const originalBodyOverflow = document.body.style.overflow
  const originalBodyPosition = document.body.style.position

  // Strategy 1: Click the X / Dismiss button via CSS selector
  const closeBtn = document.querySelector<HTMLElement>(
    EASY_APPLY_CLOSE_SELECTOR + ", " +
    "button[aria-label*='Dismiss'], " +
    "button[aria-label*='Close'], " +
    "button.artdeco-modal__dismiss, " +
    "button.jobs-easy-apply-modal__close-btn, " +
    ".artdeco-modal__dismiss, " +
    "button[data-test-modal-close-btn]"
  )
  if (closeBtn) {
    console.log("[SOS] LinkedIn: Clicking Easy Apply modal close button (strategy 1)")
    scrollAndClick(closeBtn)
    if (await waitForModalClose(2_000)) return true
  }

  // Strategy 2: Press Escape to dismiss
  dispatchEscapeKey()
  document.dispatchEvent(
    new KeyboardEvent("keyup", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  )
  console.log("[SOS] LinkedIn: Dispatched Escape key to dismiss modal (strategy 2)")
  if (await waitForModalClose(2_000)) return true

  // Strategy 3: DOM-level removal
  console.log("[SOS] LinkedIn: Modal still present — removing from DOM (strategy 3)")
  const easyApplyModal = document.querySelector(EASY_APPLY_MODAL_SELECTOR)
  if (easyApplyModal) {
    easyApplyModal.remove()
    console.log("[SOS] LinkedIn: Removed Easy Apply modal element")
  }

  document.querySelectorAll(
    ".artdeco-modal-overlay, " +
    ".artdeco-modal-backdrop, " +
    "div[data-test-modal-overlay]"
  ).forEach((b) => b.remove())

  if (document.body.style.overflow === "hidden" || document.body.style.position === "fixed") {
    document.body.style.overflow = originalBodyOverflow
    document.body.style.position = originalBodyPosition
  }

  const detailPanel = document.querySelector(DETAIL_PANEL_SELECTOR)
  if (detailPanel) {
    detailPanel.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  }

  const gone = !document.querySelector(EASY_APPLY_MODAL_SELECTOR)
  if (gone) console.log("[SOS] LinkedIn: Modal successfully removed from DOM")
  return gone
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

/* ── Navigation: Search Term (DOM input manipulation) ── */

/**
 * Navigate to a new search term via DOM manipulation of the LinkedIn search input.
 * Uses waitForCondition to confirm the input value was set before dispatching Enter.
 * Uses waitForResults to wait for cards or empty state after search.
 */
export async function navigateToSearchTerm(term: string, signal?: AbortSignal): Promise<void> {
  console.log(`[SOS] LinkedIn: Navigating to search term "${term}"`)

  let input = await waitForElement<HTMLInputElement>(SEARCH_INPUT_SELECTOR, 10_000, signal)
  signal?.throwIfAborted()

  if (!input) {
    console.log("[SOS] LinkedIn: Primary search input selectors failed — trying text-based fallback")
    const allInputs = document.querySelectorAll<HTMLInputElement>("input[type='text'], input:not([type])")
    for (const inp of allInputs) {
      const placeholder = inp.placeholder?.toLowerCase() || ""
      const ariaLabel = inp.getAttribute("aria-label")?.toLowerCase() || ""
      if (placeholder.includes("search") || placeholder.includes("title") ||
          ariaLabel.includes("search") || ariaLabel.includes("title")) {
        input = inp
        break
      }
    }
  }

  if (!input) {
    throw new Error(`[SOS] LinkedIn: Could not find search input to navigate to "${term}"`)
  }

  // Focus the input first
  input.focus()
  input.click()

  // Clear existing value and wait for it to be empty
  setReactInputValue(input, "")
  try {
    await waitForCondition(() => input.value === "", { timeoutMs: 1_000, signal })
  } catch {
    // Continue even if value didn't clear (React might not update synchronously)
  }

  // Set the new term and wait for it to be set
  setReactInputValue(input, term)
  try {
    await waitForCondition(() => input.value === term, { timeoutMs: 1_000, signal })
  } catch {
    // Continue even if value didn't update (React might not update synchronously)
  }

  // Dispatch Enter key
  dispatchEnterKey(input)

  // Wait for results to appear (cards or empty state)
  await waitForResults(30_000, signal)
}

/* ── Navigation: Filters (pushState + popstate) ── */

/**
 * Apply URL-based filters via history.pushState + PopStateEvent.
 * Uses waitForResults to wait for cards or empty state after filter application.
 */
export async function applyFiltersViaPushState(
  site: SiteSettings,
  signal?: AbortSignal,
  overrides?: { datePosted?: string; sortBy?: string },
  currentSearchTerm?: string
): Promise<void> {
  const url = buildFilterUrl(site, overrides, currentSearchTerm)

  console.log(`[SOS] LinkedIn: Applying filters via pushState — ${url.search}`)
  pushStateNavigate(url)

  // Wait for results to update (cards or empty state)
  await waitForResults(10_000, signal)
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

/** Extract title from a LinkedIn job card. */
function extractCardTitle(card: HTMLAnchorElement): string {
  const titleEl = card.querySelector(
    ".job-card-list__title, " +
    ".job-card-container__link, " +
    ".artdeco-entity-lockup__title, " +
    ".job-card-container__primary-description"
  )
  if (titleEl?.textContent?.trim()) {
    return titleEl.textContent.trim()
  }

  const raw = card.textContent?.trim() || ""
  return raw.replace(/[ @·at]+\S.*$/, "").trim()
}

/** Extract company name from a LinkedIn job card. */
function extractCardCompany(card: HTMLAnchorElement): string {
  const fromCard = card.querySelector(
    ".job-card-container__company-name, " +
    ".artdeco-entity-lockup__subtitle, " +
    ".job-card-list__company-name"
  )?.textContent?.trim()
  if (fromCard) return fromCard

  const parent = card.closest("li, div, .job-card-container, .jobs-search-results__list-item")
  if (parent) {
    const fromParent = parent.querySelector<HTMLElement>(
      ".job-card-container__company-name, " +
      ".artdeco-entity-lockup__subtitle, " +
      ".job-card-list__company-name, " +
      ".artdeco-entity-lockup__caption"
    )?.textContent?.trim()
    if (fromParent) return fromParent
  }

  return "unknown"
}

/** Extract location from a LinkedIn job card. */
function extractCardLocation(card: HTMLAnchorElement): string {
  const fromCard = card.querySelector(
    ".job-card-container__metadata-item, " +
    ".artdeco-entity-lockup__caption, " +
    ".job-card-list__metadata-item"
  )?.textContent?.trim()
  if (fromCard) return fromCard

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
 */
async function waitForJobCards(timeoutMs = 15_000, signal?: AbortSignal): Promise<HTMLAnchorElement[] | null> {
  const existing = document.querySelectorAll<HTMLAnchorElement>(CARD_SELECTOR)
  if (existing.length > 0) return Array.from(existing)
  if (signal?.aborted) return null

  return new Promise((resolve) => {
    function onAbort(): void {
      observer.disconnect()
      clearTimeout(timer)
      resolve(null)
    }

    const observer = new MutationObserver(() => {
      const cards = document.querySelectorAll<HTMLAnchorElement>(CARD_SELECTOR)
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
      const cards = document.querySelectorAll<HTMLAnchorElement>(CARD_SELECTOR)
      resolve(cards.length > 0 ? Array.from(cards) : null)
    }, timeoutMs)
  })
}

/**
 * Read ALL job cards currently rendered in the list view.
 * Uses scroll → wait-for-new-cards pattern (mutation-based) instead of interval polling.
 * Max 5 scroll attempts.
 */
export async function readAllJobPreviews(maxCards: number, signal?: AbortSignal): Promise<JobPreview[]> {
  // Find the list scroller
  const scroller = await waitForElement(LIST_SCROLLER_SELECTOR, 8_000, signal)

  if (scroller && !signal?.aborted) {
    // Scroll → wait for new cards pattern (max 5 attempts)
    let cardCount = document.querySelectorAll(CARD_SELECTOR).length
    for (let attempt = 0; attempt < 5; attempt++) {
      if (signal?.aborted) break
      scroller.scrollTop = scroller.scrollHeight
      const newCount = await waitForNewElements(scroller, cardCount, {
        selector: CARD_SELECTOR,
        timeoutMs: 3_000,
        signal,
      })
      if (newCount <= cardCount) break // No new cards loaded
      cardCount = newCount
    }
  } else if (!signal?.aborted) {
    console.log("[SOS] LinkedIn: List scroller not found — scrolling window")
    window.scrollTo(0, document.body.scrollHeight)
  }

  const cardLinks = await waitForJobCards(15_000, signal)
  if (!cardLinks || cardLinks.length === 0) return []

  const readLimit = Math.min(cardLinks.length, 100)
  const previews: JobPreview[] = []

  for (let i = 0; i < readLimit; i++) {
    signal?.throwIfAborted()
    const card = cardLinks[i]
    if (!card) continue

    const jobId =
      card.getAttribute("data-occludable-job-id") ||
      card.closest("[data-occludable-job-id]")?.getAttribute("data-occludable-job-id") ||
      card.getAttribute("href")?.match(/\/jobs\/view\/(\d+)/)?.[1] ||
      `fallback-${i}`

    const href = (card instanceof HTMLAnchorElement ? card.href : "") ||
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

  console.log(`[SOS] LinkedIn: Read ${previews.length} job previews`)
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

/* ── Pipeline state persistence ── */

/**
 * Load persisted pipeline state from storage.
 */
async function loadPipelineState(): Promise<PipelinePersistedState | null> {
  try {
    const result = await browser.storage.local.get(PIPELINE_STATE_KEY)
    const state = result[PIPELINE_STATE_KEY] as PipelinePersistedState | undefined
    return state ?? null
  } catch {
    return null
  }
}


/**
 * Save pipeline state to storage for crash recovery.
 */
async function savePipelineState(state: PipelinePersistedState): Promise<void> {
  try {
    await browser.storage.local.set({
      [PIPELINE_STATE_KEY]: { ...state, timestamp: Date.now() },
    })
  } catch (e) {
    console.warn("[SOS] LinkedIn: Failed to save pipeline state:", e)
  }
}

/**
 * Clear persisted pipeline state.
 */
async function clearPipelineState(): Promise<void> {
  try {
    await browser.storage.local.remove(PIPELINE_STATE_KEY)
  } catch {
    // Ignore
  }
}

/* ── Retry wrapper ── */


/**
 * Retry a function up to `maxRetries` times with exponential backoff.
 * Uses waitForCondition (mutation-based) between retries instead of delay().
 */
async function retryApply<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  signal?: AbortSignal
): Promise<T> {
  let lastError: unknown

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    signal?.throwIfAborted()
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        console.log(`[SOS] LinkedIn: Retry attempt ${attempt}/${maxRetries} after error:`, err)
        // Wait for DOM mutations instead of a fixed delay
        try {
          await waitForCondition(
            () => {
              // Wait for any DOM change (indicates page state has updated)
              return document.querySelectorAll(CARD_SELECTOR).length > 0
            },
            { timeoutMs: 2_000 * attempt, signal }
          )
        } catch {
          // Timeout waiting — continue to retry anyway
        }
      }
    }
  }

  throw lastError
}

/* ── Pipeline orchestrator ── */

/**
 * Run the full LinkedIn pipeline for a single site configuration.
 *
 * Flow:
 *   1. Login check + anti-bot check
 *   2. Search term shuffling (if enabled)
 *   3. State restoration (crash recovery)
 *   4. Date/sort cycling (if enabled)
 *   5. For each search term:
 *      a. Navigate to term
 *      b. Apply URL-based filters via pushState
 *      c. Apply DOM-based filters (under 10 applicants, etc.)
 *      d. Read all job previews (scroll → wait pattern)
 *      e. Filter by company allow/block list
 *      f. For each job:
 *         - Read job description (wait for detail panel)
 *         - Apply to job (validate + Easy Apply)
 *         - randomDelay(1000, 2000) between jobs for visual feedback
 *         - Modal double-close check
 *   6. State persistence between jobs
 */
export async function runLinkedInPipeline(
  site: SiteSettings,
  signal: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<void> {
  console.log("[SOS] LinkedIn: Pipeline started")

  // Step 1: Login check
  if (!isLinkedInLoggedIn()) {
    throw new Error("Not logged into LinkedIn — please log in first")
  }

  // Step 2: Anti-bot check
  if (detectAntiBotInterstitial()) {
    throw new Error("LinkedIn anti-bot interstitial detected — please complete verification")
  }

  // Step 3: Prepare search terms
  let searchTerms = [...site.search.searchTerms]
  if (site.search.randomizeSearchOrder) {
    searchTerms = searchTerms.sort(() => Math.random() - 0.5)
    console.log("[SOS] LinkedIn: Randomized search term order")
  }

  // Step 4: Load persisted state (crash recovery)
  const persistedState = await loadPipelineState()
  let startTermIndex = 0
  let startJobIndex = 0
  let totalProcessed = 0
  let sortToggle = false
  let dateCycleIndex = 0

  if (persistedState) {
    startTermIndex = persistedState.termIndex
    startJobIndex = persistedState.jobIndex
    totalProcessed = persistedState.totalProcessed
    sortToggle = persistedState.sortToggle
    dateCycleIndex = persistedState.dateCycleIndex
    console.log(
      `[SOS] LinkedIn: Restored state — term ${startTermIndex}, job ${startJobIndex}, ` +
      `total ${totalProcessed}`
    )
  }

  // Step 5: Date/sort cycling setup
  const cycleDate = site.pipeline.cycleDatePosted
  const alternateSort = site.pipeline.alternateSortby
  const stopAt24hr = site.pipeline.stopDateCycleAt24hr

  // Step 6: Process each search term
  for (let termIdx = startTermIndex; termIdx < searchTerms.length; termIdx++) {
    signal?.throwIfAborted()
    const term = searchTerms[termIdx]
    onProgress?.(`Searching: "${term}" (${termIdx + 1}/${searchTerms.length})`)

    // Determine date posted and sort for this term
    const dateOverride = cycleDate ? DATE_POSTED_VALUES[dateCycleIndex % DATE_POSTED_VALUES.length] : undefined
    const sortOverride = alternateSort ? SORT_VALUES[sortToggle ? 1 : 0] : undefined

    // Step 6a: Navigate to search term (catch timeout gracefully — skip term)
    onProgress?.(`Navigating to "${term}"...`)
    try {
      await navigateToSearchTerm(term, signal)
    } catch (err) {
      console.warn(`[SOS] LinkedIn: Failed to navigate to "${term}":`, err)
      continue
    }

    // Step 6b: Apply URL-based filters via pushState (catch timeout gracefully)
    onProgress?.(`Applying filters for "${term}"...`)
    try {
      await applyFiltersViaPushState(site, signal, { datePosted: dateOverride, sortBy: sortOverride }, term)
    } catch (err) {
      console.warn(`[SOS] LinkedIn: Failed to apply filters for "${term}":`, err)
      continue
    }


    // Step 6c: Apply DOM-based filters
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

    // Step 6f: Process each job
    for (let jobIdx = startJobIndex; jobIdx < filteredPreviews.length; jobIdx++) {
      signal?.throwIfAborted()
      const job = filteredPreviews[jobIdx]
      totalProcessed++

      onProgress?.(`Reading: "${job.title}" @ "${job.company}" (${jobIdx + 1}/${filteredPreviews.length})`)

      // Read job description
      const description = await readJobDescription(job, signal)
      if (!description) {
        console.warn(`[SOS] LinkedIn: Could not read description for "${job.title}" — skipping`)
        continue
      }

      // Find the detail panel for Easy Apply
      const detailPanel = document.querySelector(DETAIL_PANEL_SELECTOR)
      if (!detailPanel) {
        console.warn("[SOS] LinkedIn: Detail panel not found after reading description")
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

      // Visual feedback delay between jobs (only exception to mutation-based waiting)
      if (jobIdx < filteredPreviews.length - 1) {
        onProgress?.(`Waiting before next job...`)
        await randomDelay(1000, 2000, signal)
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
  console.log("[SOS] LinkedIn: Pipeline completed successfully")
  onProgress?.(`Pipeline complete — processed ${totalProcessed} jobs`)
}

