/**
 * chrome.storage.local wrapper for SOS settings.
 * Uses Object.freeze for read path (immutable), clone only on write (copy-on-write).
 */

import { browser } from "wxt/browser"
import type { AppSettings, GlobalSettings, SiteSettings } from "../settings/sections"
import { DEFAULT_APP_SETTINGS, DEFAULT_SITE } from "../settings/sections"

const STORAGE_KEY = "sos_settings"

/* ── Frozen cache: readers get references, not clones ── */
let frozenCache: Readonly<AppSettings> | null = null

/** Load settings. Returns frozen (readonly) object — zero copy. */
export async function loadSettings(): Promise<AppSettings> {
  if (frozenCache) return frozenCache as unknown as AppSettings
  const result = await browser.storage.local.get(STORAGE_KEY)
  const raw = result[STORAGE_KEY] as AppSettings | undefined
  if (!raw) {
    frozenCache = deepFreeze(structuredClone(DEFAULT_APP_SETTINGS))
    return frozenCache as unknown as AppSettings
  }
  frozenCache = deepFreeze(mergeWithDefaults(raw))
  return frozenCache as unknown as AppSettings
}

export function invalidateSettingsCache(): void {
  frozenCache = null
}

/** Save settings. Mutates the frozen cache to a writable clone first. */
export async function saveSettings(settings: AppSettings): Promise<void> {
  // Un-freeze by cloning so callers can continue to mutate
  const writable = structuredClone(settings)
  frozenCache = deepFreeze(writable)
  await browser.storage.local.set({ [STORAGE_KEY]: writable })
}

/* ── Helpers ── */

function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== "object") return obj as Readonly<T>
  const propNames = Object.getOwnPropertyNames(obj) as (keyof T)[]
  for (const name of propNames) {
    const value = obj[name]
    if (value && typeof value === "object") {
      deepFreeze(value)
    }
  }
  return Object.freeze(obj)
}

function mergeWithDefaults(raw: Partial<AppSettings>): AppSettings {
  const defaults = structuredClone(DEFAULT_APP_SETTINGS)
  return {
    global: mergeGlobal(defaults.global, raw.global ?? {}),
    perSite: mergePerSite(raw.perSite ?? {}),
  }
}

function mergeGlobal(def: GlobalSettings, raw: Partial<GlobalSettings>): GlobalSettings {
  return {
    personal: { ...def.personal, ...(raw.personal ?? {}) },
    eeo: { ...def.eeo, ...(raw.eeo ?? {}) },
    globalBehavior: { ...def.globalBehavior, ...(raw.globalBehavior ?? {}) },
  }
}

function mergePerSite(raw: Record<string, Partial<SiteSettings>>): Record<string, SiteSettings> {
  const result: Record<string, SiteSettings> = {}
  for (const [siteId, site] of Object.entries(raw)) {
    result[siteId] = {
      search: { ...DEFAULT_SITE.search, ...(site.search ?? {}) },
      filters: { ...DEFAULT_SITE.filters, ...(site.filters ?? {}) },
      answers: { ...DEFAULT_SITE.answers, ...(site.answers ?? {}) },
      pipeline: { ...DEFAULT_SITE.pipeline, ...(site.pipeline ?? {}) },
      additional: { ...DEFAULT_SITE.additional, ...(site.additional ?? {}) },
    }
  }
  return result
}

export function onSettingsChanged(
  cb: (settings: AppSettings) => void
): () => void {
  const handler = (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>
  ) => {
    if (changes[STORAGE_KEY]) {
      cb(changes[STORAGE_KEY].newValue as AppSettings)
    }
  }
  browser.storage.local.onChanged.addListener(handler)
  return () => browser.storage.local.onChanged.removeListener(handler)
}

/* ── Pipeline state persistence ── */

const PIPELINE_STATE_KEY = "sos_linkedin_pipeline_state"

export interface PipelinePersistedState {
  termIndex: number
  jobIndex: number
  totalProcessed: number
  sortToggle: boolean
  dateCycleIndex: number
  timestamp: number
}

/**
 * Load persisted pipeline state from storage.
 */
export async function loadPipelineState(): Promise<PipelinePersistedState | null> {
  try {
    const result = await browser.storage.local.get(PIPELINE_STATE_KEY)
    const state = result[PIPELINE_STATE_KEY] as PipelinePersistedState | undefined
    return state ?? null
  } catch {
    return null
  }
}

/**
 * Save pipeline state to storage for crash recovery.
 */
export async function savePipelineState(state: PipelinePersistedState): Promise<void> {
  try {
    await browser.storage.local.set({
      [PIPELINE_STATE_KEY]: { ...state, timestamp: Date.now() },
    })
  } catch (e) {
    console.warn("[SOS] Failed to save pipeline state:", e)
  }
}

/**
 * Clear persisted pipeline state.
 */
export async function clearPipelineState(): Promise<void> {
  try {
    await browser.storage.local.remove(PIPELINE_STATE_KEY)
  } catch {
    // Ignore
  }
}

/* ── Resume state (page refresh recovery) ── */

const RESUME_KEY = "sos_linkedin_resume"

export interface ResumeState {
  /** The search term that was being navigated to. */
  searchTerm: string
  /** Serialized SiteSettings for the pipeline. */
  siteSettings: Record<string, unknown>
  /** Term index in the search terms array. */
  termIndex: number
  /** Timestamp when saved. */
  timestamp: number
}

/**
 * Save resume state before a page refresh (e.g., clicking "Jobs" radio button).
 */
export async function saveResumeState(state: ResumeState): Promise<void> {
  try {
    await browser.storage.local.set({
      [RESUME_KEY]: { ...state, timestamp: Date.now() },
    })
    console.log("[SOS] Saved resume state for page refresh recovery")
  } catch (e) {
    console.warn("[SOS] Failed to save resume state:", e)
  }
}

/**
 * Load resume state after a page refresh.
 */
export async function loadResumeState(): Promise<ResumeState | null> {
  try {
    const result = await browser.storage.local.get(RESUME_KEY)
    const state = result[RESUME_KEY] as ResumeState | undefined
    if (!state) return null
    // Expire after 5 minutes (stale resume)
    if (Date.now() - state.timestamp > 300_000) {
      await clearResumeState()
      return null
    }
    return state
  } catch {
    return null
  }
}

/**
 * Clear resume state after successful recovery.
 */
export async function clearResumeState(): Promise<void> {
  try {
    await browser.storage.local.remove(RESUME_KEY)
  } catch {
    // Ignore
  }
}
