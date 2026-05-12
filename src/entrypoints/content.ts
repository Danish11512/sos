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
import { loadSettings, loadResumeState, clearResumeState } from "../utils/storage"
import { isOnSearchResultsPage, applyPostNavFilters, captureJobs } from "../pipeline/index"


import { runLinkedInPipeline, confirmJobListings } from "../pipeline/linkedin"
import { runWellfoundPipeline } from "../pipeline/wellfound"

import { discardApplication } from "../utils/dom"

// Expose confirmJobListings to the browser console for manual testing
if (typeof window !== "undefined") {
  ;(window as unknown as Record<string, unknown>).confirmJobListings = confirmJobListings
}


/** Wellfound site preset reference (used instead of hardcoding the site ID string). */
const wellfoundPreset = sitePresets.find((p) => p.id === "wellfound")

let widget: FloatingWidget | null = null
let widgetInitializedUrl = ""
let abortController: AbortController | null = null
/** Track whether the pipeline is actively running to avoid widget resets. */
let pipelineActive = false

/* ── Widget creation ── */

async function createWidget(presetId: string): Promise<void> {
  const preset = sitePresets.find((p) => p.id === presetId)
  if (!preset) return

  // SPA guard
  if (widgetInitializedUrl === window.location.href) return
  widgetInitializedUrl = window.location.href

  // If widget already exists, update its state based on settings
  if (document.getElementById("sos-floating-widget")) {
    const wfOverride = wellfoundPreset && presetId === wellfoundPreset.id
    if (!wfOverride) {
      await settingsManager.load()
      const missing = settingsManager.getMissingMandatoryFields(presetId)
      const newState: SiteWidgetState = missing.length === 0 ? "ready" : "idle"
      // Only update if the widget is in a non-running state
      if (widget && !["running", "starting", "paused"].includes(widget.getState())) {
        widget.setState(newState)
      }
    }
    return
  }

  await settingsManager.load()
  const missing = settingsManager.getMissingMandatoryFields(presetId)
  const isWellfound = wellfoundPreset && presetId === wellfoundPreset.id
  const initialState: SiteWidgetState = isWellfound ? "ready" : (missing.length === 0 ? "ready" : "idle")


  widget?.destroy()
  await settingsManager.load()

  widget = new FloatingWidget({
    siteName: preset.name,
    siteId: preset.id,
    initialState,
    skipSettingsValidation: isWellfound,
    onToggle: async (active) => {

      if (!active) return

      if (presetId === "linkedin") {
        await settingsManager.load()
        const settings: AppSettings = await loadSettings()
        const site = settings.perSite?.[presetId] ?? null
        if (!site || site.search.searchTerms.length === 0) {
          console.warn("[SOS] No search terms configured")
          return
        }

        abortController = new AbortController()
        pipelineActive = true
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
          pipelineActive = false
          // FIX F84: Ensure modal is discarded when pipeline stops for any reason
          try {
            await discardApplication()
          } catch (e) {
            console.warn("[SOS] Error discarding application in finally:", e)
          }
          abortController = null
        }

      } else if (wellfoundPreset && presetId === wellfoundPreset.id) {
        abortController = new AbortController()
        pipelineActive = true
        widget?.setState("running")
        try {
          const ok = await runWellfoundPipeline(abortController.signal, (msg) => {
            widget?.setProgress(msg)
          })
          if (ok) widget?.setDone()
        } catch (err: unknown) {
          if (err instanceof Error && err.name === "AbortError") {
            widget?.setStopped()
          } else {
            const msg = err instanceof Error ? err.message : String(err)
            widget?.setError(msg)
          }
        } finally {
          pipelineActive = false
          try {
            await discardApplication()
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
  const unsubStop = eventBus.on("stop-requested", async () => {
    abortController?.abort()
    // Try to discard any open Easy Apply modal
    try {
      await discardApplication()
    } catch (e) {
      console.warn("[SOS] Error discarding application on stop:", e)
    }
  })

  const unsubResume = eventBus.on("resume-requested", () => {
    widget?.setState("running")
  })
  // Subscribe to pause-requested from pipeline
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

  // ── Resume check: after page refresh from "Jobs" button click ──
  // If there's a saved resume state, auto-start the pipeline
  if (presetId === "linkedin") {
    const resumeState = await loadResumeState()
    if (resumeState) {
      console.log("[SOS] Detected resume state — auto-starting pipeline after page refresh")

      // Load settings and start the pipeline
      await settingsManager.load()
      const settings: AppSettings = await loadSettings()
      const site = settings.perSite?.[presetId] ?? null
      if (site && site.search.searchTerms.length > 0) {
        // Use a jittered delay to let page render + avoid anti-bot pattern
        const resumeDelay = Math.floor(Math.random() * 3000) + 3000 // 3-6s
        setTimeout(async () => {
          abortController = new AbortController()
          widget?.setState("running")
          widget?.setProgress(`Resuming: "${resumeState.searchTerm}"...`)
          try {
            await runLinkedInPipeline(site, abortController.signal, (msg) => {
              widget?.setProgress(msg)
            }, resumeState.termIndex)
            // Pipeline started successfully — clear resume state NOW
            // (after pipeline has begun executing, not before, to avoid
            // losing the resume state if the pipeline fails early).
            await clearResumeState()
            widget?.setDone()
          } catch (err: unknown) {
            if (err instanceof Error && err.name === "AbortError") {
              widget?.setStopped()
            } else {
              const msg = err instanceof Error ? err.message : String(err)
              widget?.setError(msg)
            }
          } finally {
            await clearResumeState()
            try {
              await discardApplication()
            } catch (e) {
              console.warn("[SOS] Error discarding application in finally:", e)
            }
            abortController = null
          }
        }, resumeDelay) // jittered 3-6s delay to let LinkedIn's SPA render + avoid anti-bot pattern
      }
    }
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
  const site = settings.perSite?.[presetId]
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
  // Never reset widget while pipeline is running — pushStateNavigate
  // uses the original history.pushState to avoid triggering this,
  // but popstate events from LinkedIn's own SPA router still fire.
  if (pipelineActive) {
    lastUrl = window.location.href
    return
  }
  lastUrl = window.location.href
  widgetInitializedUrl = ""
  const matched = sitePresets.find((p) => window.location.hostname.includes(p.urlPattern))
  if (matched) createWidget(matched.id)
}

/* ── Entry ── */

export default defineContentScript({
  matches: ["*://*.linkedin.com/*", "*://*.indeed.com/*", "*://*.wellfound.com/*"],
  main() {
    // Legacy pipeline resume (Indeed)
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

    // Intercept pushState/replaceState to detect SPA nav without polling.
    // IMPORTANT: Do NOT emit url-changed when pipeline is active — the pipeline
    // uses pushStateNavigate() which uses the ORIGINAL history.pushState to
    // bypass this patch, but replaceState is still used for scroll restoration
    // by LinkedIn itself.
    const origPush = history.pushState.bind(history)
    history.pushState = function (...args) {
      origPush(...args)
      if (!pipelineActive) {
        eventBus.emit("url-changed", { url: window.location.href })
      }
    }
    const origReplace = history.replaceState.bind(history)
    history.replaceState = function (...args) {
      origReplace(...args)
      if (!pipelineActive) {
        eventBus.emit("url-changed", { url: window.location.href })
      }
    }
  },
})
