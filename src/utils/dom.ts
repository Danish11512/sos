export function waitForElement<T extends Element = Element>(
  selector: string,
  timeout = 10_000,
  signal?: AbortSignal
): Promise<T | null> {
  const existing = document.querySelector<T>(selector)
  if (existing) return Promise.resolve(existing)

  return new Promise<T | null>((resolve) => {
    if (signal?.aborted) {
      resolve(null)
      return
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector<T>(selector)
      if (el) {
        observer.disconnect()
        if (signal) signal.removeEventListener("abort", onAbort)
        resolve(el)
      }
    })

    function onAbort(): void {
      observer.disconnect()
      resolve(null)
    }

    observer.observe(document.body, { childList: true, subtree: true })

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
    }

    setTimeout(() => {
      observer.disconnect()
      if (signal) signal.removeEventListener("abort", onAbort)
      resolve(null)
    }, timeout)
  })
}

export function clickElement(el: Element): void {
  if (el instanceof HTMLElement) el.click()
}

export function fillInput(
  selector: string,
  value: string
): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)
  if (!el) return null
  el.value = value
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
  return el
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }
    const timer = setTimeout(resolve, ms)
    if (signal) {
      signal.addEventListener("abort", () => {
        clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      }, { once: true })
    }
  })
}

/** Find element by exact text content (case-insensitive, trimmed). */
export function findElementByText(
  text: string,
  tag = "*",
  container: ParentNode = document
): Element | null {
  const match = text.toLowerCase()
  for (const el of container.querySelectorAll(tag)) {
    if (el.textContent?.trim().toLowerCase() === match) return el
  }
  return null
}

/** Scroll element into view then click. */
export function scrollAndClick(el: Element): void {
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: "smooth", block: "center" })
  }
  clickElement(el)
}

/**
 * Generic helper: click checkbox/label items inside a modal by text content.
 * Returns the number of items toggled.
 *
 * FIX F19: Narrow scope to modal's content area. Use specific selectors.
 * FIX F20: Use exact or word-boundary matching instead of includes().
 */
export async function toggleCheckboxItems(
  modalContainer: ParentNode,
  items: Array<{ enabled: boolean; label: string }>,
  clickDelayMs: number,
  signal?: AbortSignal
): Promise<number> {
  let count = 0
  for (const item of items) {
    if (signal?.aborted) return count
    if (!item.enabled) continue

    // FIX F19: Use more specific selectors, scoped to modal content area
    const allLabels = modalContainer.querySelectorAll<HTMLElement>(
      "label[for], span[role='checkbox'], div[role='checkbox'], label"
    )
    let found = false
    for (const el of allLabels) {
      if (signal?.aborted) return count
      const text = el.textContent?.trim().toLowerCase() || ""
      // FIX F20: Use word-boundary matching to avoid false positives
      const escaped = item.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      const re = new RegExp(`\\b${escaped}\\b`, "i")
      if (re.test(text)) {
        scrollAndClick(el)
        await delay(clickDelayMs, signal)
        count++
        found = true
        break
      }
    }
  }
  return count
}

/**
 * Find a button inside a container by text content (case-insensitive, partial match).
 * FIX F46: Add negative checks to skip buttons containing "applied", "submitted", "withdrawn".
 */
export function findButtonByText(
  container: ParentNode,
  ...texts: string[]
): Element | null {
  for (const btn of container.querySelectorAll("button")) {
    const t = btn.textContent?.trim().toLowerCase() || ""
    // FIX F46: Skip buttons with negative indicators
    const negativeIndicators = ["applied", "submitted", "withdrawn"]
    if (negativeIndicators.some((neg) => t.includes(neg))) continue
    if (texts.some((txt) => t.includes(txt))) return btn
  }
  return null
}

/**
 * Scroll an element to the bottom repeatedly until content stops growing.
 * Resolves with the final scrollHeight.
 *
 * FIX F25: Use smarter approach — scroll → wait → check for new content.
 */
export async function scrollToBottom(
  el: Element,
  maxAttempts = 20,
  intervalMs = 500,
  signal?: AbortSignal
): Promise<number> {
  let prevHeight = 0
  let noChangeCount = 0
  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) return el.scrollHeight
    el.scrollTop = el.scrollHeight
    await delay(intervalMs, signal)
    if (el.scrollHeight === prevHeight) {
      noChangeCount++
      // FIX F25: Wait for 2 consecutive no-changes before stopping
      if (noChangeCount >= 2) break
    } else {
      noChangeCount = 0
    }
    prevHeight = el.scrollHeight
  }
  return el.scrollHeight
}

