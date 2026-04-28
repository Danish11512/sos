import { sitePresets } from "../config/sites"

export default defineBackground(() => {
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) return

    const matched = sitePresets.find((preset) =>
      tab.url!.includes(preset.urlPattern)
    )

    if (matched) {
      browser.tabs.sendMessage(tabId, {
        type: "SOS_SITE_DETECTED",
        presetId: matched.id,
      })
    }
  })
})
