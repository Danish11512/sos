/**
 * Generic filter applier — works across any site.
 *
 * Given a FilterTypeConfig and an array of SOS internal values to enable,
 * this module will:
 *   1. Open the filter panel / modal
 *   2. Click/toggle the UI elements that match each value
 *   3. Apply / close the panel
 */

import { delay, waitForElement, clickByText, findElementByText, scrollAndClick } from "../utils/dom"
import type { FilterTypeConfig, ApplyFiltersResult } from "./types"

/**
 * Apply a single filter type (e.g. "experienceLevel", "jobType").
 *
 * @param config  - How to interact with the filter on this site
 * @param values  - The SOS values that should be ENABLED (checked toggled on)
 *                  (e.g. ["Entry level", "Associate"])
 * @param label   - Human-readable label for logging
 * @param options - { clickDelayMs, panelOpenDelay }
 */
export async function applyFilterType(
  config: FilterTypeConfig | undefined,
  values: string[],
  label: string,
  options: { clickDelayMs: number; panelOpenDelay: number }
): Promise<ApplyFiltersResult> {
  const result: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }

  // If no config or no values, skip
  if (!config || values.length === 0) {
    console.log(`[SOS] Filter "${label}": no config or no values to apply, skipping`)
    return result
  }

  console.log(`[SOS] Filter "${label}": applying values ${JSON.stringify(values)}`)

  // 1. Open the filter panel
  if (config.openFilterPanelSelector) {
    const openBtn = await waitForElement(config.openFilterPanelSelector, 8_000)
    if (!openBtn) {
      result.errors.push(`Could not find open-panel button for "${label}": ${config.openFilterPanelSelector}`)
      result.success = false
      return result
    }
    scrollAndClick(openBtn)
    console.log(`[SOS] Clicked open-panel button for "${label}"`)
    await delay(options.panelOpenDelay)
  }

  // Determine scoped container for finding controls
  const container: ParentNode = config.panelContainer
    ? (document.querySelector(config.panelContainer) ?? document)
    : document

  // 2. Build lookup of what we want to enable
  const wanted = new Set(values.map((v) => v.toLowerCase().trim()))

  // 3. Process each mapping entry
  for (const mapping of config.mappings) {
    const shouldBeOn = wanted.has(mapping.value.toLowerCase().trim())

    // Try to find the element using: selector, ariaLabel, or labelText
    let el: Element | null = null

    if (mapping.selector) {
      el = container.querySelector(mapping.selector)
    }

    if (!el && mapping.ariaLabel) {
      // Search by aria-label within container
      const allElements = container.querySelectorAll<HTMLElement>(
        "button, a, div, span, label, input"
      )
      for (const candidate of allElements) {
        const ariaLabel = candidate.getAttribute("aria-label")?.toLowerCase() || ""
        if (ariaLabel.includes(mapping.ariaLabel.toLowerCase())) {
          el = candidate
          break
        }
      }
    }

    if (!el && mapping.labelText) {
      el = findElementByText(mapping.labelText, "*", container)
    }

    if (!el) {
      // Could not find the element — might not be on the page (e.g. certain filter options unavailable)
      console.log(`[SOS] Filter "${label}": element for "${mapping.value}" not found, skipping`)
      continue
    }

    // 4. Determine if this element is already in the desired state
    const inputEl = el.tagName === "INPUT" ? (el as HTMLInputElement) : el.querySelector("input")
    const isCurrentlyChecked = inputEl ? inputEl.checked : el.getAttribute("aria-checked") === "true"

    if (shouldBeOn && !isCurrentlyChecked) {
      scrollAndClick(el)
      await delay(options.clickDelayMs)
      result.appliedCount++
      console.log(`[SOS] Filter "${label}": toggled ON "${mapping.value}"`)
    } else if (!shouldBeOn && isCurrentlyChecked) {
      // Optionally uncheck — but we typically only enable, skip
      console.log(`[SOS] Filter "${label}": "${mapping.value}" is checked but not wanted, leaving as-is`)
    } else {
      console.log(`[SOS] Filter "${label}": "${mapping.value}" already in desired state`)
    }
  }

  // 5. Apply / close the panel
  if (config.applyFilterSelector) {
    const applyBtn = await waitForElement(config.applyFilterSelector, 5_000)
    if (applyBtn) {
      scrollAndClick(applyBtn)
      console.log(`[SOS] Clicked apply button for "${label}"`)
    } else {
      result.errors.push(`Apply button not found for "${label}": ${config.applyFilterSelector}`)
    }
  } else if (config.panelContainer || config.openFilterPanelSelector) {
    // If we opened a panel but have no apply button, try to close it
    const closeBtn = config.cancelFilterSelector
      ? document.querySelector(config.cancelFilterSelector)
      : null
    if (closeBtn) {
      scrollAndClick(closeBtn)
      console.log(`[SOS] Closed filter panel for "${label}"`)
    }
  }

  return result
}

/**
 * Apply multiple filter types in sequence.
 */
export async function applyAllFilterTypes(
  filterConfigs: Array<{
    config: FilterTypeConfig | undefined
    values: string[]
    label: string
  }>,
  options: { clickDelayMs: number; panelOpenDelay: number }
): Promise<ApplyFiltersResult> {
  const combined: ApplyFiltersResult = { success: true, appliedCount: 0, errors: [] }

  for (const fc of filterConfigs) {
    const r = await applyFilterType(fc.config, fc.values, fc.label, options)
    combined.appliedCount += r.appliedCount
    if (!r.success) {
      combined.success = false
      combined.errors.push(...r.errors)
    }
  }

  return combined
}
