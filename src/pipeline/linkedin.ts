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
import {
  checkCompanyBadWords,
  checkTitleBadWords,
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
} from "./linkedin-constants"



/* ── Filtered URL params helper (for pushState updates) ── */

/**
 * Build only the filter-related URL params from site settings.
 * Preserves the existing page URL's keywords, location, and other params.
 * Returns a new URL that can be pushState'd.
 */
function buildFilterUrl(site: SiteSettings): URL {
  const url = new URL(window.location.href)

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
 * Navigate to the LinkedIn jobs search page via full page redirect.
 * Used when user is not on a search results page and needs to get there.
 * This causes a page reload — content script re-initializes after.
 *
 * Guards: if already on the search results page, returns early.
 */
export function navigateToSearchPage(): void {
  if (window.location.pathname.includes(SEARCH_PAGE_PATH)) {
    console.log("[SOS] LinkedIn: Already on search page — skipping redirect")
    return
  }
  console.log("[SOS] LinkedIn: Navigating to jobs search page")
  window.location.href = LINKEDIN_JOBS_SEARCH_URL
}

/* ── Easy Apply: Click button ── */

/**
 * Click the Easy Apply button in the job detail panel and wait for the
 * apply modal to appear.
 *
 * Call this only after all job criteria pass validation.
 * Returns the modal element if found, null otherwise.
 */
export async function clickEasyApplyButton(
  detailPanel: Element,
  signal?: AbortSignal
): Promise<Element | null> {
  signal?.throwIfAborted()

  // Find the Easy Apply button inside the detail panel
  const applyBtn =
    detailPanel.querySelector<HTMLElement>(EASY_APPLY_BUTTON_SELECTOR) ??
    (() => {
      // Fallback: scan all buttons in detail panel for text match
      for (const btn of detailPanel.querySelectorAll("button")) {
        const text = btn.textContent?.trim().toLowerCase() || ""
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
      console.log("[SOS] LinkedIn: Found external apply link — navigating away")
      window.location.href = externalBtn.href
      return null
    }

    console.warn("[SOS] LinkedIn: Could not find Easy Apply button in detail panel")
    return null
  }

  console.log("[SOS] LinkedIn: Clicking Easy Apply button")
  scrollAndClick(applyBtn)

  // Wait for the apply modal to appear
  const modal = await waitForElement(EASY_APPLY_MODAL_SELECTOR, 8_000, signal)
  if (!modal) {
    console.warn("[SOS] LinkedIn: Easy Apply modal did not appear after clicking button")
    return null
  }

  console.log("[SOS] LinkedIn: Easy Apply modal opened successfully")
  await delay(1_000, signal)
  return modal
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
 */
export function closeEasyApplyModal(): boolean {
  // Strategy 1: Click the X / Dismiss button via CSS selector
  const closeBtn = document.querySelector<HTMLElement>(EASY_APPLY_CLOSE_SELECTOR)
  if (closeBtn) {
    console.log("[SOS] LinkedIn: Clicking Easy Apply modal close button (strategy 1)")
    scrollAndClick(closeBtn)
    return true
  }

  // Strategy 2: Press Escape to dismiss (triggers React-backed listeners)
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
    })
  )
  console.log("[SOS] LinkedIn: Dispatched Escape key to dismiss modal (strategy 2)")

  // Wait briefly for React to process Escape event
  // If modal still in DOM after Escape, proceed to strategy 3
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

  // Restore body scroll (LinkedIn disables scroll when modal open)
  document.body.style.overflow = ""
  document.body.style.position = ""

  const gone = !document.querySelector(EASY_APPLY_MODAL_SELECTOR)
  if (gone) console.log("[SOS] LinkedIn: Modal successfully removed from DOM")
  return gone
}

/* ── Easy Apply: Validate + click (combined) ── */

/**
 * Apply to a job: validate against ALL user filter criteria, then click the
 * Easy Apply button only if the job passes every check.
 *
 * This is the primary function to call once a job's detail panel is loaded
 * and its description has been read. It composes:
 *   1. `validateJobForApplication()` — pure filter checks
 *   2. `clickEasyApplyButton()` — DOM interaction to open the modal
 *
 * @param job        - The job preview (title, company used for validation)
 * @param description- Full job description text (for description-level filters)
 * @param filters    - User's FilterSettings from the extension config
 * @param detailPanel- The detail panel element containing the Easy Apply button
 * @param signal     - Optional AbortSignal for cancellation
 *
 * @returns `ApplyToJobResult` with `applied: true` if the job passed all
 *          criteria and the Easy Apply button was clicked, or `applied: false`
 *          with a `reason` explaining why.
 */
