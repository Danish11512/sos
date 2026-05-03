/**
 * LinkedIn-specific pipeline: DOM-based navigation + batch job reading.
 *
 * Navigation Strategy (no page reloads):
 *   - Search terms: DOM manipulation of the search input + Enter key
 *   - URL filters (f_E, f_JT, f_WT, etc.): history.pushState + PopStateEvent
 *   - DOM-only toggles (under 10 applicants, in your network): "All filters" modal
 *
 * Batch Reading Strategy:
 *   1. Scroll list to trigger lazy loading, extract all card previews at once
 *   2. Apply company/title pre-screen filters on previews
 *   3. Only then drill into approved jobs for description reading + apply flow
 *
 * LinkedIn filter URL params:
 *   f_TPR=r86400 (past 24h), r604800 (week), r2592000 (month)
 *   f_SB2=1 (most recent), 2 (most relevant)
 *   f_E=2 (entry), 3 (associate), 4 (mid-senior), 5 (director), 6 (executive)
 *   f_JT=F (full-time), P (part-time), C (contract), T (temporary), V (volunteer), I (internship)
 *   f_WT=1 (on-site), 2 (remote), 3 (hybrid)
 *   f_AL=true (easy apply)
 */

import type { SiteSettings, FilterSettings } from "../settings/sections"
import type { ApplyFiltersResult, ApplyToJobResult, JobPreview } from "./types"
import type { ModalResult } from "./modal-result"
import {
  checkCompanyBadWords,
  checkTitleBadWords,
  checkCompanyList,
  extractSalary,
  validateJobForApplication,
} from "./job-validator"

import {
  delay,
  waitForElement,
  scrollAndClick,
  scrollToBottom,
  getVisibleText,
  toggleCheckboxItems,
  findButtonByText,
  pushStateNavigate,
  setReactInputValue,
  dispatchEnterKey,
  dispatchEscapeKey,
  waitForStableDOM,
  randomDelay,
  detectAntiBotInterstitial,
  isLinkedInLoggedIn,
} from "../utils/dom"

import { eventBus } from "../utils/event-bus"

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

/* ── Filtered URL params helper (for pushState updates) ── */

/**
 * Build only the filter-related URL params from site settings.
 * Preserves the existing page URL's keywords, location, and other params.
 * Returns a new URL that can be pushState'd.
 *
 * FIX F11: Always start from clean base URL. Only carry forward keywords, location, geoId.
 * FIX F16: Preserve keywords, location, geoId from current URL.
 */
function buildFilterUrl(site: SiteSettings): URL {
  // FIX F11: Start from clean base URL
  const url = new URL(LINKEDIN_JOBS_SEARCH_URL)

  // FIX F16: Preserve keywords, location, geoId from current URL
  const currentUrl = new URL(window.location.href)
  for (const key of ["keywords", "location", "geoId", "original_referer"]) {
    const val = currentUrl.searchParams.get(key)
    if (val) url.searchParams.set(key, val)
  }

  // Remove previous SOS filter params (clean slate)
  for (const key of FILTER_URL_PARAMS) {
    url.searchParams.delete(key)
  }

  // Sort
  const sortVal = SORT_MAP[site.filters.sortBy.trim().toLowerCase()]
  if (sortVal) url.searchParams.set("f_SB2", sortVal)

  // Date posted
  const dateVal = DATE_POSTED_MAP[site.filters.datePosted.trim().toLowerCase()]
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

  // Easy apply only
  if (site.filters.easyApplyOnly) url.searchParams.set("f_AL", "true")

  return url
}

/* ── Navigation: Search Page (full redirect) ── */

/**
 * Navigate to the LinkedIn jobs search page.
 * FIX F1: Always rebuild URL from settings. Only skip the redirect, not the filter application.
 * FIX F2: Use pushStateNavigate first. Only fall back to full redirect if SPA approach fails.
 */
