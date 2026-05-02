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
