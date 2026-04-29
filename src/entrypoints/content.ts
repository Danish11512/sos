import { defineContentScript } from "wxt/sandbox"
import { browser } from "wxt/browser"
import { sitePresets } from "../config/sites"
import type { SitePreset } from "../types/site"
import { FloatingWidget } from "../utils/ui"
import { settingsManager } from "../settings/manager"
import type { WidgetState } from "../types/ui"

let widget: FloatingWidget | null = null

async function handleSiteDetected(presetId: string): Promise<void> {
  const preset = sitePresets.find((p) => p.id === presetId)
  if (!preset) return

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
  // Pipeline orchestration will be implemented per feature
}

export default defineContentScript({
  matches: ["*://*.linkedin.com/*", "*://*.indeed.com/*"],
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as { type: string; presetId?: string }
      if (msg.type === "SOS_SITE_DETECTED" && msg.presetId) {
        handleSiteDetected(msg.presetId)
      }
    })
  },
})