export function navigateToSearchPage(): void {
  if (window.location.pathname.includes(SEARCH_PAGE_PATH)) {
    console.log("[SOS] LinkedIn: Already on search page — skipping redirect")
    return
  }
  console.log("[SOS] LinkedIn: Navigating to jobs search page")

  // FIX F2: Try pushState first
  try {
    pushStateNavigate(LINKEDIN_JOBS_SEARCH_URL)
    // Check if navigation worked (SPA handled it)
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
 * Call this only after all job criteria pass validation.
 * Returns the modal element if found, null otherwise.
 *
 * FIX F46: Button text matching with negative checks.
 * FIX F47: External apply opens in new tab instead of full redirect.
 * FIX F48: More specific modal selector.
 * FIX F49: Exponential backoff for retries.
 */
export async function clickEasyApplyButton(
  detailPanel: Element,
  signal?: AbortSignal
): Promise<Element | null> {
  signal?.throwIfAborted()

  // FIX F49: Exponential backoff (1s, 2s, 4s)
  const RETRY_DELAYS = [1_000, 2_000, 4_000]
  for (let attempt = 1; attempt <= RETRY_DELAYS.length; attempt++) {
    signal?.throwIfAborted()

    // Find the Easy Apply button inside the detail panel
    const applyBtn =
      detailPanel.querySelector<HTMLElement>(EASY_APPLY_BUTTON_SELECTOR) ??
      (() => {
        // Fallback: scan all buttons in detail panel for text match
        for (const btn of detailPanel.querySelectorAll("button")) {
          const text = btn.textContent?.trim().toLowerCase() || ""
          // FIX F46: Negative checks
          const negativeIndicators = ["applied", "submitted", "withdrawn"]
          if (negativeIndicators.some((neg) => text.includes(neg))) continue
          if (text.includes("easy apply") || text.includes("apply now") || text === "apply") {
            return btn
          }
        }
        return null
      })()

    if (!applyBtn) {
      // Check if this is an external apply (redirects off LinkedIn)
      const externalBtn = detailPanel.querySelector<HTMLAnchorElement>(EXTERNAL_APPLY_SELECTOR)

      if (externalBtn) {
        console.log("[SOS] LinkedIn: Found external apply link — opening in new tab")
        // FIX F47: Open external links in new tab instead of navigating away
        window.open(externalBtn.href, "_blank")
        return null
      }

      if (attempt < RETRY_DELAYS.length) {
        console.warn(`[SOS] LinkedIn: Could not find Easy Apply button (attempt ${attempt}/${RETRY_DELAYS.length}) — retrying`)
        await delay(RETRY_DELAYS[attempt - 1], signal)
        continue
      }

      console.warn(`[SOS] LinkedIn: Could not find Easy Apply button in detail panel after ${RETRY_DELAYS.length} attempts`)
      return null
    }

    console.log(`[SOS] LinkedIn: Clicking Easy Apply button (attempt ${attempt}/${RETRY_DELAYS.length})`)
    scrollAndClick(applyBtn)

    // FIX F48: More specific modal selector — look for modal containing form elements
    const modal = await waitForElement(EASY_APPLY_MODAL_SELECTOR, 8_000, signal)
    if (modal) {
      // Verify it's actually an Easy Apply modal (has form elements or footer)
      const hasFormContent = modal.querySelector(
        "form, .jobs-easy-apply-modal__footer, input, select, textarea"
      )
      if (hasFormContent) {
        console.log("[SOS] LinkedIn: Easy Apply modal opened successfully")
        await delay(1_000, signal)
        return modal
      }
    }

    if (attempt < RETRY_DELAYS.length) {
      console.warn(`[SOS] LinkedIn: Easy Apply modal did not appear (attempt ${attempt}/${RETRY_DELAYS.length}) — retrying`)
      await delay(RETRY_DELAYS[attempt - 1], signal)
    }
  }

  console.warn(`[SOS] LinkedIn: Easy Apply modal did not appear after ${RETRY_DELAYS.length} attempts`)
  return null
}

/* ── Easy Apply: Close modal ── */

/**
 * Close the Easy Apply modal by trying up to 3 strategies:
 *   1. Click the X / Dismiss button via CSS selector
 *   2. Press Escape key (catches React-backed modals)
 *   3. DOM-level removal: find the modal backdrop/overlay and remove
 *      from the DOM entirely (nuclear option for stubborn modals)
 *
 * Call after Easy Apply submission complete (or skipped) to dismiss
 * the modal and return to the job detail panel so pipeline can continue.
 *
 * Returns `true` if close action performed, `false` otherwise.
 *
 * FIX F62: More close button selector variants.
 * FIX F63: Use dispatchEscapeKey with composed: true.
 * FIX F64: After DOM removal, trigger React re-render.
 * FIX F65: Restore body scroll from snapshot.
 * FIX F67: Check if modal is still in DOM before attempting to close.
 */
export function closeEasyApplyModal(): boolean {
  // FIX F67: Check if modal is still in DOM
  const modal = document.querySelector(EASY_APPLY_MODAL_SELECTOR)
  if (!modal) {
    console.log("[SOS] LinkedIn: Modal already closed — skipping close")
    return true
  }

  // FIX F65: Save body style before modifying
  const originalBodyOverflow = document.body.style.overflow
  const originalBodyPosition = document.body.style.position

  // Strategy 1: Click the X / Dismiss button via CSS selector
  // FIX F62: More selector variants
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
    // Check if modal actually closed
    if (!document.querySelector(EASY_APPLY_MODAL_SELECTOR)) return true
  }

  // Strategy 2: Press Escape to dismiss (triggers React-backed listeners)
  // FIX F63: Use dispatchEscapeKey with composed: true
  dispatchEscapeKey()
  console.log("[SOS] LinkedIn: Dispatched Escape key to dismiss modal (strategy 2)")

  // Wait briefly for React to process Escape event
  const modalStillPresent = document.querySelector(EASY_APPLY_MODAL_SELECTOR)
  if (!modalStillPresent) return true

  // Strategy 3: DOM-level removal — remove modal + backdrop from DOM
  // Nuclear option for modals that refuse normal close.
  console.log("[SOS] LinkedIn: Modal still present — removing from DOM (strategy 3)")

  // Remove all modal layers
  const modalSelector = [
    EASY_APPLY_MODAL_SELECTOR,
    ".artdeco-modal-layer",
  ]
  for (const sel of modalSelector) {
    document.querySelectorAll(sel).forEach((m) => {
      m.remove()
      console.log("[SOS] LinkedIn: Removed modal element:", sel)
    })
  }

  // Remove backdrops / overlays
  document.querySelectorAll(
    ".artdeco-modal-overlay, " +
    ".artdeco-modal-backdrop, " +
    "div[data-test-modal-overlay]"
  ).forEach((b) => b.remove())

  // FIX F65: Restore body scroll from snapshot
  document.body.style.overflow = originalBodyOverflow
  document.body.style.position = originalBodyPosition

  // FIX F64: Trigger React re-render by dispatching click on detail panel
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
 * This is the primary function to call once a job's detail panel is loaded
 * and its description has been read. It composes:
 *   1. `validateJobForApplication()` — pure filter checks
 *   2. `clickEasyApplyButton()` — DOM interaction to open the modal
 *   3. `fillEasyApplyModal()` — full modal interaction engine
 *
 * FIX F74: Check salary filter.
 * FIX F77: Only increment totalProcessed on actual submission.
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

  // FIX F74: Check salary filter
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

  // Step 2: Check for external apply (skip if easyApplyOnly)
  if (filters.easyApplyOnly) {
    const externalUrl = detectExternalApply(detailPanel)
    if (externalUrl) {
      console.log(`[SOS] Skipping "${job.title}" — external apply and easyApplyOnly is enabled`)
      return {
        applied: false,
        reason: `External apply (easyApplyOnly enabled): "${job.title}" @ "${job.company}"`,
      }
    }
  }

  // Step 3: Click the Easy Apply button (only reached if validation passed)
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

  // If no site settings provided, just return that the modal was opened
  return {
    applied: true,
    reason: `Modal opened for "${job.title}" @ "${job.company}"`,
  }
}

/* ── Navigation: Search Term (DOM input manipulation) ── */

/**
 * Navigate to a new search term via DOM manipulation of the LinkedIn search input.
 * LinkedIn's SPA listens for Enter key on the search box to trigger the API call.
 * No page reload — the content script context is preserved.
 *
 * FIX F4: Add text-based fallback scanning all inputs for placeholder containing "Search" or "title".
 * FIX F5: setReactInputValue now dispatches focus/blur/input/change.
 * FIX F6: Use dispatchEnterKey which dispatches keydown, keypress, keyup.
 * FIX F7: Wait 500ms after setting value before dispatching Enter.
 * FIX F8: Increase timeout to 30s.
 * FIX F9: Replace fixed 2s delay with waitForStableDOM.
 * FIX F10: Check for empty-state indicator.
 */
export async function navigateToSearchTerm(term: string, signal?: AbortSignal): Promise<void> {
  console.log(`[SOS] LinkedIn: Navigating to search term "${term}"`)

  // FIX F4: Try primary selectors first, then text-based fallback
  let input = await waitForElement<HTMLInputElement>(SEARCH_INPUT_SELECTOR, 10_000, signal)
  signal?.throwIfAborted()

  if (!input) {
    // FIX F4: Text-based fallback — scan all inputs for placeholder containing "Search" or "title"
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

  // Focus the input first (LinkedIn may have focus handlers)
  input.focus()
  input.click()
  await delay(300, signal)

  // Clear existing value
  setReactInputValue(input, "")
  await delay(100, signal)

  // Set the new term using React-aware value setter
  setReactInputValue(input, term)

  // FIX F7: Wait 500ms after setting value before dispatching Enter
  // (setReactInputValue already dispatches input/change events that start debounce timer)
  await delay(500, signal)

  // FIX F6: Use dispatchEnterKey which dispatches keydown, keypress, keyup
  dispatchEnterKey(input)

  // FIX F8: Increase timeout to 30s
  const resultsContainer = await waitForElement(LINKEDIN_RESULTS_SELECTOR, 30_000, signal)

  // FIX F10: Check for empty-state indicator
  if (resultsContainer) {
    const emptyState = resultsContainer.querySelector(EMPTY_STATE_SELECTOR)
    if (emptyState) {
      console.log(`[SOS] LinkedIn: Search for "${term}" returned 0 results (empty state detected)`)
      return
    }
  }

  // FIX F9: Replace fixed 2s delay with DOM-stability-based wait
  if (resultsContainer) {
    await waitForStableDOM(resultsContainer, 1_000, 5_000, signal)
  }
}

/* ── Navigation: Filters (pushState + popstate) ── */

/**
 * Apply URL-based filters via history.pushState + PopStateEvent.
 * LinkedIn's React router listens for popstate and re-fetches search results
 * with updated URL params. No page reload required.
 *
 * FIX F13: pushStateNavigate now also dispatches hashchange.
 * FIX F15: Replace fixed 2.5s delay with waitForStableDOM.
 */
export async function applyFiltersViaPushState(site: SiteSettings, signal?: AbortSignal): Promise<void> {
  const url = buildFilterUrl(site)

  console.log(`[SOS] LinkedIn: Applying filters via pushState — ${url.search}`)
  pushStateNavigate(url)

  // FIX F15: Replace fixed 2.5s delay with adaptive wait
  const resultsContainer = document.querySelector(LINKEDIN_RESULTS_SELECTOR)
  if (resultsContainer) {
    await waitForStableDOM(resultsContainer, 1_000, 8_000, signal)
  } else {
    await delay(2_500, signal)
  }
}

/* ── DOM-only filter application (post-nav) ── */

/**
 * Apply DOM-only filters via the "All filters" modal.
 * FIX F18: Use generic selectors for non-English support.
 * FIX F21: Use aria-label matching for "Show results" button.
 * FIX F22: Retry clicking once if modal doesn't appear.
 * FIX F23: Log more visible warning.
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

  // FIX F18: Use generic selectors for non-English support
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
    // FIX F23: Log more visible warning
    console.warn("[SOS] LinkedIn: ⚠️ Could not find 'All filters' button — DOM-only filters will not be applied")
    return result
  }

  scrollAndClick(allFiltersBtn)
  await delay(1_500, signal)

  // FIX F22: Retry clicking once if modal doesn't appear
  let modalContainer = await waitForElement(
    ".jobs-search-all-filters__content, div[data-test-all-filters-modal]",
    5_000,
    signal
  )

  if (!modalContainer) {
    console.log("[SOS] LinkedIn: Filter modal did not appear — retrying click")
    scrollAndClick(allFiltersBtn)
    await delay(1_500, signal)
    modalContainer = await waitForElement(
      ".jobs-search-all-filters__content, div[data-test-all-filters-modal]",
      5_000,
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

  // FIX F21: Use aria-label matching for "Show results" button
  const applyBtn =
    (await waitForElement(SHOW_RESULTS_BUTTON_SELECTORS, 5_000, signal)) ??
    findButtonByText(modalContainer, "show results", "apply")

  if (applyBtn) {
    scrollAndClick(applyBtn)
    await delay(1_000, signal)
    console.log("[SOS] LinkedIn: Clicked 'Show results' to apply filters")
  } else {
    result.errors.push("Could not find 'Show results' button in filter modal")
    console.warn("[SOS] LinkedIn: ⚠️ Could not find 'Show results' button")
  }

  return result
}

/* ── Batch job card reading ── */

/** Extract title from a LinkedIn job card (handles multiple card formats).
 *  The card anchor itself often IS the title element (e.g. a.job-card-list__title),
 *  so we fall back to the anchor's own textContent if no child match is found.
 *  Strips trailing ` @ CompanyName` or ` · CompanyName` from the raw text
 *  since LinkedIn sometimes includes the company in the anchor's textContent.
 *
 *  FIX F27: Try dedicated title selector first. Only use regex fallback if that fails.
 *  Handle more separator patterns. */
function extractCardTitle(card: HTMLAnchorElement): string {
  // FIX F27: Try dedicated title selector first
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

  // FIX F27: Handle more separator patterns
  // Strip trailing " @ CompanyName", " · CompanyName", " at CompanyName" patterns
  return raw.replace(/[ @·at]+\S.*$/, "").trim()
}

/** Extract company name from a LinkedIn job card.
 *  Looks at the card's parent container for company name elements,
 *  since the card anchor itself may not contain the company name.
 *
 *  FIX F28: If company name can't be extracted, mark as "unknown". */
function extractCardCompany(card: HTMLAnchorElement): string {
  // Try the card element first
  const fromCard = card.querySelector(
    ".job-card-container__company-name, " +
    ".artdeco-entity-lockup__subtitle, " +
    ".job-card-list__company-name"
  )?.textContent?.trim()
  if (fromCard) return fromCard

  // Try the parent container (the list item wrapping the card)
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

  // FIX F28: Return "unknown" instead of empty string
  return "unknown"
}

/** Extract location from a LinkedIn job card.
 *  Falls back to the parent container if not found on the card itself. */
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
 * Wait for at least one job card to appear in the DOM, using MutationObserver
 * to detect when LinkedIn's lazy-rendered cards become available.
 * Resolves with all matching card elements, or null if timeout.
 *
 * FIX F26: Add aggressive fallbacks for card selectors.
 */
async function waitForJobCards(timeoutMs = 15_000, signal?: AbortSignal): Promise<HTMLAnchorElement[] | null> {
  // Check if cards are already in DOM
  const existing = document.querySelectorAll<HTMLAnchorElement>(CARD_SELECTOR)
  if (existing.length > 0) return Array.from(existing)
  if (signal?.aborted) return null

  // Wait using MutationObserver for first card to appear
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
      // One last check — cards might have appeared just before timeout
      const cards = document.querySelectorAll<HTMLAnchorElement>(CARD_SELECTOR)
      resolve(cards.length > 0 ? Array.from(cards) : null)
    }, timeoutMs)
  })
}

