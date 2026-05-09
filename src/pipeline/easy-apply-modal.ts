/**
 * Easy Apply modal interaction engine for LinkedIn.
 *
 * Handles the full modal flow:
 *   1. Detect modal structure
 *   2. Find all form elements (select, radio, text, textarea, checkbox)
 *   3. Answer each question based on keyword matching against user settings
 *   4. Handle navigation (Next, Review, Submit)
 *   5. Handle resume upload
 *   6. Handle daily limit detection
 *   7. Handle external apply detection
 *   8. Handle pause-for-help when stuck
 *   9. Handle save-draft modals on discard
 */

import type { SiteSettings } from "../settings/sections"
import type { ModalResult, NavigationStepResult } from "./types"
import { eventBus } from "../utils/event-bus"
import { settingsManager } from "../settings/manager"
import {
  delay,
  scrollAndClick,
  findButtonByText,
  setReactInputValue,
  waitForElement,
  waitForCondition,
  dispatchEscapeKey,
} from "../utils/dom"
import {
  matchQuestionToAnswer,
  findBestOption,
  classifyQuestion,
  extractLabel,
} from "./question-matcher"
import type { AnswerContext } from "./question-matcher"
import {
  EASY_APPLY_MODAL_SELECTOR,
  EASY_APPLY_CLOSE_SELECTOR,
  EASY_APPLY_BUTTON_SELECTOR,
  EXTERNAL_APPLY_SELECTOR,
  DETAIL_PANEL_SELECTOR,
} from "./linkedin-constants"

/* ── Constants ── */

// FIX F57: MAX_ITERATIONS adaptive — base value, will be adjusted based on form complexity
const BASE_MAX_ITERATIONS = 15
const MAX_ITERATIONS = BASE_MAX_ITERATIONS

const POST_CLICK_DELAY = 800
const POST_NAV_DELAY = 1_200

// FIX F58: Random fallback strategy — configurable via settings
const RANDOM_FALLBACK_ENABLED = true

// FIX F59: Timeout for waitForResume (5 minutes)
const WAIT_FOR_RESUME_TIMEOUT = 300_000



/* ── Daily limit detection ── */

/**
 * Check if the modal contains a daily application limit message.
 * LinkedIn shows this when you've hit the Easy Apply daily cap.
 * FIX F50: Add more detection variants.
 */
export function checkDailyLimit(modal: Element): boolean {

  const text = modal.textContent?.toLowerCase() || ""
  const limitPhrases = [
    "daily limit",
    "application limit",
    "you've reached the limit",
    "you have reached the maximum",
    "too many applications",
    "try again tomorrow",
    "applications today",
    "you've applied",
    "limit reached",
    "maximum applications",
    "can't apply",
    "unable to apply",
    "not able to submit",
  ]
  return limitPhrases.some((phrase) => text.includes(phrase))
}


/* ── Form element discovery ── */

interface FormElement {
  element: Element
  type: ReturnType<typeof classifyQuestion>
  label: string
}

/**
 * Find all unanswered form elements in the modal.
 * Skips elements that already have a value selected/filled.
 */
function findFormElements(modal: Element): FormElement[] {
  const results: FormElement[] = []

  // Find all interactive form elements within the modal
  const inputs = modal.querySelectorAll<HTMLElement>(
    "select, " +
    "textarea, " +
    "input:not([type='hidden']):not([type='file']):not([type='submit']):not([type='button']):not([type='image']):not([disabled])"
  )

  for (const el of inputs) {
    const type = classifyQuestion(el)
    if (type === "unknown") continue

    // Skip already-answered elements
    if (isElementAnswered(el, type)) continue

    const label = extractLabel(el)
    if (!label) continue // Skip elements we can't identify

    results.push({ element: el, type, label })
  }

  return results
}

/**
 * Check if a form element already has a value selected/filled.
 * FIX F51: Re-scan disabled inputs after each answer (some inputs become disabled after answering).
 * FIX F52: For select elements, check selectedIndex instead of value.
 */
