/**
 * Content script entry point.
 *
 * Architecture:
 *   - LinkedIn: DOM-based pipeline (no page reloads), runs as a single
 *     continuous async function. Supports AbortController for stop.
 *   - Other sites (Indeed): Legacy URL-based pipeline that navigates
 *     via window.location.href (causes page reloads).
 */

import { defineContentScript } from "wxt/sandbox"
import { browser } from "wxt/browser"
import { sitePresets } from "../config/sites"
import { FloatingWidget } from "../utils/ui"
import { settingsManager } from "../settings/manager"
import type { SiteWidgetState } from "../types/ui"
import type { AppSettings } from "../settings/sections"
import { loadSettings } from "../utils/storage"
import { isOnSearchResultsPage, applyPostNavFilters, captureJobs } from "../pipeline/index"
import { runLinkedInPipeline, navigateToSearchPage } from "../pipeline/linkedin"


let widget: FloatingWidget | null = null

/** Track which URL we last initialized the widget on (SPA-safe, resets on URL change). */
let widgetInitializedUrl = ""

/** AbortController used to cancel a running LinkedIn pipeline. */
let abortController: AbortController | null = null


/* ── Widget / site detection ── */


async function handleSiteDetected(presetId: string): Promise<void> {
  const preset = sitePresets.find((p) => p.id === presetId)
  if (!preset) return

  // SPA guard: skip if we already initialized the widget for this exact URL
  if (widgetInitializedUrl === window.location.href) return
  widgetInitializedUrl = window.location.href

  // Don't destroy + recreate if widget already exists in DOM
  const existingWidgetEl = document.getElementById("sos-floating-widget")
  if (existingWidgetEl) {
    // Widget already in DOM — just reload settings
    await settingsManager.load()
    return
  }

  // Determine initial state
  const onSearchPage = isOnSearchResultsPage(presetId)
  const missing = settingsManager.getMissingMandatoryFields(presetId)
  const initialState: SiteWidgetState = !onSearchPage
    ? "nav"
    : missing.length === 0
      ? "ready"
      : "idle"

  // Clean up any orphaned widget reference
  widget?.destroy()
  await settingsManager.load()

  widget = new FloatingWidget({
    siteName: preset.name,
    siteId: preset.id,
    initialState,
    onNavigate: () => {
      if (presetId === "linkedin") {
        navigateToSearchPage()
      }
    },

    onToggle: async (active) => {
      if (!active) {
        console.log(`[SOS] Stop for ${preset.name}`)
        return
      }

      console.log(`[SOS] Start for ${preset.name}`)

      if (presetId === "linkedin") {
        // ── LinkedIn: DOM-based pipeline (no page reloads) ──
        await settingsManager.load()
        const settings: AppSettings = await loadSettings()
        const site = settings.perSite[presetId]
        if (!site || site.search.searchTerms.length === 0) {
          console.warn("[SOS] LinkedIn: No search terms configured")
          return
        }

        abortController = new AbortController()
        widget?.setState("running")
        try {
          await runLinkedInPipeline(site, abortController.signal, (msg) => {
            console.log(`[SOS] ${msg}`)
          })
          widget?.setState("done")
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            console.log("[SOS] LinkedIn pipeline aborted by user")
            widget?.setStopped()
          } else {
            const msg = err instanceof Error ? err.message : String(err)
            console.error("[SOS] LinkedIn pipeline error:", err)
            widget?.setError(msg)
          }

        } finally {
          abortController = null
        }
      } else {
        // ── Other sites (Indeed): legacy URL-based pipeline ──
        startLegacyPipeline(presetId)
      }
    },
    onStop: () => {
      console.log("[SOS] Stop requested")
      abortController?.abort()
    },
  })
}


/* ── Legacy pipeline (Indeed / non-LinkedIn sites) ── */

const PIPELINE_KEY = "sos_pipeline"

interface PipelineState {
  running: boolean
  terms: string[]
  location: string
  currentIdx: number
  maxJobs: number
}

async function startLegacyPipeline(presetId: string): Promise<void> {
  const settings: AppSettings = await loadSettings()
  const site = settings.perSite[presetId]
  if (!site || site.search.searchTerms.length === 0) return

  const state: PipelineState = {
    running: true,
    terms: site.search.searchTerms,
    location: site.search.searchLocation || "",
    currentIdx: 0,
    maxJobs: site.search.switchNumber || 30,
  }

  await browser.storage.local.set({ [PIPELINE_KEY]: state })
  await browser.storage.local.set({ [`sos_filters_${presetId}`]: site.filters })

  // Navigate to first term (causes page reload for non-LinkedIn sites)
  const url = new URL(window.location.href)
  url.searchParams.set("sos_term_idx", "0")
  url.searchParams.set("sos_max_jobs", String(state.maxJobs))
  url.searchParams.set("sos_active", "1")
  url.searchParams.set("sos_running", "1")

  // Apply keyword if on search results page
  const matchedPreset = sitePresets.find((p) => window.location.hostname.includes(p.urlPattern))
  if (matchedPreset && isOnSearchResultsPage(matchedPreset.id)) {
    url.searchParams.set("keywords", state.terms[0])
    if (state.location) url.searchParams.set("location", state.location)
  }

  window.location.href = url.toString()
}