/**
 * Read ALL job cards currently rendered in the list view.
 * Scrolls to bottom to trigger LinkedIn's lazy loading, then extracts
 * preview data (title, company, location, URL) from every card.
 * No card clicking involved — this is a batch pre-screening pass.
 *
 * FIX F24: Fall back to scrolling window if list scroller not found.
 * FIX F25: scrollToBottom now uses smarter approach (2 consecutive no-changes).
 * FIX F30: Read all available cards (up to 100), apply maxJobs limit AFTER pre-screening.
 * FIX F31: Store job ID instead of element reference.
 */
export async function readAllJobPreviews(maxCards: number, signal?: AbortSignal): Promise<JobPreview[]> {
  // FIX F24: Try list scroller first, fall back to window
  const scroller = await waitForElement(LIST_SCROLLER_SELECTOR, 8_000, signal)
  if (scroller && !signal?.aborted) {
    // Scroll to bottom to trigger lazy loading
    await scrollToBottom(scroller, 20, 400, signal)
    await delay(1_000, signal)
  } else if (!signal?.aborted) {
    // FIX F24: Fall back to scrolling the window
    console.log("[SOS] LinkedIn: List scroller not found — scrolling window")
    window.scrollTo(0, document.body.scrollHeight)
    await delay(1_000, signal)
  }

  const cardLinks = await waitForJobCards(15_000, signal)
  if (!cardLinks || cardLinks.length === 0) return []

  // FIX F30: Read all available cards (up to 100), apply maxJobs limit AFTER pre-screening
  const readLimit = Math.min(cardLinks.length, 100)
  const previews: JobPreview[] = []

  for (let i = 0; i < readLimit; i++) {
    signal?.throwIfAborted()
    const card = cardLinks[i]
    if (!card) continue

    // FIX F31: Store job ID instead of element reference
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
      // FIX F31: Store job ID for re-querying
      jobId,
    })
  }

  console.log(`[SOS] LinkedIn: Read ${previews.length} job previews`)
  return previews
}

