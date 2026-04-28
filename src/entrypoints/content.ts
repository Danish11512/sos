import { sitePresets } from "../config/sites"
import type { SitePreset } from "../types/site"
import { FloatingWidget } from "../utils/ui"

let widget: FloatingWidget | null = null

function handleSiteDetected(presetId: string): void {
  const preset = sitePresets.find((p) => p.id === presetId)
  if (!preset) return

  // Destroy previous widget if any (e.g. navigating between sites)
  widget?.destroy()

  // Show the new two-piece UI with toggle + settings panel
  widget = new FloatingWidget({
    siteName: preset.name,
    onToggle: (active) => {
      if (active) {
        console.log(`[SOS] Pipeline started for ${preset.name}`)
        runApplyPipeline(preset)
      } else {
        console.log(`[SOS] Pipeline stopped for ${preset.name}`)
        // Stop logic to be wired up later
      }
    },
  })
  console.log(`[SOS] Widget shown for ${preset.name}`)
}

async function runApplyPipeline(preset: SitePreset): Promise<void> {
  console.log(`[SOS] Starting apply pipeline for ${preset.name}`)
  // Pipeline orchestration will be implemented per feature
}

browser.runtime.onMessage.addListener((message) => {
  if (message.type === "SOS_SITE_DETECTED") {
    handleSiteDetected(message.presetId)
  }
})

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {},
})
