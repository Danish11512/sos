export function waitForElement(
  selector: string,
  timeout = 10_000
): Promise<Element | null> {
  return new Promise((resolve) => {
    if (document.querySelector(selector)) {
      resolve(document.querySelector(selector))
      return
    }

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
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
  if (el instanceof HTMLElement) {
    el.click()
  }
}

export function fillInput(
  selector: string,
  value: string
): HTMLInputElement | HTMLTextAreaElement | null {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    selector
  )
  if (!el) return null

  el.value = value
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
  return el
}

/** Wait for a specified number of milliseconds */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Find an element by its text content (case-insensitive, exact match after trim).
 * Scopes to a container if provided, otherwise searches the whole document.
 */
export function findElementByText(
  text: string,
  tag: string = "*",
  container: ParentNode = document
): Element | null {
  const elements = container.querySelectorAll(tag)
  for (const el of elements) {
    if (el.textContent?.trim().toLowerCase() === text.toLowerCase()) {
      return el
    }
  }
  return null
}

/**
 * Find and click an element by its text content.
 */
export function clickByText(
  text: string,
  tag: string = "*",
  container: ParentNode = document
): boolean {
  const el = findElementByText(text, tag, container)
  if (el && el instanceof HTMLElement) {
    el.click()
    return true
  }
  return false
}

/**
 * Find a button by its aria-label attribute (case-insensitive, partial match).
 */
export function findButtonByAriaLabel(
  label: string
): HTMLButtonElement | null {
  const buttons = document.querySelectorAll<HTMLButtonElement>("button")
  for (const btn of buttons) {
    const ariaLabel = btn.getAttribute("aria-label")?.toLowerCase() || ""
    if (ariaLabel.includes(label.toLowerCase())) {
      return btn
    }
  }
  return null
}

/**
 * Wait for an element to appear and be visible (not hidden).
 */
export async function waitForVisibleElement(
  selector: string,
  timeout = 10_000
): Promise<Element | null> {
  const el = await waitForElement(selector, timeout)
  if (!el) return null
  
  // Check if visible
  const htmlEl = el as HTMLElement
  if (htmlEl.offsetParent === null) return null
  return el
}

/**
 * Check if a checkbox or radio input is currently checked.
 */
export function isChecked(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    return el.checked
  }
  return false
}

/**
 * Scroll an element into view and then click it.
 */
export function scrollAndClick(el: Element): void {
  if (el instanceof HTMLElement) {
    el.scrollIntoView({ behavior: "smooth", block: "center" })
  }
  clickElement(el)
}
