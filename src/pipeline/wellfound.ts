/**
 * Wellfound pipeline — Phase 2 placeholder.
 *
 * This phase reads all job previews from the page using
 * `readAllWellfoundPreviews()` and logs them. Phase 3 will add
 * clicking/navigation logic.
 *
 * Usage (from content.ts):
 *   await runWellfoundPipeline(abortController.signal, (msg) => {
 *     widget?.setProgress(msg)
 *   })
 *   widget?.setDone()
 */

import type { JobPreview } from "./types"
import {
  dispatchEscapeKey,
  randomDelay,
  waitForCondition,
  waitForElement,
} from "../utils/dom"
import {
  DETAIL_PANEL_SELECTOR,
  LEARN_MORE_BUTTON_SELECTOR,
  MODAL_CLOSE_BUTTON_SELECTOR,
  STARTUP_RESULT_SELECTOR,
} from "./wellfound-constants"

/* ── Pipeline ── */

/**
 * Run the full Wellfound pipeline (Phase 2 placeholder).
 *
 * Uses `readAllWellfoundPreviews()` to scan the page for job listings, then
 * logs each discovered job. Phase 3 will add clicking/navigation logic.
 *
 * @param signal    - AbortSignal for cancellation
 * @param onProgress - Optional progress callback (used by widget.setProgress)
 */
export async function runWellfoundPipeline(
  signal: AbortSignal,
  onProgress?: (msg: string) => void,
): Promise<void> {
  console.log("[SOS] [Wellfound] Starting Wellfound pipeline...")
  onProgress?.("Starting pipeline…")

  /* ── Scan for jobs ── */
  signal.throwIfAborted()

  const jobs = readAllWellfoundPreviews()

  if (jobs.length === 0) {
    console.log("[SOS] [Wellfound] No jobs on this page - done")
    onProgress?.("No jobs found")
    return
  }

  console.log(`[SOS] [Wellfound] Found ${jobs.length} jobs:`)
  onProgress?.(`Found ${jobs.length} job(s)`)

  jobs.forEach((job, index) => {
    console.log(
      `[SOS] [Wellfound]   ${index + 1}. ${job.title} @ ${job.company} | ${job.compensation}`,
    )
  })

  /* ── Phase 2 placeholder done ── */
  signal.throwIfAborted()
  console.log("[SOS] [Wellfound] ✅ Pipeline complete (Phase 2 — Phase 3 will add clicking/navigation)")
  onProgress?.("Pipeline complete")
}


/* ── Job detail opener ── */

/**
 * Open the job detail modal (slide-in panel) for a given job preview.
 *
 * 1. Checks for and closes any already-open modal (from a previous job)
 * 2. Scrolls the job card into view
 * 3. Clicks the "Learn more" button within the job card
 * 4. Waits for `div[data-test="DiscoverModal"]` to appear in the DOM
 * 5. Returns the modal element
 *
 * Each step is logged with a `[SOS] [Wellfound]` prefix.
 *
 * @param job    - The job preview whose details to open
 * @param signal - Optional AbortSignal for cancellation
 * @returns The modal element, or `null` if the modal could not be opened
 */
export async function openWellfoundJobDetails(
  job: JobPreview,
  signal?: AbortSignal,
): Promise<Element | null> {
  signal?.throwIfAborted()
  console.log(
    `[SOS] [Wellfound] Opening job details for "${job.title}" @ "${job.company}"`,
  )

  /* ── Handle already-open modal ── */
  const existingModal = document.querySelector(DETAIL_PANEL_SELECTOR)
  if (existingModal) {
    console.log("[SOS] [Wellfound] Existing modal detected — closing it first")
    // Try to find a close/dismiss button inside the modal
    const closeBtn = existingModal.querySelector<HTMLElement>(
      MODAL_CLOSE_BUTTON_SELECTOR,
    )
    if (closeBtn) {
      closeBtn.click()
    } else {
      // Fallback: dispatch Escape key to dismiss the modal
      dispatchEscapeKey()
    }
    // Wait for the modal to be removed from the DOM
    try {
      await waitForCondition(
        () => !document.querySelector(DETAIL_PANEL_SELECTOR),
        { timeoutMs: 5_000, signal },
      )
    } catch {
      console.warn(
        "[SOS] [Wellfound] Timed out waiting for existing modal to close — proceeding anyway",
      )
    }
    console.log("[SOS] [Wellfound] Existing modal closed")
  }

  /* ── Step 1: Scroll the job card into view ── */
  signal?.throwIfAborted()
  console.log(`[SOS] [Wellfound] Scrolling job card into view`)
  if (job.element instanceof HTMLElement) {
    job.element.scrollIntoView({ behavior: "smooth", block: "center" })
  }
  // Brief human-like pause after scrolling
  await randomDelay(300, 900, signal)

  /* ── Step 2: Find and click the "Learn more" button ── */
  signal?.throwIfAborted()
  console.log(`[SOS] [Wellfound] Clicking "Learn more" button`)
  const learnMoreBtn = job.element.querySelector<HTMLElement>(
    LEARN_MORE_BUTTON_SELECTOR,
  )
  if (!learnMoreBtn) {
    console.error(
      `[SOS] [Wellfound] "Learn more" button not found for "${job.title}" @ "${job.company}"`,
    )
    return null
  }
  learnMoreBtn.click()

  /* ── Step 3: Wait for the detail modal to appear ── */
  signal?.throwIfAborted()
  console.log(`[SOS] [Wellfound] Waiting for detail modal to appear`)
  const modal = await waitForElement<Element>(DETAIL_PANEL_SELECTOR, 8_000, signal)
  if (!modal) {
    console.error(
      `[SOS] [Wellfound] Detail modal did not appear for "${job.title}" @ "${job.company}"`,
    )
    return null
  }

  console.log(
    `[SOS] [Wellfound] Detail modal opened successfully for "${job.title}" @ "${job.company}"`,
  )
  return modal
}


