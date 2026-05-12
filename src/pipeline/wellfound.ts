/**
 * Wellfound pipeline — Phase 3 (iteration + detail panel open/close).
 *
 * This phase reads all job previews from the page using
 * `readAllWellfoundPreviews()`, then iterates through each job:
 *   - Opens the detail panel (WF-6)
 *   - Logs apply type (native vs external based on `hasWellfoundBadge`)
 *   - Closes the detail panel (WF-7)
 *
 * Phase 4 will add the actual apply flow.
 *
 * Usage (from content.ts):
 *   await runWellfoundPipeline(abortController.signal, (msg) => {
 *     widget?.setProgress(msg)
 *   })
 *   widget?.setDone()
 */

import type { JobPreview } from "./types"
import {
  delay,
  dispatchEscapeKey,
  randomDelay,
  scrollAndClick,
  waitForCondition,
  waitForElement,
} from "../utils/dom"
import { eventBus } from "../utils/event-bus"
import {
  APPLY_FORM_SELECTOR,
  DEFAULT_TEXTAREA_RESPONSE,
  DETAIL_PANEL_CLOSE_SELECTOR,
  DETAIL_PANEL_OVERLAY_SELECTOR,
  DETAIL_PANEL_SELECTOR,
  LEARN_MORE_BUTTON_SELECTOR,
  MODAL_CLOSE_BUTTON_SELECTOR,
  STARTUP_RESULT_SELECTOR,
  TYPING_WAIT_TIMEOUT_MS,
  USER_AVATAR_SELECTOR,
} from "./wellfound-constants"

/* ── Login check ── */

/**
 * Check whether the user is logged into Wellfound by looking for a
 * user avatar / profile element in the DOM.
 *
 * @returns `true` if the user avatar/profile element is found, `false` otherwise.
 */
export function isWellfoundLoggedIn(): boolean {
  return !!document.querySelector(USER_AVATAR_SELECTOR)
}


/* ── Pipeline ── */

/**
 * Run the full Wellfound pipeline (Phase 3).
 *
 * Iterates through each job preview:
 * 1. Reports progress via callback
 * 2. Opens the job detail panel (WF-6)
 * 3. Logs the detail panel open
 * 4. Checks native-apply badge from the preview
 * 5. Logs apply type (native vs external)
 * 6. Adds a visual feedback delay
 * 7. Closes the detail panel (WF-7)
 * 8. Logs panel closed
 *
 * Phase 4 will add the actual apply flow.
 *
 * @param signal    - AbortSignal for cancellation
 * @param onProgress - Optional progress callback (used by widget.setProgress)
 */
