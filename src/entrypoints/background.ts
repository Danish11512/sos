/**
 * Background script.
 * No polling — uses tabs.onUpdated + webNavigation for SPA URL detection.
 */

import { defineBackground } from "wxt/sandbox"
import { browser } from "wxt/browser"
import { sitePresets } from "../config/sites"

export default defineBackground(() => {
  function notifyIfSearchPage(tabId: number, url: string): void {
    const urlObj = new URL(url)
    if (urlObj.searchParams.has("sos_running")) return

    const matched = sitePresets.find((p) => url.includes(p.urlPattern))
    if (!matched) return

    const urlLower = url.toLowerCase()
    const matchesPattern = matched.searchResultPatterns.some((p) => urlLower.includes(p))
    const hasSearchQuery = matched.requiresSearchQuery ? urlObj.searchParams.has("q") : true
    const isSearchPage = matchesPattern && hasSearchQuery

    if (!isSearchPage) return

    browser.tabs.sendMessage(tabId, {
      type: "SOS_SITE_DETECTED",
      presetId: matched.id,
    }).catch(() => {})
  }

  // Standard page loads
  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab.url) return
    if (changeInfo.status === "loading" || changeInfo.status === "complete") {
      notifyIfSearchPage(tabId, tab.url)
    }
  })

  // SPA navigation detection via webNavigation (replaces 2s polling)
  browser.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId === 0) { // top frame only
      notifyIfSearchPage(details.tabId, details.url)
    }
  })
})
