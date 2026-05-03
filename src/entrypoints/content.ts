/**
 * Content script entry point.
 * Uses eventBus for decoupled widget ↔ pipeline communication.
 * Replaces callback-based onToggle/onStop with event-driven pattern.
 * No 1s URL polling — uses popstate + eventBus.
 */

import { defineContentScript } from "wxt/sandbox"
import { browser } from "wxt/browser"
import { sitePresets } from "../config/sites"
import { FloatingWidget } from "../utils/ui"
import { settingsManager } from "../settings/manager"
import { eventBus } from "../utils/event-bus"
import type { SiteWidgetState } from "../types/ui"
import type { AppSettings } from "../settings/sections"
import { loadSettings } from "../utils/storage"
import { isOnSearchResultsPage, applyPostNavFilters, captureJobs } from "../pipeline/index"
import { runLinkedInPipeline, navigateToSearchPage } from "../pipeline/linkedin"

import { discardApplication } from "../pipeline/easy-apply-modal"


let widget: FloatingWidget | null = null
let widgetInitializedUrl = ""
let abortController: AbortController | null = null

/* ── Widget creation ── */

async function createWidget(presetId: string): Promise<void> {
  const preset = sitePresets.find((p) => p.id === presetId)
  if (!preset) return

  // SPA guard
  if (widgetInitializedUrl === window.location.href) return
  widgetInitializedUrl = window.location.href

  if (document.getElementById("sos-floating-widget")) {
    await settingsManager.load()
    return
  }

  const onSearchPage = isOnSearchResultsPage(presetId)
  const missing = settingsManager.getMissingMandatoryFields(presetId)
  const initialState: SiteWidgetState = !onSearchPage
    ? "nav"
    : missing.length === 0 ? "ready" : "idle"

  widget?.destroy()
  await settingsManager.load()

  widget = new FloatingWidget({
    siteName: preset.name,
    siteId: preset.id,
    initialState,
    onNavigate: () => {
      if (presetId === "linkedin") navigateToSearchPage()
    },
    onToggle: async (active) => {
      if (!active) return

      if (presetId === "linkedin") {
        await settingsManager.load()
        const settings: AppSettings = await loadSettings()
        const site = settings.perSite[presetId]
        if (!site || site.search.searchTerms.length === 0) {
          console.warn("[SOS] No search terms configured")
          return
        }

        abortController = new AbortController()
        widget?.setState("running")
        try {
          await runLinkedInPipeline(site, abortController.signal, (msg) => {
            widget?.setProgress(msg)
          })
          widget?.setDone()
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            widget?.setStopped()
          } else {
            const msg = err instanceof Error ? err.message : String(err)
            widget?.setError(msg)
          }
        } finally {
          // FIX F84: Ensure modal is discarded when pipeline stops for any reason
          try {
            discardApplication()
          } catch (e) {
            console.warn("[SOS] Error discarding application in finally:", e)
          }
          abortController = null
        }

      } else {
        startLegacyPipeline(presetId)
      }
    },
  })

  // Subscribe to stop-requested from widget (pause-stop, toggle while running)
  // FIX F84: Discard the application modal when stopping the pipeline
  const unsubStop = eventBus.on("stop-requested", () => {
    abortController?.abort()
    // Try to discard any open Easy Apply modal
    try {
      discardApplication()
    } catch (e) {
      console.warn("[SOS] Error discarding application on stop:", e)
    }
  })

  const unsubResume = eventBus.on("resume-requested", () => {
    widget?.setState("running")
  })
  // Subscribe to pause-requested from pipeline (pauseAfterFilters)
  const unsubPause = eventBus.on("pause-requested", (data) => {
    widget?.setState("paused")
    widget?.setProgress(`Paused: "${data.jobTitle}" @ "${data.company}" — click Resume to apply`)
  })

  // Subscribe to pause-for-help from modal engine (stuck on a question)
  const unsubPauseHelp = eventBus.on("pause-for-help", (data) => {
    widget?.setState("paused")
    widget?.setProgress(
      `Help needed: "${data.questionLabel}" (${data.questionType}) — answer in modal then click Resume`
    )
  })

  // Subscribe to daily-limit-reached from modal engine
  // FIX F68: Don't abort signal on daily limit — let pipeline handle it gracefully
  const unsubDailyLimit = eventBus.on("daily-limit-reached", () => {
    widget?.setProgress("Daily Easy Apply limit reached — try again tomorrow")
    widget?.setDone()
  })


  // Override destroy to clean up event subscriptions
  const origDestroy = widget.destroy.bind(widget)
  widget.destroy = () => {
    unsubStop()
    unsubResume()
    unsubPause()
    unsubPauseHelp()
    unsubDailyLimit()
    origDestroy()
  }
}