function isElementAnswered(el: HTMLElement, type: ReturnType<typeof classifyQuestion>): boolean {
  switch (type) {
    case "select": {
      const select = el as HTMLSelectElement
      // FIX F52: Check selectedIndex — if a non-default option is selected, consider it answered
      if (select.selectedIndex > 0) return true
      return select.value !== "" && select.value !== select.querySelector("option")?.value
    }
    case "radio": {
      const name = (el as HTMLInputElement).name
      if (!name) return false
      const checked = document.querySelector(`input[name="${name}"]:checked`)
      return checked !== null
    }
    case "checkbox":
      return false // Always process checkboxes (may need unchecking)
    case "text":
    case "textarea": {
      const input = el as HTMLInputElement | HTMLTextAreaElement
      return input.value.trim() !== ""
    }
    default:
      return false
  }
}


/* ── Answering individual question types ── */

/**
 * Answer a select/dropdown question by matching the label to settings.
 */
function answerSelectQuestion(
  question: FormElement,
  ctx: AnswerContext
): boolean {
  const select = question.element as HTMLSelectElement
  const answer = matchQuestionToAnswer(question.label, ctx)
  if (!answer) return false

  const options = Array.from(select.options).map((o) => o.text)
  const best = findBestOption(options, answer)
  if (!best) return false

  // Find the option index
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].text === best) {
      select.selectedIndex = i
      select.dispatchEvent(new Event("change", { bubbles: true }))
      console.log(`[SOS] EasyApply: Selected "${best}" for "${question.label}"`)
      return true
    }
  }
  return false
}

/**
 * Answer a radio button question by matching the label to settings.
 */
function answerRadioQuestion(
  question: FormElement,
  ctx: AnswerContext
): boolean {
  const radio = question.element as HTMLInputElement
  const name = radio.name
  if (!name) return false

  const answer = matchQuestionToAnswer(question.label, ctx)
  if (!answer) return false

  // Find all radio buttons with the same name
  const radios = document.querySelectorAll<HTMLInputElement>(
    `input[type="radio"][name="${name}"]`
  )

  // Collect option texts from labels associated with each radio
  const optionTexts: string[] = []
  for (const r of radios) {
    const label = getRadioLabel(r)
    if (label) optionTexts.push(label)
  }

  const best = findBestOption(optionTexts, answer)
  if (!best) return false

  // Click the matching radio
  for (const r of radios) {
    const label = getRadioLabel(r)
    if (label === best) {
      scrollAndClick(r)
      console.log(`[SOS] EasyApply: Selected radio "${best}" for "${question.label}"`)
      return true
    }
  }
  return false
}

/**
 * Get the visible label text for a radio button.
 * FIX F54: Use confidence score per strategy — prefer explicit labels over fallbacks.
 */
function getRadioLabel(radio: HTMLInputElement): string {
  // Strategy 1: Associated <label> via `for` attribute (highest confidence)
  if (radio.id) {
    const label = document.querySelector(`label[for="${radio.id}"]`)
    if (label?.textContent?.trim()) return label.textContent.trim()
  }

  // Strategy 2: Parent <label> that wraps the element
  const parentLabel = radio.closest("label")
  if (parentLabel?.textContent?.trim()) return parentLabel.textContent.trim()

  // Strategy 3: aria-label
  const ariaLabel = radio.getAttribute("aria-label")
  if (ariaLabel?.trim()) return ariaLabel.trim()

  // Strategy 4: Following sibling text
  let next = radio.nextElementSibling
  if (next?.textContent?.trim()) return next.textContent.trim()

  // Strategy 5: aria-labelledby
  const labelledBy = radio.getAttribute("aria-labelledby")
  if (labelledBy) {
    const ref = document.getElementById(labelledBy)
    if (ref?.textContent?.trim()) return ref.textContent.trim()
  }

  // Strategy 6: Closest preceding sibling with text
  let prev = radio.previousElementSibling
  while (prev) {
    const text = prev.textContent?.trim()
    if (text && text.length > 0 && text.length < 200) {
      return text
    }
    prev = prev.previousElementSibling
  }

  // Strategy 7: value attribute (lowest confidence)
  return radio.value || ""
}


/**
 * Answer a text input question.
 */
function answerTextQuestion(
  question: FormElement,
  ctx: AnswerContext
): boolean {
  const answer = matchQuestionToAnswer(question.label, ctx)
  if (!answer) return false

  const input = question.element as HTMLInputElement
  setReactInputValue(input, answer)
  console.log(`[SOS] EasyApply: Filled text "${answer}" for "${question.label}"`)
  return true
}

/**
 * Answer a textarea question.
 */