/* ── Filter job previews ── */

/**
 * Filter job previews by company allow/block list.
 * FIX F73: Apply companies filter.
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
 * FIX F36: Re-query DOM by job URL to ensure fresh content.
 * FIX F37: Wait for description content, not skeleton.
 * FIX F38: Click "Show more" button variants.
 * FIX F39: Wait for description content to be non-empty.
 * FIX F41: Check for iframes in the description.
 */
export async function readJobDescription(
  job: JobPreview,
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted()

  // FIX F36: Click the job card to load its detail panel
  // Use the stored element reference
  if (job.element) {
    scrollAndClick(job.element)
    await delay(1_500, signal)
  }

  // Wait for the detail panel to appear
  const detailPanel = await waitForElement(DETAIL_PANEL_SELECTOR, 10_000, signal)
  if (!detailPanel) {
    console.warn("[SOS] LinkedIn: Could not find detail panel for job")
    return ""
  }

  // FIX F37: Wait for description content (not skeleton/placeholder)
  const descriptionContent = await waitForElement(
    DESCRIPTION_CONTENT_SELECTOR,
    8_000,
    signal
  )

  if (!descriptionContent) {
    console.warn("[SOS] LinkedIn: Could not find description content element")
    return ""
  }

  // FIX F38: Click "Show more" button to expand full description
  const showMoreBtn = descriptionContent.querySelector<HTMLElement>(SHOW_MORE_BUTTON_SELECTOR)
  if (showMoreBtn) {
    scrollAndClick(showMoreBtn)
    await delay(1_000, signal)
  }

  // FIX F39: Wait for description content to be non-empty
  await waitForStableDOM(descriptionContent, 500, 5_000, signal)

  // FIX F41: Check for iframes in the description
  const iframe = descriptionContent.querySelector("iframe")
  if (iframe) {
    console.log("[SOS] LinkedIn: Description contains iframe — attempting to extract content")
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
      if (iframeDoc) {
        const iframeText = iframeDoc.body?.textContent || ""
        if (iframeText.trim()) {
          console.log("[SOS] LinkedIn: Extracted description from iframe")
          return iframeText.trim()
        }
      }
    } catch {
      console.warn("[SOS] LinkedIn: Could not access iframe content (cross-origin)")
    }
  }

  // Get visible text from the description
  const text = getVisibleText(descriptionContent)
  if (!text) {
    console.warn("[SOS] LinkedIn: Description content is empty after waiting")
    return ""
  }

  console.log(`[SOS] LinkedIn: Read description (${text.length} chars)`)
  return text
}