export async function runWellfoundPipeline(
  signal: AbortSignal,
  onProgress?: (msg: string) => void,
): Promise<void> {
  /* ── Login check ── */
  if (!isWellfoundLoggedIn()) {
    console.log("[SOS] [Wellfound] Login check FAILED")
    throw new Error(
      "[SOS] [Wellfound] Not logged into Wellfound — aborting pipeline. " +
      "Please log in at https://wellfound.com and try again.",
    )
  }
  console.log("[SOS] [Wellfound] Login check: OK")

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

  console.log(`[SOS] [Wellfound] Found ${jobs.length} jobs`)
  onProgress?.(`Found ${jobs.length} job(s)`)

  /* ── Phase 3: Iterate through each job ── */
  const total = jobs.length
  let appliedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (let i = 0; i < total; i++) {
    signal.throwIfAborted()

    const job = jobs[i]
    const indexStr = `${i + 1}/${total}`

    /* ── Check badge: skip external (no Wellfound badge) jobs ── */
    if (!job.hasWellfoundBadge) {
      console.log(
        `[SOS] [Wellfound] [${indexStr}] Skipped (external): ${job.title} @ ${job.company}`,
      )
      skippedCount++
      onProgress?.(
        `[${indexStr}] Skipped (external): ${job.title} @ ${job.company}`,
      )
      continue
    }

    /* ── Native-apply badge present — proceed with opening details ── */
    console.log(
      `[SOS] [Wellfound] [${indexStr}] Applying (native): ${job.title} @ ${job.company}`,
    )
    appliedCount++
    onProgress?.(
      `[${indexStr}] Applying (native): ${job.title} @ ${job.company}`,
    )

    /* Step 1: Open the job detail panel (WF-6) */
    const modal = await openWellfoundJobDetails(job, signal)

    /* Step 2: Log detail panel opened */
    if (modal) {
      console.log(
        `[SOS] [Wellfound] [${indexStr}] Detail panel opened for ${job.title} @ ${job.company}`,
      )
    } else {
      console.warn(
        `[SOS] [Wellfound] [${indexStr}] Detail panel failed to open for ${job.title} @ ${job.company} — error`,
      )
      errorCount++
      continue
    }

    signal.throwIfAborted()

    /* Step 3: Visual feedback delay */
    await randomDelay(1000, 2000, signal)

    signal.throwIfAborted()

    /* Step 4: Close the detail panel (WF-7) */
    const closed = await closeWellfoundDetailPanel(modal, signal)

    /* Step 5: Log panel closed */
    if (closed) {
      console.log(
        `[SOS] [Wellfound] [${indexStr}] Detail panel closed for ${job.title} @ ${job.company}`,
      )
    } else {
      console.warn(
        `[SOS] [Wellfound] [${indexStr}] Detail panel may not have closed cleanly for ${job.title} @ ${job.company}`,
      )
      errorCount++
    }
  }

  /* ── Phase 3 done ── */
  signal.throwIfAborted()
  console.log(
    `[SOS] [Wellfound] Pipeline complete: ${appliedCount} applied, ${skippedCount} skipped (external), ${errorCount} errors out of ${total} total.`,
  )
  onProgress?.(
    `Pipeline complete: ${appliedCount} applied, ${skippedCount} skipped, ${errorCount} errors out of ${total} total.`,
  )
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


/* ── Detail panel close (WF-7) ── */

/**
 * Close the Wellfound detail panel (slide-in DiscoverModal) by trying up to 3 strategies.
 *
 * Strategies (in order):
 *   1) Click the backdrop/overlay outside the panel (the DiscoverModal is relative
 *      positioned, so there is typically an overlay sibling/parent that receives clicks)
 *   2) Dispatch an Escape key event on the document
 *   3) Click a close/dismiss button if present inside the panel
 *
 * After each strategy attempt, waits for the modal to be removed from the DOM
 * using `waitForCondition`. Returns `true` as soon as one strategy succeeds.
 * Also confirms we're back on the jobs listing page by checking for
 * `STARTUP_RESULT_SELECTOR` in the DOM.
 *
 * @param detailPanel - The `div[data-test="DiscoverModal"]` element to close
 * @param signal      - Optional AbortSignal for cancellation
 * @returns `true` if the panel was successfully closed, `false` if all strategies failed
 */
export async function closeWellfoundDetailPanel(
  detailPanel: Element,
  signal?: AbortSignal,
): Promise<boolean> {
  /* ── Fast path: already closed ── */
  if (!document.querySelector(DETAIL_PANEL_SELECTOR)) {
    console.log("[SOS] [Wellfound] Detail panel already closed — skipping close")
    return true
  }

  /* ── Helper: wait for modal to disappear ── */
  async function waitForClose(timeoutMs = 2_000): Promise<boolean> {
    try {
      await waitForCondition(
        () => !document.querySelector(DETAIL_PANEL_SELECTOR),
        { timeoutMs, signal },
      )
      return true
    } catch {
      return false
    }
  }

  /* ── Strategy 1: Click the backdrop/overlay outside the panel ── */
  // The DiscoverModal is relative positioned; an overlay sibling or parent
  // usually intercepts clicks outside the modal content area.
  const overlay = detailPanel.parentElement?.querySelector<HTMLElement>(
    DETAIL_PANEL_OVERLAY_SELECTOR,
  )
  if (overlay) {
    console.log("[SOS] [Wellfound] Clicking backdrop/overlay to close detail panel (strategy 1)")
    await scrollAndClick(overlay, signal)
    if (await waitForClose()) {
      console.log("[SOS] [Wellfound] Detail panel closed via backdrop click")
      const onListingPage = !!document.querySelector(STARTUP_RESULT_SELECTOR)
      if (onListingPage) {
        console.log("[SOS] [Wellfound] Confirmed back on jobs listing page")
        await delay(500, signal)
        return true
      }
    }
  } else {
    console.log("[SOS] [Wellfound] No backdrop/overlay found for strategy 1")
  }

  /* ── Strategy 2: Press Escape key ── */
  dispatchEscapeKey()
  console.log("[SOS] [Wellfound] Dispatched Escape key to dismiss detail panel (strategy 2)")
  if (await waitForClose()) {
    console.log("[SOS] [Wellfound] Detail panel closed via Escape key")
    const onListingPage = !!document.querySelector(STARTUP_RESULT_SELECTOR)
    if (onListingPage) {
      console.log("[SOS] [Wellfound] Confirmed back on jobs listing page")
      await delay(500, signal)
      return true
    }
  }

  /* ── Strategy 3: Click a close/dismiss button if present ── */
  const closeBtn = detailPanel.querySelector<HTMLElement>(
    DETAIL_PANEL_CLOSE_SELECTOR,
  )
  if (closeBtn) {
    console.log("[SOS] [Wellfound] Clicking close/dismiss button in detail panel (strategy 3)")
    await scrollAndClick(closeBtn, signal)
    if (await waitForClose()) {
      console.log("[SOS] [Wellfound] Detail panel closed via close button")
      const onListingPage = !!document.querySelector(STARTUP_RESULT_SELECTOR)
      if (onListingPage) {
        console.log("[SOS] [Wellfound] Confirmed back on jobs listing page")
        await delay(500, signal)
        return true
      }
    }
  } else {
    console.log("[SOS] [Wellfound] No close/dismiss button found in detail panel (strategy 3)")
  }

  /* ── All strategies exhausted ── */
  console.log("[SOS] [Wellfound] Failed to close detail panel — all strategies exhausted")
  return false
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


/* ── Application form filler ── */

/**
 * Try to find a human-readable label for a form field.
 */
function findFieldLabel(container: Element, field: Element): string {
  const fieldId = field.getAttribute("id")
  if (fieldId) {
    const label = container.querySelector<HTMLElement>(`label[for="${fieldId}"]`)
    if (label?.textContent?.trim()) return label.textContent.trim()
  }
  const ariaLabel = field.getAttribute("aria-label")
  if (ariaLabel?.trim()) return ariaLabel.trim()
  const prev = field.previousElementSibling
  if (prev?.textContent?.trim()) {
    const text = prev.textContent.trim()
    if (text.length < 200) return text
  }
  return ""
}

/**
 * Wait for the user to start typing in any form field within the given container.
 */
function waitForUserTyping(
  container: Element,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    const fields = container.querySelectorAll<HTMLElement>("textarea, input")

    function onInput(): void { cleanup(); resolve(true) }
    function onResume(): void { cleanup(); resolve(true) }
    function onAbort(): void { cleanup(); resolve(false) }

    let cleanupFns: (() => void)[] = []
    function cleanup(): void {
      cleanupFns.forEach((fn) => fn())
      cleanupFns = []
      clearTimeout(timeoutId)
    }

    fields.forEach((field) => {
      field.addEventListener("input", onInput, { capture: true })
      cleanupFns.push(() =>
        field.removeEventListener("input", onInput, { capture: true }),
      )
    })

    const unsubResume = eventBus.on("resume-requested", onResume)
    cleanupFns.push(unsubResume)

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
      cleanupFns.push(() => signal.removeEventListener("abort", onAbort))
    }

    const timeoutId = setTimeout(() => { cleanup(); resolve(false) }, timeoutMs)
  })
}

