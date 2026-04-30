import { defineBackground } from "wxt/sandbox"
import { browser } from "wxt/browser"
import { sitePresets } from "../config/sites"

export default defineBackground(() => {
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== "complete" || !tab.url) return

    const url = new URL(tab.url)

    // Skip if SOS pipeline is driving navigation (content self-manages)
    if (url.searchParams.has("sos_running")) return

    const matched = sitePresets.find((preset) =>
      tab.url!.includes(preset.urlPattern)
    )
    if (!matched) return

    // Only send site-detected message when the URL looks like a search-results page.
    // This prevents spamming content scripts on profile/feed/message/etc. pages.
    const urlLower = url.href.toLowerCase()
    const isSearchPage =
      matched.id === "linkedin" ? urlLower.includes("/jobs/search/") :
      matched.id === "indeed"   ? (urlLower.includes("/jobs") && url.searchParams.has("q")) :
      false

    if (!isSearchPage) return

    browser.tabs.sendMessage(tabId, {
      type: "SOS_SITE_DETECTED",
      presetId: matched.id,
    }).catch(() => {
      // Content script may not be injected yet — that's fine
    })
  })
})
