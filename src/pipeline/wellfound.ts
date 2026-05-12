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
import { STARTUP_RESULT_SELECTOR } from "./wellfound-constants"

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