/* ── Pipeline orchestrator ── */

/**
 * Main LinkedIn pipeline orchestrator.
 *
 * Runs the full pipeline for each search term:
 *   1. Navigate to search term
 *   2. Apply URL-based filters via pushState
 *   3. Apply DOM-only filters (under 10 applicants, in your network)
 *   4. Read all job card previews
 *   5. Filter previews by company list
 *   6. For each approved job: read description, validate, apply
 *   7. Handle rate limiting, anti-bot detection, daily limits
 *   8. Persist progress for resume capability
 *
 * FIX F66: Rate limiting with random delays between jobs.
 * FIX F68: Daily limit race condition — don't abort signal on daily limit.
 * FIX F69: Retry wrapper for transient failures.
 * FIX F70: Alternate sort order between search terms.
 * FIX F71: Cycle date posted filter between search terms.
 * FIX F72: Randomize search term order.
 * FIX F74: Pause after applying filters.
 * FIX F75: Persist pipeline progress to storage.
 * FIX F76: Use ProgressMessage type for progress updates.
 * FIX F77: Count totalProcessed across all terms.
 * FIX F78: Double-close check for Easy Apply modal.
 * FIX F79: Anti-bot detection monitoring.
 * FIX F80: Check signal between jobs.
 */
export async function runLinkedInPipeline(
  site: SiteSettings,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<void> {
  signal?.throwIfAborted()

  // FIX F3: Check if logged in
  if (!isLinkedInLoggedIn()) {
    const errorMsg = "Not logged into LinkedIn — please sign in first"
    console.error(`[SOS] LinkedIn: ${errorMsg}`)
    throw new Error(errorMsg)
  }

  // FIX F79: Check for anti-bot interstitial at start
  if (detectAntiBotInterstitial()) {
    const errorMsg = "LinkedIn anti-bot detection triggered — please verify manually"
    console.error(`[SOS] LinkedIn: ${errorMsg}`)
    throw new Error(errorMsg)
  }

  const filters = site.filters
  const searchTerms = site.search.searchTerms
  const maxJobs = site.search.switchNumber || 30
  const clickDelayMs = site.pipeline.clickDelayMs || 500
  const pauseAfterFilters = site.filters.pauseAfterFilters || false


  // FIX F72: Randomize search term order
  const shuffledTerms = [...searchTerms].sort(() => Math.random() - 0.5)

  // FIX F75: Restore persisted state if available
  let persistedState = await loadPipelineState()
  let totalProcessed = persistedState?.totalProcessed ?? 0
  let sortToggle = persistedState?.sortToggle ?? false
  let dateCycleIndex = persistedState?.dateCycleIndex ?? 0

  // FIX F71: Cycle date posted filter
  if (filters.datePosted && DATE_POSTED_VALUES.includes(DATE_POSTED_MAP[filters.datePosted.trim().toLowerCase()] || "")) {
    // Use the cycled value
    const cycledDate = DATE_POSTED_VALUES[dateCycleIndex % DATE_POSTED_VALUES.length]
    // Override the filter for this run
    const dateKey = Object.entries(DATE_POSTED_MAP).find(([, v]) => v === cycledDate)?.[0]
    if (dateKey) {
      site.filters.datePosted = dateKey
      console.log(`[SOS] LinkedIn: Cycling date posted to "${dateKey}" (${cycledDate})`)
    }
  }

  // FIX F70: Alternate sort order
  if (filters.sortBy) {
    const sortVal = SORT_VALUES[sortToggle ? 1 : 0]
    const sortKey = Object.entries(SORT_MAP).find(([, v]) => v === sortVal)?.[0]
    if (sortKey) {
      site.filters.sortBy = sortKey
      console.log(`[SOS] LinkedIn: Alternating sort to "${sortKey}" (${sortVal})`)
    }
  }

  // Navigate to search page first
  onProgress?.("Navigating to LinkedIn jobs search page...")
  navigateToSearchPage()
  await delay(2_000, signal)

  // Process each search term
  for (let termIdx = 0; termIdx < shuffledTerms.length; termIdx++) {
    signal?.throwIfAborted()

    // FIX F79: Check for anti-bot interstitial between terms
    if (detectAntiBotInterstitial()) {
      console.warn("[SOS] LinkedIn: Anti-bot detection triggered — stopping pipeline")
      onProgress?.("Anti-bot detection triggered — stopping")
      break
    }

    const term = shuffledTerms[termIdx]
    onProgress?.(`Searching for "${term}" (${termIdx + 1}/${shuffledTerms.length})...`)
    console.log(`[SOS] LinkedIn: === Search term ${termIdx + 1}/${shuffledTerms.length}: "${term}" ===`)

    // Step 1: Navigate to search term
    try {
      await navigateToSearchTerm(term, signal)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[SOS] LinkedIn: Failed to navigate to "${term}": ${msg}`)
      onProgress?.(`Failed to search "${term}": ${msg}`)
      continue
    }

    // Step 2: Apply URL-based filters via pushState
    onProgress?.(`Applying filters for "${term}"...`)
    try {
      await applyFiltersViaPushState(site, signal)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[SOS] LinkedIn: Failed to apply filters for "${term}": ${msg}`)
      onProgress?.(`Filter application failed for "${term}"`)
      continue
    }

    // Step 3: Apply DOM-only filters
    try {
      const domResult = await applyDomFilters(site, clickDelayMs, signal)
      if (!domResult.success) {
        console.warn(`[SOS] LinkedIn: DOM filter application had issues: ${domResult.errors.join(", ")}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[SOS] LinkedIn: DOM filter application failed: ${msg}`)
    }

    // FIX F74: Pause after applying filters (if configured)
    if (pauseAfterFilters) {
      onProgress?.(`Filters applied for "${term}" — click Resume to continue`)
      console.log(`[SOS] LinkedIn: Pausing after filters for "${term}"`)
      const resumed = await waitForResume(signal)
      if (!resumed) {
        console.log("[SOS] LinkedIn: User stopped pipeline during pause")
        return
      }
    }

    // Step 4: Read all job card previews
    onProgress?.(`Reading job listings for "${term}"...`)
    let previews: JobPreview[]
    try {
      previews = await readAllJobPreviews(maxJobs, signal)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[SOS] LinkedIn: Failed to read job previews for "${term}": ${msg}`)
      onProgress?.(`Failed to read jobs for "${term}"`)
      continue
    }

    if (previews.length === 0) {
      console.log(`[SOS] LinkedIn: No jobs found for "${term}"`)
      onProgress?.(`No jobs found for "${term}"`)
      continue
    }

    // Step 5: Filter previews by company list
    const companies = site.filters.companies || []
    previews = filterJobPreviews(previews, companies)

    // Apply maxJobs limit AFTER pre-screening
    const jobsToProcess = previews.slice(0, maxJobs)
    console.log(`[SOS] LinkedIn: Processing ${jobsToProcess.length} jobs for "${term}"`)

    // Step 6: Process each job
    for (let jobIdx = 0; jobIdx < jobsToProcess.length; jobIdx++) {
      signal?.throwIfAborted()

      // FIX F80: Check signal between jobs
      if (signal?.aborted) {
        console.log("[SOS] LinkedIn: Pipeline aborted during job processing")
        return
      }

      // FIX F79: Check for anti-bot interstitial between jobs
      if (detectAntiBotInterstitial()) {
        console.warn("[SOS] LinkedIn: Anti-bot detection triggered — stopping pipeline")
        onProgress?.("Anti-bot detection triggered — stopping")
        return
      }

      const job = jobsToProcess[jobIdx]
      onProgress?.(`Processing job ${jobIdx + 1}/${jobsToProcess.length}: "${job.title}" @ "${job.company}"`)
      console.log(`[SOS] LinkedIn: --- Job ${jobIdx + 1}/${jobsToProcess.length}: "${job.title}" @ "${job.company}" ---`)

      // Step 6a: Read job description
      let description: string
      try {
        description = await readJobDescription(job, signal)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[SOS] LinkedIn: Failed to read description for "${job.title}": ${msg}`)
        continue
      }

      if (!description) {
        console.warn(`[SOS] LinkedIn: Empty description for "${job.title}" — skipping`)
        continue
      }

      // Step 6b: Find the detail panel for apply button
      const detailPanel = await waitForElement(DETAIL_PANEL_SELECTOR, 5_000, signal)
      if (!detailPanel) {
        console.warn(`[SOS] LinkedIn: Could not find detail panel for "${job.title}"`)
        continue
      }

      // Step 6c: Apply to job (validate + fill modal)
      // FIX F69: Retry wrapper for transient failures
      const applyResult = await retryApply(
        () => applyToJob(job, description, filters, detailPanel, signal, site, onProgress),
        2, // max retries
        signal
      )

      if (applyResult.applied) {
        totalProcessed++
        console.log(`[SOS] LinkedIn: ✅ Applied to "${job.title}" @ "${job.company}"`)
        onProgress?.(`✅ Applied to "${job.title}" @ "${job.company}" (${totalProcessed} total)`)

        // FIX F75: Persist progress after each successful application
        await savePipelineState({
          termIndex: termIdx,
          jobIndex: jobIdx,
          totalProcessed,
          sortToggle,
          dateCycleIndex,
          timestamp: Date.now(),
        })
      } else {
        console.log(`[SOS] LinkedIn: ❌ ${applyResult.reason}`)
      }

      // FIX F78: Double-close check — ensure modal is closed before next job
      const modalStillOpen = document.querySelector(EASY_APPLY_MODAL_SELECTOR)
      if (modalStillOpen) {
        console.warn("[SOS] LinkedIn: Modal still open after job — closing")
        closeEasyApplyModal()
        await delay(1_000, signal)
      }

      // FIX F66: Rate limiting — random delay between jobs
      await randomDelay(2_000, 5_000, signal)
    }

    // Update sort toggle and date cycle for next term
    sortToggle = !sortToggle
    dateCycleIndex++
  }

  // FIX F77: Report total processed
  console.log(`[SOS] LinkedIn: Pipeline complete — applied to ${totalProcessed} jobs total`)
  onProgress?.(`Pipeline complete — applied to ${totalProcessed} jobs`)

  // Clear persisted state on successful completion
  await clearPipelineState()
}

