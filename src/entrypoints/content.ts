import { sitePresets } from "../config/sites"
import type { SitePreset } from "../types/site"

function handleSiteDetected(presetId: string): void {
  const preset = sitePresets.find((p) => p.id === presetId)
  if (!preset) return

  runApplyPipeline(preset)
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