export async function applyToJob(
  job: JobPreview,
  description: string,
  filters: FilterSettings,
  detailPanel: Element,
  signal?: AbortSignal
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

  console.log(
    `[SOS] Job "${job.title}" @ "${job.company}" passed all criteria — clicking Easy Apply`
  )

  // Step 2: Click the Easy Apply button (only reached if validation passed)
  const modal = await clickEasyApplyButton(detailPanel, signal)

  if (!modal) {
    return {
      applied: false,
      reason: `Easy Apply button not found or modal did not appear for "${job.title}" @ "${job.company}"`,
    }
  }

  return {
    applied: true,
    reason: `Applied to "${job.title}" @ "${job.company}"`,
  }
}

/* ── Navigation: Search Term (DOM input manipulation) ── */


/**
 * Navigate to a new search term via DOM manipulation of the LinkedIn search input.
 * LinkedIn's SPA listens for Enter key on the search box to trigger the API call.
 * No page reload — the content script context is preserved.
 */
export async function navigateToSearchTerm(term: string, signal?: AbortSignal): Promise<void> {
  console.log(`[SOS] LinkedIn: Navigating to search term "${term}"`)

  const input = await waitForElement<HTMLInputElement>(SEARCH_INPUT_SELECTOR, 10_000, signal)
  signal?.throwIfAborted()
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
  await delay(200, signal)

  // Press Enter to submit / trigger LinkedIn's search API call
  input.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    })
  )

  // Wait for results container to re-render with new content
  await waitForElement(LINKEDIN_RESULTS_SELECTOR, 15_000, signal)
  // Give LinkedIn extra time to render cards (lazy loading)
  await delay(2_000, signal)
}

/* ── Navigation: Filters (pushState + popstate) ── */

/**
 * Apply URL-based filters via history.pushState + PopStateEvent.
 * LinkedIn's React router listens for popstate and re-fetches search results
 * with updated URL params. No page reload required.
 */
export async function applyFiltersViaPushState(site: SiteSettings, signal?: AbortSignal): Promise<void> {
  const url = buildFilterUrl(site)

  console.log(`[SOS] LinkedIn: Applying filters via pushState — ${url.search}`)
  pushStateNavigate(url)

  // Wait for LinkedIn to process the URL change and re-fetch results
  await delay(2_500, signal)
}

