/**
 * chrome.storage.local wrapper for SOS settings.
 */
import { browser } from "wxt/browser"
import type { AppSettings, GlobalSettings, SiteSettings } from "../settings/sections"
import { DEFAULT_APP_SETTINGS, DEFAULT_SITE } from "../settings/sections"

const STORAGE_KEY = "sos_settings"

/* ── In-memory cache to avoid chrome.storage round-trips on every page load ── */
let settingsCache: AppSettings | null = null

export async function loadSettings(): Promise<AppSettings> {
  if (settingsCache) return structuredClone(settingsCache)
  const result = await browser.storage.local.get(STORAGE_KEY)
  const raw = result[STORAGE_KEY] as AppSettings | undefined
  if (!raw) {
    settingsCache = structuredClone(DEFAULT_APP_SETTINGS)
    return structuredClone(settingsCache)
  }
  settingsCache = mergeWithDefaults(raw)
  return structuredClone(settingsCache)
}

/** Reset the in-memory cache so next loadSettings() hits chrome.storage. */
export function invalidateSettingsCache(): void {
  settingsCache = null
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

export async function saveSettings(settings: AppSettings): Promise<void> {
  settingsCache = settings
  await browser.storage.local.set({ [STORAGE_KEY]: settings })
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
