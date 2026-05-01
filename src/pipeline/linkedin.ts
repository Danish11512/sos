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

import type { SiteSettings } from "../settings/sections"
import type { ApplyFiltersResult, JobPreview } from "./types"
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

import {
  SEARCH_INPUT_SELECTOR,
  LINKEDIN_RESULTS_SELECTOR,
  CARD_SELECTOR,
  DETAIL_PANEL_SELECTOR,
  LIST_SCROLLER_SELECTOR,
  EASY_APPLY_BUTTON_SELECTOR,
  EXTERNAL_APPLY_SELECTOR,
  EASY_APPLY_MODAL_SELECTOR,
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

/* ── Navigation: Easy Apply modal ── */


/**
 * Click the Easy Apply button in the job detail panel and wait for the
 * apply modal to appear.
 *
 * Returns the modal element if found, null otherwise.
 * Throws if the Easy Apply button cannot be found.
 */
export async function navigateToApply(
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
  const modal = await waitForElement(EASY_APPLY_MODAL_SELECTOR, 8_000)
  if (!modal) {
    console.warn("[SOS] LinkedIn: Easy Apply modal did not appear after clicking button")
    return null
  }

  console.log("[SOS] LinkedIn: Easy Apply modal opened successfully")
  await delay(1_000)
  return modal
}

/* ── Navigation: Search Term (DOM input manipulation) ── */

/**
 * Navigate to a new search term via DOM manipulation of the LinkedIn search input.
 * LinkedIn's SPA listens for Enter key on the search box to trigger the API call.
 * No page reload — the content script context is preserved.
 */
export async function navigateToSearchTerm(term: string): Promise<void> {
  console.log(`[SOS] LinkedIn: Navigating to search term "${term}"`)

  const input = await waitForElement<HTMLInputElement>(SEARCH_INPUT_SELECTOR, 10_000)
  if (!input) {
    throw new Error(`[SOS] LinkedIn: Could not find search input to navigate to "${term}"`)
  }

  // Focus the input first (LinkedIn may have focus handlers)
  input.focus()
  input.click()
  await delay(300)

  // Clear existing value
  setReactInputValue(input, "")
  await delay(100)

  // Set the new term using React-aware value setter
  setReactInputValue(input, term)
  await delay(200)

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
  await waitForElement(LINKEDIN_RESULTS_SELECTOR, 15_000)
  // Give LinkedIn extra time to render cards (lazy loading)
  await delay(2_000)
}

/* ── Navigation: Filters (pushState + popstate) ── */

/**
 * Apply URL-based filters via history.pushState + PopStateEvent.
 * LinkedIn's React router listens for popstate and re-fetches search results
 * with updated URL params. No page reload required.
 */
export async function applyFiltersViaPushState(site: SiteSettings): Promise<void> {
  const url = buildFilterUrl(site)

  console.log(`[SOS] LinkedIn: Applying filters via pushState — ${url.search}`)
  pushStateNavigate(url)

  // Wait for LinkedIn to process the URL change and re-fetch results
  await delay(2_500)
}

/* ── DOM-only filter application (post-nav) ── */

async function applyDomFilters(
  site: SiteSettings,
  clickDelayMs: number
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
      6_000
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

  const applyBtn =
    (await waitForElement(
      "button[aria-label*='Show results'], button.jobs-search-all-filters__apply-button",
      5_000
    )) ??
    findButtonByText(modalContainer, "show results", "apply")

  if (applyBtn) {
    scrollAndClick(applyBtn)
    await delay(1_000)
    console.log("[SOS] LinkedIn: Clicked 'Show results' to apply filters")
  } else {
    result.errors.push("Could not find 'Show results' button in filter modal")
  }

  return result
}

/* ── Batch job card reading ── */

/** Extract title from a LinkedIn job card (handles multiple card formats). */
function extractCardTitle(card: HTMLAnchorElement): string {
  return (
    card.querySelector(
      ".job-card-list__title, " +
        ".job-card-container__link, " +
        ".artdeco-entity-lockup__title, " +
        ".job-card-container__primary-description"
    )?.textContent?.trim() || ""
  )
}

/** Extract company name from a LinkedIn job card. */
function extractCardCompany(card: HTMLAnchorElement): string {
  return (
    card.querySelector(
      ".job-card-container__company-name, " +
        ".artdeco-entity-lockup__subtitle, " +
        ".job-card-list__company-name"
    )?.textContent?.trim() || ""
  )
}

/** Extract location from a LinkedIn job card. */
function extractCardLocation(card: HTMLAnchorElement): string {
  return (
    card.querySelector(
      ".job-card-container__metadata-item, " +
        ".artdeco-entity-lockup__caption, " +
        ".job-card-list__metadata-item"
    )?.textContent?.trim() || ""
  )
}

/**
 * Wait for at least one job card to appear in the DOM, using MutationObserver
 * to detect when LinkedIn's lazy-rendered cards become available.
 * Resolves with all matching card elements, or null if timeout.
 */
async function waitForJobCards(timeoutMs = 15_000): Promise<HTMLAnchorElement[] | null> {
  // Check if cards are already in DOM
  const existing = document.querySelectorAll<HTMLAnchorElement>(CARD_SELECTOR)
  if (existing.length > 0) return Array.from(existing)

  // Wait using MutationObserver for first card to appear
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const cards = document.querySelectorAll<HTMLAnchorElement>(CARD_SELECTOR)
      if (cards.length > 0) {
        observer.disconnect()
        resolve(Array.from(cards))
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => {
      observer.disconnect()
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
export async function readAllJobPreviews(maxCards: number): Promise<JobPreview[]> {
  const scroller = await waitForElement(LIST_SCROLLER_SELECTOR, 8_000)
  if (scroller) {
    // Scroll to bottom to trigger lazy loading
    await scrollToBottom(scroller, 10, 400)
    await delay(1_000)
  }

  const cardLinks = await waitForJobCards(15_000)
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
  job: JobPreview
): Promise<{ description: string; detailPanel: Element } | null> {
  // Click the card to load the detail panel
  job.element.scrollIntoView({ behavior: "smooth", block: "center" })
  await delay(300)
  scrollAndClick(job.element)
  await delay(1_500)

  // Wait for the detail panel to appear
  const detailPanel = await waitForElement(DETAIL_PANEL_SELECTOR, 6_000)
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
    await delay(800)
  }

  // Scroll the description container to trigger lazy text loading
  const descContainer = detailPanel.querySelector(
    ".jobs-description__content, " +
      ".jobs-box__html-content, " +
      ".job-details-jobs-unified-top-card__description-container, " +
      "article"
  )
  if (descContainer) {
    await scrollToBottom(descContainer, 15, 400)
  }

  const description = getVisibleText(descContainer || detailPanel)

  return { description, detailPanel }
}

/**
 * Validate a job against ALL description-level filters using the shared
 * pure functions from `job-validator.ts`.
 *
 * Returns `true` if the job passes all filters and is ready to apply to.
 */
function validateFullJob(
  job: JobPreview,
  description: string,
  site: SiteSettings
): boolean {
  return validateJobForApplication(
    job.company,
    job.title,
    description,
    site.filters
  )
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
 *      f. For each approved job: click → read description → apply flow
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
      await navigateToSearchTerm(term)
    } catch (err) {
      console.error(`[SOS] Failed to navigate to "${term}":`, err)
      continue
    }

    // ── Step B: Apply URL-based filters via pushState ──
    await applyFiltersViaPushState(site)
    await delay(1_000)

    // ── Step C: Apply DOM-only toggles ──
    const domResult = await applyDomFilters(site, site.pipeline?.pauseBeforeSubmit ? 1200 : 600)
    if (domResult.errors.length > 0) {
      console.warn(`[SOS] DOM filter issues:`, domResult.errors)
    }

    // ── Step D: Batch-read all job previews ──
    const previews = await readAllJobPreviews(maxJobs)
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
      const job = approved[j]
      onProgress?.(`Reading ${j + 1}/${approved.length}: ${job.title} @ ${job.company}`)
      console.log(
        `[SOS] Processing ${j + 1}/${approved.length}: "${job.title}" @ "${job.company}"`
      )

      // Read the full description
      const detail = await readJobDescription(job)
      if (!detail) {
        console.warn(`[SOS] Skipping "${job.title}" — detail panel unavailable`)
        continue
      }

      // Validate the job against ALL user filter criteria
      const isValid = validateFullJob(job, detail.description, site)
      if (!isValid) {
        console.log(
          `[SOS] Skipping "${job.title}" @ "${job.company}" — failed filter validation`
        )
        continue
      }

      // If there's a pauseAfterFilters, stop and let user review
      if (site.filters.pauseAfterFilters) {
        onProgress?.(`Paused: "${job.title}" @ "${job.company}" — review in detail panel`)
        console.log(`[SOS] Paused after filters — "${job.title}" ready for review`)
        // The widget is still visible; user can resume or the pipeline
        // will continue when the user interacts again
        // TODO: Wire this into a widget "resume" mechanism
      }


      totalProcessed++

      // Give UI a breather between jobs
      await delay(500)
    }
  }

  console.log(
    `[SOS] LinkedIn pipeline complete — ${totalProcessed} job(s) processed across ${terms.length} term(s)`
  )
  onProgress?.(
    `Done — ${totalProcessed} job(s) processed across ${terms.length} term(s)`
  )
}