async function runLegacyPipelineCycle(): Promise<void> {
  const matchedPreset = sitePresets.find((p) =>
    window.location.hostname.includes(p.urlPattern)
  )
  if (!matchedPreset || !isOnSearchResultsPage(matchedPreset.id)) return

  const res = await browser.storage.local.get(PIPELINE_KEY)
  const state = res[PIPELINE_KEY] as PipelineState | undefined
  if (!state || !state.running) return

  console.log(`[SOS] Legacy pipeline cycle: term #${state.currentIdx} "${state.terms[state.currentIdx]}"`)

  // Show widget with "Running" state
  if (!document.getElementById("sos-floating-widget")) {
    widget?.destroy()
    await settingsManager.load()
    widget = new FloatingWidget({
      siteName: matchedPreset.name,
      siteId: matchedPreset.id,
      initialState: "running",
      onToggle: () => {},
      onStop: () => {},
    })
  }

  // Apply DOM filters
  await settingsManager.load()
  await applyPostNavFilters(matchedPreset.id)

  // Remove pipeline URL params
  for (const param of ["sos_active", "sos_running", "sos_term_idx", "sos_max_jobs"]) {
    const url = new URL(window.location.href)
    url.searchParams.delete(param)
    window.history.replaceState({}, "", url.toString())
  }

  // Capture jobs
  const jobResult = await captureJobs(matchedPreset.id, state.maxJobs)
  if (jobResult.success && jobResult.jobs.length > 0) {
    console.log(`[SOS] Captured ${jobResult.jobs.length} job(s)`)
  } else {
    console.warn(`[SOS] Capture warnings:`, jobResult.errors)
  }

  // Advance
  state.currentIdx++
  if (state.currentIdx >= state.terms.length) {
    console.log("[SOS] Legacy pipeline complete")
    state.running = false
    await browser.storage.local.set({ [PIPELINE_KEY]: state })
    return
  }

  // Save updated state, then navigate to next term
  await browser.storage.local.set({ [PIPELINE_KEY]: state })

  const url = new URL(window.location.href)
  url.searchParams.set("keywords", state.terms[state.currentIdx])
  url.searchParams.set("sos_term_idx", String(state.currentIdx))
  url.searchParams.set("sos_max_jobs", String(state.maxJobs))
  url.searchParams.set("sos_active", "1")
  url.searchParams.set("sos_running", "1")

  console.log(`[SOS] Advancing to term #${state.currentIdx} "${state.terms[state.currentIdx]}"`)
  window.location.href = url.toString()
}


/* ── Content script entry ── */

export default defineContentScript({
  matches: ["*://*.linkedin.com/*", "*://*.indeed.com/*"],
  main() {
    // Legacy pipeline resume (for non-LinkedIn sites using URL navigation)
    if (new URLSearchParams(window.location.search).has("sos_running")) {
      runLegacyPipelineCycle()
      return
    }

    // Direct detection: match hostname + create widget
    ;(async () => {
      try {
        const matchedPreset = sitePresets.find((p) =>
          window.location.hostname.includes(p.urlPattern)
        )
        if (matchedPreset) {
          await handleSiteDetected(matchedPreset.id)
        }
      } catch (e) {
        console.warn("[SOS] Direct detection error:", e)
      }
    })()

    // Background message — also listen for URL changes (SPA navigation)
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as { type: string; presetId?: string }
      if (msg.type === "SOS_SITE_DETECTED" && msg.presetId) {
        handleSiteDetected(msg.presetId)
      }
    })

    // Watch for LinkedIn SPA navigation (pushState) — re-check when URL changes
    let lastUrl = window.location.href
    setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href
        // Reset widget URL tracker so it can re-initialize on new search pages
        widgetInitializedUrl = ""
        const matchedPreset = sitePresets.find((p) =>
          window.location.hostname.includes(p.urlPattern)
        )
        if (matchedPreset) {
          handleSiteDetected(matchedPreset.id)
        }
      }
    }, 1000)
  },
})
