export function waitForElement(
  selector: string,
  timeout = 10_000
): Promise<Element | null> {
  const existing = document.querySelector(selector)
  if (existing) return Promise.resolve(existing)

  return new Promise((resolve) => {
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