/**
 * Wait for the user to click Resume (or Stop) after a pause-for-help event.
 */
function waitForResume(signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false
    function onResume(): void {
      if (resolved) return; resolved = true; cleanup(); resolve(true)
    }
    function onStop(): void {
      if (resolved) return; resolved = true; cleanup(); resolve(false)
    }
    function onAbort(): void {
      if (resolved) return; resolved = true; cleanup(); resolve(false)
    }
    function cleanup(): void {
      eventBus.off("resume-requested", onResume)
      eventBus.off("stop-requested", onStop)
      if (signal) signal.removeEventListener("abort", onAbort)
    }
    eventBus.on("resume-requested", onResume)
    eventBus.on("stop-requested", onStop)
    if (signal) signal.addEventListener("abort", onAbort, { once: true })
  })
}

/**
 * Check for empty required fields in the Wellfound application form and pause
 * for user input if any are found.
 *
 * 1. Finds all visible form fields (`textarea`, `input`) in the right-side form
 *    section (`lg:w-2/5`).
 * 2. Checks if ANY required fields are still empty. If so:
 *    - Logs a warning
 *    - Emits a `pause-for-help` event on the event bus
 *    - Emits a `pipeline-progress` event asking the user to fill the fields
 *    - Waits up to 20 seconds for the user to start typing (listens for `input`
 *      events on the form fields)
 *    - If the user starts typing within 20s, waits for a `resume-requested`
 *      event before returning
 *    - If 20s expires with no typing activity, returns `false`
 * 3. Returns `true` if all required fields are filled, `false` if timed out.
 *
 * Each step is logged with a `[SOS] [Wellfound]` prefix.
 *
 * @param detailPanel - The `div[data-test="DiscoverModal"]` element containing the form
 * @param signal      - Optional AbortSignal for cancellation
 * @returns `true` if all required fields are filled, `false` if the user timed out
 */
