import { defineContentScript } from "wxt/sandbox"
import { browser } from "wxt/browser"
import { sitePresets } from "../config/sites"
import { FloatingWidget } from "../utils/ui"
import { settingsManager } from "../settings/manager"
import type { WidgetState } from "../types/ui"
import { runPipeline, applyPostNavFilters, isOnSearchResultsPage } from "../pipeline/index"

let widget: FloatingWidget | null = null
let filtersAppliedOnThisPage = false

async function handleSiteDetected(presetId: string): Promise<void> {
  const preset = sitePresets.find((p) => p.id === presetId)
  if (!preset) return

  if (!filtersAppliedOnThisPage && isOnSearchResultsPage(presetId)) {
    filtersAppliedOnThisPage = true
    console.log(`[SOS] Detected search results page for ${preset.name}, applying DOM-based filters...`)
    const filterResult = await applyPostNavFilters(presetId)
    console.log(`[SOS] Post-nav filters applied: ${filterResult.appliedCount} toggled, success: ${filterResult.success}`)
    if (filterResult.errors.length > 0) {
      console.warn(`[SOS] Filter errors:`, filterResult.errors)
    }
  }

  widget?.destroy()

  await settingsManager.load()
  const missing = settingsManager.getMissingMandatoryFields(presetId)
  const initialState: WidgetState = missing.length === 0 ? "ready" : "idle"

  widget = new FloatingWidget({
    siteName: preset.name,
    siteId: preset.id,
    initialState,
    onToggle: (active) => {
      if (active) {
        console.log(`[SOS] Pipeline started for ${preset.name}`)
        runPipeline(preset.id)
      } else {
        console.log(`[SOS] Pipeline stopped for ${preset.name}`)
      }
    },
  })
  console.log(`[SOS] Widget shown for ${preset.name} (state: ${initialState})`)
}

export default defineContentScript({
  matches: ["*://*.linkedin.com/*", "*://*.indeed.com/*"],
  main() {
    ;(async () => {
      const matchedPreset = sitePresets.find((p) =>
        window.location.hostname.includes(p.urlPattern)
      )
      if (matchedPreset && isOnSearchResultsPage(matchedPreset.id)) {
        filtersAppliedOnThisPage = true
        console.log(`[SOS] Initial load: search results page detected for ${matchedPreset.name}`)
        await settingsManager.load()
        const filterResult = await applyPostNavFilters(matchedPreset.id)
        console.log(`[SOS] Initial post-nav filters: ${filterResult.appliedCount} toggled`)
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
