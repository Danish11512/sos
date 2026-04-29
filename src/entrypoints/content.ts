import { defineContentScript } from "wxt/sandbox"
import { browser } from "wxt/browser"
import { sitePresets } from "../config/sites"
import type { SitePreset } from "../types/site"
import { FloatingWidget } from "../utils/ui"
import { settingsManager } from "../settings/manager"
import type { WidgetState } from "../types/ui"
import { runPipeline, applyPostNavFilters, isOnSearchResultsPage } from "../pipeline/index"

let widget: FloatingWidget | null = null
let filtersAppliedOnThisPage = false

async function handleSiteDetected(presetId: string): Promise<void> {
  const preset = sitePresets.find((p) => p.id === presetId)
  if (!preset) return

  // Apply post-nav filters once per page load when on search results page
  if (!filtersAppliedOnThisPage && isOnSearchResultsPage(presetId)) {
    filtersAppliedOnThisPage = true
    console.log(`[SOS] Detected search results page for ${preset.name}, applying DOM-based filters...`)
    const filterResult = await applyPostNavFilters(presetId)
    console.log(`[SOS] Post-nav filters applied: ${filterResult.appliedCount} toggled, success: ${filterResult.success}`)
    if (filterResult.errors.length > 0) {
      console.warn(`[SOS] Filter errors:`, filterResult.errors)
    }
  }

  // Destroy previous widget if any (e.g. navigating between sites)
  widget?.destroy()

  // Determine initial state using comprehensive mandatory field check
  await settingsManager.load()
  const missing = settingsManager.getMissingMandatoryFields(presetId)
  const ready = missing.length === 0
  const initialState: WidgetState = ready ? "ready" : "idle"

  // Show the new two-piece UI with toggle + settings panel
  widget = new FloatingWidget({
    siteName: preset.name,
    siteId: preset.id,
    initialState,
    onToggle: (active) => {
      if (active) {
        console.log(`[SOS] Pipeline started for ${preset.name}`)
        runApplyPipeline(preset)
      } else {
        console.log(`[SOS] Pipeline stopped for ${preset.name}`)
      }
    },
  })
  console.log(`[SOS] Widget shown for ${preset.name} (state: ${initialState})`)
}


async function runApplyPipeline(preset: SitePreset): Promise<void> {
  console.log(`[SOS] Starting apply pipeline for ${preset.name}`)

  // Run the pipeline — this navigates to the search results page
  // with all URL-encoded filters applied
  const result = await runPipeline(preset.id)
  console.log(`[SOS] Pipeline result for ${preset.name}:`, result)

  // After navigation, the content script will re-fire on the new page
  // and handleSiteDetected will apply the DOM-based filters automatically
}

export default defineContentScript({
  matches: ["*://*.linkedin.com/*", "*://*.indeed.com/*"],
  main() {
    // Apply post-nav filters immediately on initial page load if on search results page.
    // Use the guard flag to prevent duplicate application when the background message also arrives.
    ;(async () => {
      for (const preset of sitePresets) {
        if (window.location.hostname.includes(preset.urlPattern)) {
          if (isOnSearchResultsPage(preset.id)) {
            filtersAppliedOnThisPage = true
            console.log(`[SOS] Initial load: search results page detected for ${preset.name}`)
            await settingsManager.load()
            const filterResult = await applyPostNavFilters(preset.id)
            console.log(`[SOS] Initial post-nav filters: ${filterResult.appliedCount} toggled`)
          }
        }
      }
    })()

    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as { type: string; presetId?: string }
      if (msg.type === "SOS_SITE_DETECTED" && msg.presetId) {
        handleSiteDetected(msg.presetId)
      }
    })
  },
})