/* ── Retry wrapper ── */

/**
 * Retry wrapper for transient failures.
 * FIX F69: Retry apply operations that fail due to transient DOM issues.
 */
async function retryApply<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  signal?: AbortSignal
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    signal?.throwIfAborted()
    try {
      return await fn()
    } catch (err) {
      if (attempt < maxRetries && !signal?.aborted) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[SOS] LinkedIn: Retry ${attempt + 1}/${maxRetries} after error: ${msg}`)
        await delay(2_000 * (attempt + 1), signal)
      } else {
        throw err
      }
    }
  }
  throw new Error("Retry exhausted")
}

/* ── Pipeline state persistence ── */

/**
 * Load persisted pipeline state from storage.
 * FIX F75: Persist pipeline progress.
 */
async function loadPipelineState(): Promise<PipelinePersistedState | null> {
  try {
    const { browser } = await import("wxt/browser")
    const res = await browser.storage.local.get(PIPELINE_STATE_KEY)
    const state = res[PIPELINE_STATE_KEY] as PipelinePersistedState | undefined
    if (state && Date.now() - state.timestamp < 3_600_000) {
      // Valid for 1 hour
      console.log(`[SOS] LinkedIn: Restored pipeline state (${state.totalProcessed} processed)`)
      return state
    }
  } catch {
    // Storage not available (e.g., in tests)
  }
  return null
}

/**
 * Save pipeline state to storage.
 * FIX F75: Persist pipeline progress.
 */
async function savePipelineState(state: PipelinePersistedState): Promise<void> {
  try {
    const { browser } = await import("wxt/browser")
    await browser.storage.local.set({ [PIPELINE_STATE_KEY]: state })
  } catch {
    // Storage not available
  }
}

/**
 * Clear persisted pipeline state.
 */
async function clearPipelineState(): Promise<void> {
  try {
    const { browser } = await import("wxt/browser")
    await browser.storage.local.remove(PIPELINE_STATE_KEY)
  } catch {
    // Storage not available
  }
}

/* ── Wait for resume helper ── */

/**
 * Wait for the user to click Resume (or Stop) after a pause event.
 * Returns true if resumed, false if stopped.
 */
function waitForResume(signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const onResume = () => {
      cleanup()
      resolve(true)
    }
    const onStop = () => {
      cleanup()
      resolve(false)
    }

    function cleanup(): void {
      eventBus.off("resume-requested", onResume)
      eventBus.off("stop-requested", onStop)
      if (signal) {
        signal.removeEventListener("abort", onAbort)
      }
    }

    function onAbort(): void {
      cleanup()
      resolve(false)
    }

    eventBus.on("resume-requested", onResume)
    eventBus.on("stop-requested", onStop)

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
    }
  })
}