/* ── DOM-only filter application (post-nav) ── */

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
    (await waitForElement(
      "button[aria-label*='All filters'], button.jobs-search-dropdown__trigger--all-filters",
      6_000,
      signal
    )) ??
    (() => {
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
  await delay(1_500, signal)

  const modalContainer = await waitForElement(
    ".jobs-search-all-filters__content, div[data-test-all-filters-modal]",
    5_000,
    signal
  )

  if (!modalContainer) {
    result.errors.push("Could not find LinkedIn filter modal")
    result.success = false
    return result
  }

  result.appliedCount += await toggleCheckboxItems(modalContainer, domFilters, clickDelayMs, signal)

  const applyBtn =
    (await waitForElement(
      "button[aria-label*='Show results'], button.jobs-search-all-filters__apply-button",
      5_000,
      signal
    )) ??
    findButtonByText(modalContainer, "show results", "apply")

  if (applyBtn) {
    scrollAndClick(applyBtn)
    await delay(1_000, signal)
    console.log("[SOS] LinkedIn: Clicked 'Show results' to apply filters")
  } else {
    result.errors.push("Could not find 'Show results' button in filter modal")
  }

  return result
}

/* ── Batch job card reading ── */

/** Extract title from a LinkedIn job card (handles multiple card formats).
 *  The card anchor itself often IS the title element (e.g. a.job-card-list__title),
 *  so we fall back to the anchor's own textContent if no child match is found.
 *  Strips trailing ` @ CompanyName` or ` · CompanyName` from the raw text
 *  since LinkedIn sometimes includes the company in the anchor's textContent. */
function extractCardTitle(card: HTMLAnchorElement): string {
  const raw =
    card.querySelector(
      ".job-card-list__title, " +
        ".job-card-container__link, " +
        ".artdeco-entity-lockup__title, " +
        ".job-card-container__primary-description"
    )?.textContent?.trim() ||
    card.textContent?.trim() ||
    ""

  // Strip trailing " @ CompanyName" or " · CompanyName" patterns
  return raw.replace(/[ @·]+\S.*$/, "").trim()
}

/** Extract company name from a LinkedIn job card.
 *  Looks at the card's parent container for company name elements,
 *  since the card anchor itself may not contain the company name. */
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

  return ""
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
 */
export async function readAllJobPreviews(maxCards: number, signal?: AbortSignal): Promise<JobPreview[]> {
  const scroller = await waitForElement(LIST_SCROLLER_SELECTOR, 8_000, signal)
  if (scroller && !signal?.aborted) {
    // Scroll to bottom to trigger lazy loading
    await scrollToBottom(scroller, 10, 400, signal)
    await delay(1_000, signal)
  }

  const cardLinks = await waitForJobCards(15_000, signal)
  if (!cardLinks || cardLinks.length === 0) return []

  const limit = Math.min(cardLinks.length, maxCards)
  const previews: JobPreview[] = []

  for (let i = 0; i < limit; i++) {
    const card = cardLinks[i]
    previews.push({
      title: extractCardTitle(card),
      company: extractCardCompany(card),
      location: extractCardLocation(card),
      url: card.href,
      element: card,
    })
  }

  console.log(
    `[SOS] LinkedIn: Read ${previews.length} job preview(s) (from ${cardLinks.length} cards, limit ${maxCards})`
  )
  return previews
}

/* ── Business logic pre-screening ── */

/**
 * Apply company-level and title-level filters to previews (using shared
 * pure functions from `job-validator.ts`).
 *
 * No description available yet — this is a pre-screening pass using
 * only the data available in the list view cards.
 *
 * Filters applied:
 *   - Bad words in company name (with exception list)
 *   - Bad words in job title
 */
export function filterJobPreviews(
  previews: JobPreview[],
  site: SiteSettings
): JobPreview[] {
  const filtered = previews.filter((p) => {
    // Use shared pure functions from job-validator
    const companyOk = checkCompanyBadWords(
      p.company,
      site.filters.aboutCompanyBadWords,
      site.filters.aboutCompanyGoodWords
    )
    if (!companyOk) {
      console.log(`[SOS] Filtered out "${p.title}" @ "${p.company}" — bad company word`)
      return false
    }

    const titleOk = checkTitleBadWords(p.title, site.filters.badWords)
    if (!titleOk) {
      console.log(`[SOS] Filtered out "${p.title}" @ "${p.company}" — bad title word`)
      return false
    }

    return true
  })

  const skipped = previews.length - filtered.length
  if (skipped > 0) {
    console.log(`[SOS] Pre-screen: ${filtered.length} passed, ${skipped} filtered out`)
  }

  return filtered
}



/* ── Per-job processing ── */

/**
 * Click an approved job card, wait for the detail panel, read the full
 * description, apply description-level filters, and (if passed) return
 * the scraped data for the apply flow.
 */
async function readJobDescription(
  job: JobPreview,
  signal?: AbortSignal
): Promise<{ description: string; detailPanel: Element } | null> {
  // Click the card to load the detail panel
  job.element.scrollIntoView({ behavior: "smooth", block: "center" })
  await delay(300, signal)
  scrollAndClick(job.element)
  await delay(1_500, signal)

  // Wait for the detail panel to appear
  const detailPanel = await waitForElement(DETAIL_PANEL_SELECTOR, 6_000, signal)
  if (!detailPanel) {
    console.warn(`[SOS] Detail panel did not load for "${job.title}" @ "${job.company}"`)
    return null
  }

  // Click "Show more" if available to expand the full description
  const showMoreBtn = detailPanel.querySelector<HTMLElement>(
    "button[aria-label*='Show more'], " +
      "button.inline-show-more-text__button, " +
      ".jobs-description__show-more button"
  )
  if (showMoreBtn) {
    scrollAndClick(showMoreBtn)
    await delay(800, signal)
  }

  // Scroll the description container to trigger lazy text loading
  const descContainer = detailPanel.querySelector(
    ".jobs-description__content, " +
      ".jobs-box__html-content, " +
      ".job-details-jobs-unified-top-card__description-container, " +
      "article"
  )
  if (descContainer) {
    await scrollToBottom(descContainer, 15, 400, signal)
  }

  const description = getVisibleText(descContainer || detailPanel)

  return { description, detailPanel }
}

/* ── Main pipeline entry ── */

/**
 * Run the full LinkedIn pipeline for a set of search terms.
 * No page reloads — all navigation is done via DOM manipulation + pushState.
 * The pipeline runs as a single continuous async function.
 *
 * Flow:
 *   1. For each search term:
 *      a. Navigate via search input DOM manipulation
 *      b. Apply URL-based filters via pushState
 *      c. Apply DOM-only toggles via "All filters" modal
 *      d. Batch-read all job card previews from the list view
 *      e. Pre-screen previews using company/title word filters
 *      f. For each approved job: click → read description → validate → apply flow
 */
export async function runLinkedInPipeline(
  site: SiteSettings,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<void> {
  const terms = site.search.searchTerms
  if (terms.length === 0) {
    console.warn("[SOS] LinkedIn: No search terms configured")
    return
  }

  const maxJobs = site.search.switchNumber || 30
  let totalProcessed = 0

  for (let i = 0; i < terms.length; i++) {
    signal?.throwIfAborted()
    const term = terms[i]
    const progressMsg = `[${i + 1}/${terms.length}] "${term}"`
    onProgress?.(`Searching "${term}" (${i + 1}/${terms.length})`)
    console.log(`[SOS] LinkedIn: ${progressMsg}`)

    // ── Step A: Navigate to search term ──
    try {
      await navigateToSearchTerm(term, signal)
    } catch (err) {
      // If aborted, stop immediately instead of continuing to next term
      if (err instanceof Error && err.name === "AbortError") throw err
      console.error(`[SOS] Failed to navigate to "${term}":`, err)
      continue
    }

    // ── Step B: Apply URL-based filters via pushState ──
    await applyFiltersViaPushState(site, signal)
    await delay(1_000, signal)

    // ── Step C: Apply DOM-only toggles ──
    const domResult = await applyDomFilters(site, site.pipeline?.pauseBeforeSubmit ? 1200 : 600, signal)
    if (domResult.errors.length > 0) {
      console.warn(`[SOS] DOM filter issues:`, domResult.errors)
    }

    // ── Step D: Batch-read all job previews ──
    const previews = await readAllJobPreviews(maxJobs, signal)
    if (previews.length === 0) {
      onProgress?.(`"${term}": No listings found`)
      console.warn(`[SOS] No job previews for "${term}"`)
      continue
    }

    // ── Step E: Pre-screen previews ──
    const approved = filterJobPreviews(previews, site)
    if (approved.length === 0) {
      onProgress?.(`"${term}": All ${previews.length} listings filtered out`)
      console.log(`[SOS] All ${previews.length} previews filtered out for "${term}"`)
      continue
    }

    onProgress?.(`"${term}": ${approved.length}/${previews.length} passed pre-screen`)
    console.log(
      `[SOS] ${approved.length}/${previews.length} pre-screened for "${term}"`
    )

    // ── Step F: Drill into each approved job ──
    for (let j = 0; j < approved.length; j++) {
      signal?.throwIfAborted()
      const job = approved[j]
      onProgress?.(`Reading ${j + 1}/${approved.length}: ${job.title} @ ${job.company}`)
      console.log(
        `[SOS] Processing ${j + 1}/${approved.length}: "${job.title}" @ "${job.company}"`
      )

      // Read the full description
      const detail = await readJobDescription(job, signal)
      if (!detail) {
        console.warn(`[SOS] Skipping "${job.title}" — detail panel unavailable`)
        continue
      }

      // ── Step G: Apply to job (validate + click Easy Apply + close modal) ──
      onProgress?.(`Applying to ${j + 1}/${approved.length}: ${job.title} @ ${job.company}`)
      const result = await applyToJob(job, detail.description, site.filters, detail.detailPanel, signal)

      if (result.applied) {
        // Wait for the modal to fully render, then close it
        await delay(2_000, signal)
        closeEasyApplyModal()
        await delay(1_000, signal)
        console.log(`[SOS] LinkedIn: ${result.reason}`)
        totalProcessed++
      } else {
        console.log(`[SOS] LinkedIn: ${result.reason}`)
      }

      // Give UI a breather between jobs
      await delay(500, signal)
    }
  }

  console.log(
    `[SOS] LinkedIn pipeline complete — ${totalProcessed} job(s) processed across ${terms.length} term(s)`
  )
  onProgress?.(
    `Done — ${totalProcessed} job(s) processed across ${terms.length} term(s)`
  )
}