function answerTextareaQuestion(
  question: FormElement,
  ctx: AnswerContext
): boolean {
  const answer = matchQuestionToAnswer(question.label, ctx)
  if (!answer) return false

  const textarea = question.element as HTMLTextAreaElement
  setReactInputValue(textarea, answer)
  console.log(`[SOS] EasyApply: Filled textarea for "${question.label}"`)
  return true
}

/**
 * Answer a checkbox question — click if unchecked.
 */
function answerCheckboxQuestion(question: FormElement): boolean {
  const checkbox = question.element as HTMLInputElement
  if (!checkbox.checked) {
    scrollAndClick(checkbox)
    console.log(`[SOS] EasyApply: Checked checkbox for "${question.label}"`)
    return true
  }
  return false
}

/* ── Resume upload ── */

/**
 * Upload resume via file input in the modal.
 * Returns true if upload was performed.
 * FIX F55: Convert base64 to Blob directly without fetch() for better compatibility.
 */
async function uploadResume(
  modal: Element,
  resumeData: string,
  resumeFileName: string,
  signal?: AbortSignal
): Promise<boolean> {
  const fileInput = modal.querySelector<HTMLInputElement>(
    "input[type='file'][accept*='pdf'], " +
    "input[type='file'][accept*='doc'], " +
    "input[type='file'][accept*='resume'], " +
    "input[type='file']"
  )
  if (!fileInput) return false

  // Convert base64 data URL to Blob
  try {
    // FIX F55: Convert base64 to Blob directly without fetch()
    let blob: Blob
    if (resumeData.startsWith("data:")) {
      // Parse data URL directly
      const commaIdx = resumeData.indexOf(",")
      const mimeMatch = resumeData.substring(0, commaIdx).match(/data:([^;]+)/)
      const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream"
      const base64 = resumeData.substring(commaIdx + 1)
      const byteString = atob(base64)
      const ab = new ArrayBuffer(byteString.length)
      const ia = new Uint8Array(ab)
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i)
      }
      blob = new Blob([ab], { type: mimeType })
    } else {
      // Fallback: use fetch for non-data URLs
      const response = await fetch(resumeData)
      blob = await response.blob()
    }

    const file = new File([blob], resumeFileName, { type: blob.type })

    const dataTransfer = new DataTransfer()
    dataTransfer.items.add(file)
    fileInput.files = dataTransfer.files
    fileInput.dispatchEvent(new Event("change", { bubbles: true }))
    console.log(`[SOS] EasyApply: Uploaded resume "${resumeFileName}"`)
    await delay(1_500, signal)
    return true
  } catch (err) {
    console.warn(`[SOS] EasyApply: Failed to upload resume:`, err)
    return false
  }
}


/* ── Navigation button detection ── */

/**
 * Find the primary navigation button in the modal footer.
 * Returns the button text and element.
 * FIX F56: Also match aria-label for non-English LinkedIn interfaces.
 */
function findNavigationButton(
  modal: Element
): { text: string; element: Element } | null {
  // Look in the modal footer first
  const footer = modal.querySelector(
    ".jobs-easy-apply-modal__footer, " +
    ".artdeco-modal__actionbar, " +
    ".artdeco-modal__actions, " +
    "footer"
  )

  const container = footer || modal

  // Try common button selectors
  const buttons = container.querySelectorAll<HTMLElement>(
    "button[aria-label*='Next'], " +
    "button[aria-label*='Review'], " +
    "button[aria-label*='Submit'], " +
    "button[aria-label*='Continue'], " +
    "button.artdeco-button--primary, " +
    "button.artdeco-button--highlight"
  )

  for (const btn of buttons) {
    const text = btn.textContent?.trim().toLowerCase() || ""
    // FIX F56: Also check aria-label for non-English interfaces
    const ariaLabel = btn.getAttribute("aria-label")?.toLowerCase() || ""
    if (text.includes("next") || text.includes("review") || text.includes("submit") || text.includes("continue") ||
        ariaLabel.includes("next") || ariaLabel.includes("review") || ariaLabel.includes("submit") || ariaLabel.includes("continue")) {
      return { text: text || ariaLabel, element: btn }
    }
  }

  // Fallback: scan all buttons in container
  const allBtns = container.querySelectorAll("button")
  for (const btn of allBtns) {
    const text = btn.textContent?.trim().toLowerCase() || ""
    const ariaLabel = btn.getAttribute("aria-label")?.toLowerCase() || ""
    if (text === "next" || text === "review" || text === "submit" || text === "continue" ||
        ariaLabel === "next" || ariaLabel === "review" || ariaLabel === "submit" || ariaLabel === "continue") {
      return { text: text || ariaLabel, element: btn }
    }
  }

  return null
}