/**
 * Wait for a predicate to return true, checking on every DOM mutation.
 * Uses MutationObserver on the given container (or document.body).
 * Resolves when predicate returns true, or when timeout is reached (throws).
 *
 * This is the core primitive that replaces all time-based delay() calls
 * and waitForStableDOM(). Instead of waiting for a fixed time, we wait
 * for a specific condition to be met, checking on every DOM mutation.
 *
 * @param predicate  - Function that returns true when the condition is met
 * @param options    - Optional configuration
 * @returns Promise that resolves when predicate returns true
 * @throws Error if timeout is reached before predicate returns true
 */
export async function waitForCondition(
  predicate: () => boolean,
  options?: {
    container?: Element
    timeoutMs?: number
    signal?: AbortSignal
    /** If true, also check on a short interval for cases where DOM doesn't change but state does */
    pollIntervalMs?: number
  }
): Promise<void> {
  const { container = document.body, timeoutMs = 10_000, signal, pollIntervalMs } = options || {}

  // Fast path: already true
  if (predicate()) return
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")

  return new Promise<void>((resolve, reject) => {
    let pollTimer: ReturnType<typeof setInterval> | undefined
    let timeoutTimer: ReturnType<typeof setTimeout>

    const observer = new MutationObserver(() => {
      if (predicate()) {
        cleanup()
        resolve()
      }
    })

    function cleanup(): void {
      observer.disconnect()
      clearTimeout(timeoutTimer)
      if (pollTimer) clearInterval(pollTimer)
      if (signal) signal.removeEventListener("abort", onAbort)
    }

    function onAbort(): void {
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }

    observer.observe(container, { childList: true, subtree: true, attributes: true, characterData: true })

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
    }

    // Optional polling for cases where DOM mutations don't fire (e.g., React state changes)
    if (pollIntervalMs && pollIntervalMs > 0) {
      pollTimer = setInterval(() => {
        if (predicate()) {
          cleanup()
          resolve()
        }
      }, pollIntervalMs)
    }

    timeoutTimer = setTimeout(() => {
      observer.disconnect()
      if (pollTimer) clearInterval(pollTimer)
      if (signal) signal.removeEventListener("abort", onAbort)
      reject(new Error(`waitForCondition timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
}

/**
 * Wait for new child elements matching a selector to appear in a container.
 * Uses MutationObserver to detect when new cards/elements are added.
 * Resolves with the new total count of matching elements.
 *
 * Useful for scroll-based lazy loading: scroll, then wait for new items.
 *
 * @param container     - The container element to observe
 * @param existingCount - The number of matching elements already present
 * @param options       - Optional configuration
 * @returns The new total count of matching elements
 */
export async function waitForNewElements(
  container: Element,
  existingCount: number,
  options?: {
    selector?: string
    timeoutMs?: number
    signal?: AbortSignal
  }
): Promise<number> {
  const { selector = "*", timeoutMs = 5_000, signal } = options || {}

  // Fast path: already have new elements
  const current = container.querySelectorAll(selector).length
  if (current > existingCount) return current
  if (signal?.aborted) return existingCount

  return new Promise<number>((resolve) => {
    let timer: ReturnType<typeof setTimeout>

    const observer = new MutationObserver(() => {
      const count = container.querySelectorAll(selector).length
      if (count > existingCount) {
        observer.disconnect()
        clearTimeout(timer)
        if (signal) signal.removeEventListener("abort", onAbort)
        resolve(count)
      }
    })

    function onAbort(): void {
      observer.disconnect()
      clearTimeout(timer)
      resolve(container.querySelectorAll(selector).length)
    }

    observer.observe(container, { childList: true, subtree: true })

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
    }

    timer = setTimeout(() => {
      observer.disconnect()
      if (signal) signal.removeEventListener("abort", onAbort)
      resolve(container.querySelectorAll(selector).length)
    }, timeoutMs)
  })
}

/**
 * Wait for an element's text content to reach a minimum length.
 * Useful for waiting for descriptions to fully load.
 */
export async function waitForTextContent(
  selector: string,
  minLength: number,
  options?: {
    timeoutMs?: number
    signal?: AbortSignal
  }
): Promise<Element | null> {
  const { timeoutMs = 10_000, signal } = options || {}

  const el = document.querySelector(selector)
  if (el && (el.textContent || "").trim().length >= minLength) return el
  if (signal?.aborted) return null

  return new Promise<Element | null>((resolve) => {
    let timer: ReturnType<typeof setTimeout>

    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector)
      if (element && (element.textContent || "").trim().length >= minLength) {
        observer.disconnect()
        clearTimeout(timer)
        if (signal) signal.removeEventListener("abort", onAbort)
        resolve(element)
      }
    })

    function onAbort(): void {
      observer.disconnect()
      clearTimeout(timer)
      resolve(null)
    }

    observer.observe(document.body, { childList: true, subtree: true, characterData: true })

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true })
    }

    timer = setTimeout(() => {
      observer.disconnect()
      if (signal) signal.removeEventListener("abort", onAbort)
      const element = document.querySelector(selector)
      resolve(element && (element.textContent || "").trim().length >= minLength ? element : null)
    }, timeoutMs)
  })
}

/** Get all visible text content from an element (strips hidden children).
 *  FIX F40: Only strip elements with CSS display:none or visibility:hidden, not aria-hidden. */
export function getVisibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  for (const hidden of clone.querySelectorAll(".visually-hidden, [hidden], [style*='display: none'], [style*='display:none']")) {
    hidden.remove()
  }
  return (clone.textContent || "").trim()
}

/** URL param helpers */
export function hasUrlParam(name: string): boolean {
  return new URLSearchParams(window.location.search).has(name)
}

export function removeUrlParam(name: string): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(name)
  window.history.replaceState({}, "", url.toString())
}

/**
 * Navigate via history.pushState + PopStateEvent to avoid page reload.
 * LinkedIn's SPA router listens for popstate to re-fetch data.
 * Saves and restores scroll position to prevent jarring jumps.
 *
 * FIX F13: Also dispatch hashchange. Monkey-patch popstate listener as fallback.
 */
export function pushStateNavigate(url: string | URL): void {
  // Save scroll data from the job list sidebar
  const scroller = document.querySelector(
    ".jobs-search-results-list, " +
    ".jobs-search-results__list, " +
    "div.scaffold-layout__list"
  )
  const scrollData = {
    scrollY: window.scrollY,
    listScrollTop: scroller?.scrollTop ?? 0,
  }

  history.pushState(scrollData, "", url.toString())

  // FIX F13: Dispatch both popstate and hashchange for broader compatibility
  window.dispatchEvent(new PopStateEvent("popstate", { state: scrollData }))
  window.dispatchEvent(new HashChangeEvent("hashchange"))
}

/**
 * Set an input element's value in a way that React/SPA frameworks detect.
 * Uses the native property setter (not the value property assignment)
 * which bypasses React's synthetic event system.
 *
 * FIX F5: After setting value, also dispatch focus, blur, input events.
 */
export function setReactInputValue(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    (input.constructor as unknown as { prototype: typeof HTMLInputElement }).prototype,
    "value"
  )?.set
  nativeSetter?.call(input, value)

  // FIX F5: Dispatch focus, blur, input, change events for React compatibility
  input.dispatchEvent(new Event("focus", { bubbles: true }))
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
  input.dispatchEvent(new Event("blur", { bubbles: true }))
}

/**
 * Dispatch keyboard events in a way that maximizes React/SPA compatibility.
 * FIX F6: Dispatch ALL three events (keydown, keypress, keyup).
 */
export function dispatchEnterKey(element: Element): void {
  const eventOptions = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
    composed: true,
  }

  element.dispatchEvent(new KeyboardEvent("keydown", eventOptions))
  element.dispatchEvent(new KeyboardEvent("keypress", eventOptions))
  element.dispatchEvent(new KeyboardEvent("keyup", eventOptions))
}

/**
 * Dispatch Escape key event with maximum compatibility.
 * FIX F63: Use composed: true for shadow DOM compatibility.
 */
export function dispatchEscapeKey(): void {
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  )
}

/**
 * Generate a random delay within a range (for human-like behavior).
 * FIX F66/F79: Rate limiting and anti-bot detection.
 */
export function randomDelay(minMs: number, maxMs: number, signal?: AbortSignal): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs
  return delay(ms, signal)
}

/**
 * Check if LinkedIn has shown an anti-bot interstitial or CAPTCHA.
 * FIX F79: Anti-bot detection monitoring.
 */
export function detectAntiBotInterstitial(): boolean {
  const bodyText = document.body.textContent?.toLowerCase() || ""
  const indicators = [
    "unusual traffic",
    "verify you're not a robot",
    "captcha",
    "please verify",
    "automated requests",
    "too many requests",
    "rate limit",
    "try again later",
  ]
  return indicators.some((ind) => bodyText.includes(ind))
}

/**
 * Check if user is logged into LinkedIn.
 * FIX F3: Session/auth check.
 */
export function isLinkedInLoggedIn(): boolean {
  // Check for profile avatar (logged in indicator)
  const profileAvatar = document.querySelector(
    "img.global-nav__me-photo, " +
    "img[data-control-name*='profile'], " +
    ".global-nav__me-photo, " +
    "div.profile-rail-card__avatar"
  )
  if (profileAvatar) return true

  // Check for sign-in button (not logged in)
  const signInBtn = document.querySelector(
    "a[href*='login'], " +
    "a.nav__button-secondary, " +
    "a[data-tracking-control-name*='guest_nav']"
  )
  if (signInBtn) return false

  // Default: assume logged in (we're on LinkedIn, likely authenticated)
  return true
}
