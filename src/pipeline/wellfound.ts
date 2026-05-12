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
