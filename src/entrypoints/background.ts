import { defineBackground } from "wxt/sandbox"
import { browser } from "wxt/browser"
import { sitePresets } from "../config/sites"

export default defineBackground(() => {
  /**
   * Send SOS_SITE_DETECTED to a tab if it's on a compatible search results page.
   * Returns true if the message was sent, false otherwise.
   */
  function notifyIfSearchPage(tabId: number, url: string): void {
    const urlObj = new URL(url)

    // Skip if SOS pipeline is driving navigation (content self-manages)
    if (urlObj.searchParams.has("sos_running")) return

    const matched = sitePresets.find((preset) =>
      url.includes(preset.urlPattern)
    )
    if (!matched) return

    // Only notify when the URL looks like a search-results page.
    const urlLower = url.toLowerCase()
    const isSearchPage =
      matched.id === "linkedin" ? urlLower.includes("/jobs/search/") :
      matched.id === "indeed"   ? (urlLower.includes("/jobs") && urlObj.searchParams.has("q")) :
      false

    if (!isSearchPage) return

    browser.tabs.sendMessage(tabId, {
      type: "SOS_SITE_DETECTED",
      presetId: matched.id,
    }).catch(() => {
      // Content script may not be injected yet — that's fine
    })
  }

  // Standard page load / reload detection
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Handle both "loading" and "complete" — LinkedIn SPA may only fire "loading"
    if (!tab.url) return

    if (changeInfo.status === "loading" || changeInfo.status === "complete") {
      notifyIfSearchPage(tabId, tab.url)
    }
  })

  // Handle URL changes that don't trigger onUpdated (some SPA navigations)
  // by periodically re-checking the active tab's URL
  setInterval(async () => {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true })
      if (tabs.length === 0 || !tabs[0].url || !tabs[0].id) return

      // Only re-check LinkedIn and Indeed tabs
      const url = tabs[0].url
      if (!url.includes("linkedin.com") && !url.includes("indeed.com")) return

      notifyIfSearchPage(tabs[0].id, url)
    } catch {
      // Tab may have been closed or permission denied — ignore
    }
  }, 2000)
})
