/**
 * Wellfound pipeline — minimal placeholder.
 *
 * This is a radically simplified pipeline (no settings, no filters, no EEO):
 *  1. Login check (assume logged in — logs OK)
 *  2. Scan page for jobs (placeholder — logs discovery)
 *  3. Call widget.setDone() via the provided callback
 *
 * Later phases will add real logic: parsing job cards, clicking "Learn more",
 * opening the apply form, filling fields, and submitting.
 *
 * Usage (from content.ts):
 *   const ok = await runWellfoundPipeline(abortController.signal, (msg) => {
 *     widget?.setProgress(msg)
 *   })
 *   if (ok) widget?.setDone()
 */

import type { JobPreview } from "./types"
import {
  USER_AVATAR_SELECTOR,
  JOB_CARD_SELECTOR,
  STARTUP_RESULT_SELECTOR,
} from "./wellfound-constants"

/* ── Pipeline ── */

/**
 * Run the full Wellfound pipeline.
 *
 * This placeholder logs every step with `[SOS] [Wellfound]` prefixed messages,
 * assumes the user is logged in, and reports success.
 *
 * @param signal    - AbortSignal for cancellation
 * @param onProgress - Optional progress callback (used by widget.setProgress)
 * @returns `true` on success, `false` if aborted
 */
export async function runWellfoundPipeline(
  signal: AbortSignal,
  onProgress?: (msg: string) => void,
): Promise<boolean> {
  console.log("[SOS] [Wellfound] Starting Wellfound pipeline...")
  onProgress?.("Starting pipeline…")

  /* ── Step 1: Login check ── */
  signal.throwIfAborted()
  console.log("[SOS] [Wellfound] Login check: checking for user avatar…")

  // Future: actually verify login by checking for USER_AVATAR_SELECTOR.
  // For now, assume the user is logged in.
  const avatarEl = document.querySelector(USER_AVATAR_SELECTOR)
  if (avatarEl) {
    console.log("[SOS] [Wellfound] Login check: OK (avatar found)")
  } else {
    console.log("[SOS] [Wellfound] Login check: OK (assumed logged in — avatar selector not matched)")
  }
  onProgress?.("Login check: OK")

  /* ── Step 2: Scan for jobs ── */
  signal.throwIfAborted()
  console.log("[SOS] [Wellfound] Scanning page for job cards…")

  // Future: actually parse job cards, extract title/company/salary.
  // For now, count what's visible and log it.
  const startupContainers = document.querySelectorAll(STARTUP_RESULT_SELECTOR)
  const jobCards = document.querySelectorAll(JOB_CARD_SELECTOR)
  const totalJobs = jobCards.length
  const totalStartups = startupContainers.length

  console.log(`[SOS] [Wellfound] Found ${totalStartups} startup sections, ${totalJobs} job card(s) on page`)

  if (totalJobs === 0) {
    console.log("[SOS] [Wellfound] No jobs found on page — pipeline complete (empty)")
  } else {
    console.log("[SOS] [Wellfound] Job scanning complete — ready to process jobs")
  }
  onProgress?.(`Found ${totalJobs} job(s) across ${totalStartups} startup(s)`)

  /* ── Step 3: Completion ── */
  signal.throwIfAborted()
  console.log("[SOS] [Wellfound] ✅ Pipeline complete! (placeholder — no jobs processed yet)")
  onProgress?.("Pipeline complete")

  return true
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