/* ── Legacy pipeline (Indeed) ── */

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

  const url = new URL(window.location.href)
  url.searchParams.set("sos_term_idx", "0")
  url.searchParams.set("sos_max_jobs", String(state.maxJobs))
  url.searchParams.set("sos_active", "1")
  url.searchParams.set("sos_running", "1")

  const matchedPreset = sitePresets.find((p) => window.location.hostname.includes(p.urlPattern))
  if (matchedPreset && isOnSearchResultsPage(matchedPreset.id)) {
    url.searchParams.set("keywords", state.terms[0])
    if (state.location) url.searchParams.set("location", state.location)
  }

  window.location.href = url.toString()
}

async function runLegacyPipelineCycle(): Promise<void> {
  const matchedPreset = sitePresets.find((p) => window.location.hostname.includes(p.urlPattern))
  if (!matchedPreset || !isOnSearchResultsPage(matchedPreset.id)) return

  const res = await browser.storage.local.get(PIPELINE_KEY)
  const state = res[PIPELINE_KEY] as PipelineState | undefined
  if (!state || !state.running) return

  if (!document.getElementById("sos-floating-widget")) {
    widget?.destroy()
    await settingsManager.load()
    widget = new FloatingWidget({
      siteName: matchedPreset.name,
      siteId: matchedPreset.id,
      initialState: "running",
      onToggle: () => {},
    })
  }

  await settingsManager.load()
  await applyPostNavFilters(matchedPreset.id)

  for (const param of ["sos_active", "sos_running", "sos_term_idx", "sos_max_jobs"]) {
    const url = new URL(window.location.href)
    url.searchParams.delete(param)
    window.history.replaceState({}, "", url.toString())
  }

  const jobResult = await captureJobs(matchedPreset.id, state.maxJobs)
  if (jobResult.success && jobResult.jobs.length > 0) {
    console.log(`[SOS] Captured ${jobResult.jobs.length} job(s)`)
  } else {
    console.warn(`[SOS] Capture warnings:`, jobResult.errors)
  }

  state.currentIdx++
  if (state.currentIdx >= state.terms.length) {
    state.running = false
    await browser.storage.local.set({ [PIPELINE_KEY]: state })
    widget?.setDone()
    return
  }

  await browser.storage.local.set({ [PIPELINE_KEY]: state })

  const url = new URL(window.location.href)
  url.searchParams.set("keywords", state.terms[state.currentIdx])
  url.searchParams.set("sos_term_idx", String(state.currentIdx))
  url.searchParams.set("sos_max_jobs", String(state.maxJobs))
  url.searchParams.set("sos_active", "1")
  url.searchParams.set("sos_running", "1")

  window.location.href = url.toString()
}

/* ── SPA navigation detection (replaces 1s polling) ── */

let lastUrl = window.location.href

function handleUrlChange(): void {
  if (window.location.href === lastUrl) return
  lastUrl = window.location.href
  widgetInitializedUrl = ""
  const matched = sitePresets.find((p) => window.location.hostname.includes(p.urlPattern))
  if (matched) createWidget(matched.id)
}

/* ── Entry ── */

export default defineContentScript({
  matches: ["*://*.linkedin.com/*", "*://*.indeed.com/*"],
  main() {
    // Legacy pipeline resume
    if (new URLSearchParams(window.location.search).has("sos_running")) {
      runLegacyPipelineCycle()
      return
    }

    // Direct detection
    ;(async () => {
      try {
        const matched = sitePresets.find((p) =>
          window.location.hostname.includes(p.urlPattern)
        )
        if (matched) await createWidget(matched.id)
      } catch (e) {
        console.warn("[SOS] Detection error:", e)
      }
    })()

    // Background message
    browser.runtime.onMessage.addListener((message: unknown) => {
      const msg = message as { type: string; presetId?: string }
      if (msg.type === "SOS_SITE_DETECTED" && msg.presetId) {
        createWidget(msg.presetId)
      }
    })

    // SPA navigation — popstate + pushState interception (replaces 1s polling)
    window.addEventListener("popstate", handleUrlChange)
    eventBus.on("url-changed", handleUrlChange)

    // Intercept pushState/replaceState to detect SPA nav without polling
    const origPush = history.pushState.bind(history)
    history.pushState = function (...args) {
      origPush(...args)
      eventBus.emit("url-changed", { url: window.location.href })
    }
    const origReplace = history.replaceState.bind(history)
    history.replaceState = function (...args) {
      origReplace(...args)
      eventBus.emit("url-changed", { url: window.location.href })
    }
  },
})
