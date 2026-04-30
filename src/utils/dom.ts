export function waitForElement<T extends Element = Element>(
  selector: string,
  timeout = 10_000
): Promise<T | null> {
  const existing = document.querySelector<T>(selector)
  if (existing) return Promise.resolve(existing)

  return new Promise<T | null>((resolve) => {
    const observer = new MutationObserver(() => {
      const el = document.querySelector<T>(selector)
      if (el) {
        observer.disconnect()
        resolve(el)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    setTimeout(() => {
      observer.disconnect()
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

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
 */
export async function toggleCheckboxItems(
  modalContainer: ParentNode,
  items: Array<{ enabled: boolean; label: string }>,
  clickDelayMs: number
): Promise<number> {
  let count = 0
  for (const item of items) {
    if (!item.enabled) continue

    const allLabels = modalContainer.querySelectorAll<HTMLElement>("label, span, div[role='checkbox'], div")
    let found = false
    for (const el of allLabels) {
      if (el.textContent?.trim().toLowerCase().includes(item.label.toLowerCase())) {
        scrollAndClick(el)
        await delay(clickDelayMs)
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
 */
export function findButtonByText(
  container: ParentNode,
  ...texts: string[]
): Element | null {
  for (const btn of container.querySelectorAll("button")) {
    const t = btn.textContent?.trim().toLowerCase() || ""
    if (texts.some((txt) => t.includes(txt))) return btn
  }
  return null
}

/**
 * Scroll an element to the bottom repeatedly until content stops growing.
 * Resolves with the final scrollHeight.
 */
export async function scrollToBottom(
  el: Element,
  maxAttempts = 20,
  intervalMs = 500
): Promise<number> {
  let prevHeight = 0
  for (let i = 0; i < maxAttempts; i++) {
    el.scrollTop = el.scrollHeight
    await delay(intervalMs)
    if (el.scrollHeight === prevHeight) break
    prevHeight = el.scrollHeight
  }
  return el.scrollHeight
}

/** Get all visible text content from an element (strips hidden children). */
export function getVisibleText(el: Element): string {
  const clone = el.cloneNode(true) as Element
  for (const hidden of clone.querySelectorAll("[aria-hidden='true'], .visually-hidden, [hidden]")) {
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
  window.dispatchEvent(new PopStateEvent("popstate", { state: scrollData }))
}

/**
 * Set an input element's value in a way that React/SPA frameworks detect.
 * Uses the native property setter (not the value property assignment)
 * which bypasses React's synthetic event system.
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
  input.dispatchEvent(new Event("input", { bubbles: true }))
  input.dispatchEvent(new Event("change", { bubbles: true }))
}