export async function fillWellfoundApplicationForm(
  detailPanel: Element,
  signal?: AbortSignal,
): Promise<boolean> {
  signal?.throwIfAborted()
  console.log("[SOS] [Wellfound] Filling application form fields…")

  /* ── Step 1: Find the right-side form section ── */
  const formSection = detailPanel.querySelector<HTMLElement>(APPLY_FORM_SELECTOR)
  if (!formSection) {
    console.log("[SOS] [Wellfound] No form section found — nothing to check")
    return true
  }
  console.log("[SOS] [Wellfound] Form section found")

  /* ── Step 2: Find all visible textarea and input fields ── */
  const allFields = formSection.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(
    "textarea, input",
  )
  const visibleFields = Array.from(allFields).filter((el) => {
    if (el instanceof HTMLInputElement && el.type === "hidden") return false
    const style = window.getComputedStyle(el)
    return style.display !== "none" && style.visibility !== "hidden" && el.offsetParent !== null
  })

  if (visibleFields.length === 0) {
    console.log("[SOS] [Wellfound] No visible form fields found — nothing to check")
    return true
  }
  console.log(`[SOS] [Wellfound] Found ${visibleFields.length} visible form field(s)`)

  /* ── Step 3: Check if any required fields are still empty ── */
  const emptyRequired = visibleFields.filter((field) => {
    const value = field.value.trim()
    const isRequired =
      field.hasAttribute("required") ||
      field.getAttribute("aria-required") === "true"
    return isRequired && value === ""
  })

  if (emptyRequired.length === 0) {
    console.log("[SOS] [Wellfound] All required fields are filled")
    return true
  }

  /* ── Step 4: Required fields empty — pause for user input ── */
  console.warn(
    `[SOS] [Wellfound] ${emptyRequired.length} required field(s) still empty — waiting for user input`,
  )

  const emptyLabels = emptyRequired
    .map((f) => findFieldLabel(formSection, f) || f.name || f.placeholder || "field")
    .join(", ")
  eventBus.emit("pause-for-help", {
    siteId: "wellfound",
    questionLabel: `Required fields: ${emptyLabels}`,
    questionType: "text",
  })
  eventBus.emit("pipeline-progress", {
    stage: "wellfound-application-form",
    detail: `Please fill in the required field(s): ${emptyLabels} — then click Resume`,
  })

  /* ── Step 5: Wait up to 20s for the user to start typing ── */
  const userStartedTyping = await waitForUserTyping(
    formSection,
    TYPING_WAIT_TIMEOUT_MS,
    signal,
  )

  if (!userStartedTyping) {
    console.warn(
      "[SOS] [Wellfound] User did not start typing within 20s — returning false",
    )
    return false
  }

  /* ── Step 6: User started typing — wait for Resume button ── */
  console.log(
    "[SOS] [Wellfound] User started typing — waiting for Resume click",
  )
  const resumed = await waitForResume(signal)

  if (!resumed) {
    console.warn(
      "[SOS] [Wellfound] User did not click Resume — returning false",
    )
    return false
  }

  console.log("[SOS] [Wellfound] Application form fields filled successfully")
  return true
}