/* ── Job preview reader ── */

/**
 * Read ALL job cards from the wellfound.com/jobs page.
 *
 * Scans every `div[data-test="StartupResult"]` section on the page, extracts
 * the company name from the `<h2>`, then finds every job link
 * (`a[rel="noopener noreferrer"][target="_blank"][href^="/jobs/"]`) within
 * each section.
 *
 * The only fields that matter operationally are:
 *   - `hasWellfoundBadge` — whether the startup header has the native-apply badge
 *   - `element` — the DOM node to click / interact with (the apply DOM element)
 *
 * Everything else (title, company, compensation, location) is grabbed raw from
 * the DOM for logging and display only — no filtering logic, no regex, no fallbacks.
 *
 * Every job is logged to the console with a `[SOS] [Wellfound]` prefix.
 *
 * @returns An array of objects matching the `JobPreview` shape, augmented with
 *          `compensation` and `hasWellfoundBadge`.
 */
export function readAllWellfoundPreviews(): (JobPreview & {
  compensation: string
  hasWellfoundBadge: boolean
})[] {
  const sections = document.querySelectorAll<HTMLElement>(STARTUP_RESULT_SELECTOR)
  console.log(`[SOS] [Wellfound] Found ${sections.length} startup section(s) on page`)

  const results: (JobPreview & { compensation: string; hasWellfoundBadge: boolean })[] = []

  for (const section of sections) {
    /* ── Company name (for display only) ── */
    const company = section.querySelector("h2")?.textContent?.trim() || "Unknown Company"

    /* ── Apply on Wellfound badge — the ONE operational concern ── */
    const badgeEl = section.querySelector<HTMLElement>(
      "div.styles_badge__44SWu, div[class*=\"badge\"]",
    )
    const hasWellfoundBadge =
      badgeEl?.textContent?.includes("Apply on Wellfound") ?? false

    /* ── Individual job links ── */
    const jobLinks = section.querySelectorAll<HTMLAnchorElement>(
      'a[rel="noopener noreferrer"][target="_blank"][href^="/jobs/"]',
    )

    for (const link of jobLinks) {
      /* ── The apply DOM element — the OTHER operational concern ── */
      const jobCard = link.closest<HTMLElement>("div.mb-6")
      const element: HTMLElement = jobCard ?? link

      /* ── Everything below is purely for logging / display ── */
      const href = link.getAttribute("href") ?? ""
      const title = link.textContent?.trim() || "Unknown Title"
      const cardText = element.textContent ?? ""
      const compensation = cardText.match(/\$[\d,]+k?/)?.[0]?.trim() ?? ""
      const location = element
        .querySelector<HTMLElement>("span.styles_location__O9Z62, span[class*=\"location\"]")
        ?.textContent?.trim() ?? ""

      const url = href.startsWith("http")
        ? href
        : `https://wellfound.com${href}`

      const jobId =
        href.match(/\/jobs\/(\d+)/)?.[1] ??
        href.replace("/jobs/", "").split(/[/-]/)[0] ??
        `wf-${results.length}`

      results.push({
        title,
        company,
        location,
        url,
        element,
        jobId,
        compensation,
        hasWellfoundBadge,
      })

      console.log(
        `[SOS] [Wellfound] "${title}" @ ${company} | ${location} | ${compensation} | Badge: ${hasWellfoundBadge} | ${url}`,
      )
    }
  }

  console.log(
    `[SOS] [Wellfound] Total: ${results.length} job(s) read from ${sections.length} startup(s)`,
  )
  return results
}