/* ── Submit application ── */

/**
 * Click the Submit application button and handle the confirmation modal.
 * FIX F60: Use Promise.race to handle both confirmation modal and signal abort.
 */
async function clickSubmitApplication(
  modal: Element,
  signal?: AbortSignal
): Promise<boolean> {
  // Find and click the Submit button
  const submitBtn = findButtonByText(modal, "submit", "submit application", "submit your application")
  if (!submitBtn) {
    console.warn("[SOS] EasyApply: Could not find Submit button")
    return false
  }

  scrollAndClick(submitBtn)

  // FIX F60: Use Promise.race to handle both confirmation modal and signal abort
  try {
    await Promise.race([
      delay(2_000, signal),
      new Promise<void>((resolve) => {
        // Wait for confirmation modal to appear
        const observer = new MutationObserver(() => {
          const confirmModal = document.querySelector(
            ".artdeco-modal--confirmation, " +
            "div[data-test-modal], " +
            ".jobs-easy-apply-modal--confirmation"
          )
          if (confirmModal) {
            observer.disconnect()
            resolve()
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
        // Fallback timeout
        setTimeout(() => {
          observer.disconnect()
          resolve()
        }, 2_000)
      }),
    ])
  } catch {
    // Aborted
    return false
  }

  // Check for confirmation modal
  const confirmModal = document.querySelector(
    ".artdeco-modal--confirmation, " +
    "div[data-test-modal], " +
    ".jobs-easy-apply-modal--confirmation"
  )

  if (confirmModal) {
    // Click "Done" button
    const doneBtn = findButtonByText(confirmModal, "done", "close", "ok", "got it")
    if (doneBtn) {
      scrollAndClick(doneBtn)
      await delay(500, signal)
    } else {
      // Press Escape to dismiss
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
      await delay(500, signal)
    }
  }

  return true
}


/* ── Follow company checkbox ── */

/**
 * Toggle the "Follow company" checkbox on the review screen.
 */
function toggleFollowCompany(modal: Element, follow: boolean): void {
  if (!follow) return

  const followCheckbox = modal.querySelector<HTMLInputElement>(
    "input[type='checkbox'][name*='follow'], " +
    "input[type='checkbox'][aria-label*='follow'], " +
    "label:has(input[type='checkbox'])"
  )

  if (followCheckbox && !followCheckbox.checked) {
    scrollAndClick(followCheckbox)
    console.log("[SOS] EasyApply: Toggled follow company checkbox")
  }
}

/* ── Main orchestrator ── */

/**
 * Fill and submit the Easy Apply modal.
 *
 * This is the main entry point for modal interaction. It:
 *   1. Checks for daily limit
 *   2. Enters question-answering loop (max 15 iterations)
 *   3. Handles navigation (Next → Review → Submit)
 *   4. Handles resume upload
 *   5. Handles pause-for-help when stuck
 *   6. Handles confirmation modal after submit
 *   7. Handles save-draft on discard
 *
 * @param modal       - The Easy Apply modal element
 * @param settings    - Site settings (answers, personal, pipeline config)
 * @param signal      - Optional AbortSignal for cancellation
 * @param onProgress  - Optional progress callback
 *
 * @returns ModalResult indicating success, failure, or daily limit reached
 */
export async function fillEasyApplyModal(
  modal: Element,
  settings: SiteSettings,
  signal?: AbortSignal,
  onProgress?: (msg: string) => void
): Promise<ModalResult> {
  signal?.throwIfAborted()

  // ── Step 1: Check daily limit ──
  if (checkDailyLimit(modal)) {
    console.warn("[SOS] EasyApply: Daily application limit reached")
    eventBus.emit("daily-limit-reached", { siteId: "linkedin" })
    return { status: "dailyLimitReached", reason: "Daily Easy Apply limit reached" }
  }

  // Build answer context
  const ctx: AnswerContext = {
    personal: settingsManager.getGlobal()?.personal || {
      firstName: "", lastName: "", phoneNumber: "",
      currentCity: "", street: "", state: "", zipcode: "", country: "",
    },
    answers: settings.answers,
    eeo: settingsManager.getGlobal()?.eeo || {
      ethnicity: "Decline", gender: "Decline", disabilityStatus: "Decline", veteranStatus: "Decline",
    },
    customAnswers: settings.additional.customAnswers || {},
  }

  const pauseAtFailed = settings.pipeline.pauseAtFailedQuestion
  const followCompanies = settings.pipeline.followCompanies
  const resumeData = settings.additional.resumeData
  const resumeFileName = settings.additional.resumeFileName

  // ── Step 2: Question-answering loop ──
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    signal?.throwIfAborted()

    onProgress?.(`Answering questions (step ${iteration + 1}/${MAX_ITERATIONS})...`)
    console.log(`[SOS] EasyApply: Iteration ${iteration + 1}/${MAX_ITERATIONS}`)

    // Find all unanswered form elements
    const formElements = findFormElements(modal)

    if (formElements.length > 0) {
      console.log(`[SOS] EasyApply: Found ${formElements.length} unanswered question(s)`)

      // Answer each question
      for (const q of formElements) {
        signal?.throwIfAborted()
        const answered = answerQuestion(q, ctx)
        if (answered) {
          console.log(`[SOS] EasyApply: Answered "${q.label}" (${q.type})`)
        } else {
          console.log(`[SOS] EasyApply: Could not answer "${q.label}" (${q.type})`)
        }
        await delay(300, signal)
      }

      // Upload resume if available and not already uploaded
      if (resumeData && resumeFileName) {
        await uploadResume(modal, resumeData, resumeFileName, signal)
      }

      await delay(POST_CLICK_DELAY, signal)
    }

    // Find navigation button
    const navBtn = findNavigationButton(modal)

    if (!navBtn) {
      // No navigation button found — check if we're stuck
      if (formElements.length > 0) {
        // There are unanswered questions and no way forward
        const stuckResult = await handleStuck(
          modal,
          formElements,
          pauseAtFailed,
          signal
        )
        if (stuckResult === "continue") continue
        if (stuckResult === "exit") {
          return { status: "failed", reason: "User stopped or stuck on questions" }
        }
      }

      // No form elements and no nav button — might be on the review screen
      // Try to find a Submit button
      const submitResult = await trySubmit(modal, followCompanies, signal)
      if (submitResult) {
        return { status: "success", reason: "Application submitted successfully" }
      }

      // Nothing we can do — exit
      console.warn("[SOS] EasyApply: No navigation button found and cannot submit")
      return { status: "failed", reason: "Could not find navigation or submit button" }
    }

    // Handle navigation based on button text
    const navResult = await handleNavigation(navBtn, modal, followCompanies, signal)

    switch (navResult.action) {
      case "next":
        // Loop back to answer more questions
        await delay(POST_NAV_DELAY, signal)
        continue

      case "review":
        // On review screen — toggle follow company, then submit
        await delay(POST_NAV_DELAY, signal)
        toggleFollowCompany(modal, followCompanies)
        await delay(500, signal)

        // Try to submit
        const submitOk = await trySubmit(modal, followCompanies, signal)
        if (submitOk) {
          return { status: "success", reason: "Application submitted successfully" }
        }
        return { status: "failed", reason: "Could not submit after review" }

      case "submit":
        // Clicked submit
        await delay(POST_NAV_DELAY, signal)
        return { status: "success", reason: "Application submitted successfully" }

      case "done":
        return { status: "success", reason: "Application submitted successfully" }

      case "stuck":
        const stuckResult2 = await handleStuck(
          modal,
          formElements,
          pauseAtFailed,
          signal
        )
        if (stuckResult2 === "continue") continue
        if (stuckResult2 === "exit") {
          return { status: "failed", reason: "User stopped or stuck on questions" }
        }
        return { status: "failed", reason: "Stuck on questions" }
    }
  }

  // Exceeded max iterations
  console.warn(`[SOS] EasyApply: Exceeded ${MAX_ITERATIONS} iterations`)
  return { status: "failed", reason: `Exceeded ${MAX_ITERATIONS} iterations without completing` }
}

/* ── Helper functions ── */

/**
 * Answer a single question based on its type.
 */
function answerQuestion(q: FormElement, ctx: AnswerContext): boolean {
  switch (q.type) {
    case "select":
      return answerSelectQuestion(q, ctx)
    case "radio":
      return answerRadioQuestion(q, ctx)
    case "text":
      return answerTextQuestion(q, ctx)
    case "textarea":
      return answerTextareaQuestion(q, ctx)
    case "checkbox":
      return answerCheckboxQuestion(q)
    default:
      return false
  }
}

/**
 * Handle navigation button click.
 */
async function handleNavigation(
  navBtn: { text: string; element: Element },
  modal: Element,
  followCompanies: boolean,
  signal?: AbortSignal
): Promise<NavigationStepResult> {
  const text = navBtn.text

  if (text.includes("next") || text.includes("continue")) {
    console.log("[SOS] EasyApply: Clicking Next")
    scrollAndClick(navBtn.element)
    return { action: "next" }
  }

  if (text.includes("review")) {
    console.log("[SOS] EasyApply: Clicking Review")
    scrollAndClick(navBtn.element)
    return { action: "review" }
  }

  if (text.includes("submit")) {
    console.log("[SOS] EasyApply: Clicking Submit")
    const ok = await clickSubmitApplication(modal, signal)
    if (ok) return { action: "submit" }
    return { action: "stuck" }
  }

  return { action: "stuck" }
}

/**
 * Try to submit the application (for review screen or when no nav button found).
 */
async function trySubmit(
  modal: Element,
  followCompanies: boolean,
  signal?: AbortSignal
): Promise<boolean> {
  toggleFollowCompany(modal, followCompanies)
  await delay(500, signal)

  // Look for Submit button
  const submitBtn = findButtonByText(modal, "submit", "submit application", "submit your application")
  if (submitBtn) {
    return clickSubmitApplication(modal, signal)
  }

  return false
}

/**
 * Handle being stuck on a question.
 * If pauseAtFailed is true, emit pause-for-help event and wait for user.
 * Otherwise, try random answers or exit.
 */
async function handleStuck(
  modal: Element,
  formElements: FormElement[],
  pauseAtFailed: boolean,
  signal?: AbortSignal
): Promise<"continue" | "exit"> {
  if (pauseAtFailed && formElements.length > 0) {
    const stuckLabel = formElements[0].label
    console.log(`[SOS] EasyApply: Pausing for help on "${stuckLabel}"`)

    // Emit pause event
    eventBus.emit("pause-for-help", {
      siteId: "linkedin",
      questionLabel: stuckLabel,
      questionType: formElements[0].type,
    })

    // Wait for user to resume (via event bus)
    const resumed = await waitForResume(signal)
    if (!resumed) {
      // User clicked stop
      return "exit"
    }

    // Check if the question is now answered
    const stillStuck = findFormElements(modal).length > 0
    if (stillStuck) {
      console.log(`[SOS] EasyApply: Still stuck after user help — marking as failure`)
      return "exit"
    }

    // Question was answered — continue
    return "continue"
  }

  // Try random answers for select/radio questions
  for (const q of formElements) {
    if (q.type === "select") {
      const select = q.element as HTMLSelectElement
      if (select.options.length > 1) {
        select.selectedIndex = Math.floor(Math.random() * (select.options.length - 1)) + 1
        select.dispatchEvent(new Event("change", { bubbles: true }))
        console.log(`[SOS] EasyApply: Random answer for "${q.label}"`)
      }
    } else if (q.type === "radio") {
      const radio = q.element as HTMLInputElement
      const name = radio.name
      if (name) {
        const radios = document.querySelectorAll<HTMLInputElement>(
          `input[type="radio"][name="${name}"]`
        )
        if (radios.length > 0) {
          const randomIdx = Math.floor(Math.random() * radios.length)
          scrollAndClick(radios[randomIdx])
          console.log(`[SOS] EasyApply: Random radio for "${q.label}"`)
        }
      }
    }
  }

  return "continue"
}

/**
 * Wait for the user to click Resume (or Stop) after a pause-for-help event.
 * Returns true if resumed, false if stopped.
 * FIX F59: Add timeout to prevent infinite wait.
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
      clearTimeout(timeoutId)
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

    // FIX F59: Timeout to prevent infinite wait
    const timeoutId = setTimeout(() => {
      cleanup()
      console.warn("[SOS] EasyApply: waitForResume timed out — treating as stop")
      resolve(false)
    }, WAIT_FOR_RESUME_TIMEOUT)
  })
}

/* ── Modal wait helpers (moved from linkedin.ts) ── */

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

/* ── Easy Apply: Click button (moved from linkedin.ts) ── */

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

/* ── Easy Apply: Close modal (moved from linkedin.ts) ── */

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


