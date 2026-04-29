/**
 * chrome.storage.local wrapper for SOS settings.
 * Uses WXT's `browser.storage.local` (webextension-polyfill).
 *
 * Settings are stored as a tree:
 *   global: { personal, eeo, globalBehavior }
 *   perSite: { [siteId]: { search, filters, answers, pipeline, additional } }
 */
import { browser } from "wxt/browser"
import type {
  AppSettings,
  GlobalSettings,
  SiteSettings,
} from "../types/settings"
import { DEFAULT_APP_SETTINGS } from "../types/settings"

const STORAGE_KEY = "sos_settings"

/* ------------------------------------------------------------------ */
/*  Read                                                               */
/* ------------------------------------------------------------------ */

export async function loadSettings(): Promise<AppSettings> {
  const result = await browser.storage.local.get(STORAGE_KEY)
  const raw = result[STORAGE_KEY] as AppSettings | undefined
  if (!raw) return structuredClone(DEFAULT_APP_SETTINGS)

  // Deep-merge with defaults so new section fields are never missing
  return mergeWithDefaults(raw)
}

function mergeWithDefaults(raw: Partial<AppSettings>): AppSettings {
  const defaults = structuredClone(DEFAULT_APP_SETTINGS)
  const merged: AppSettings = {
    global: mergeGlobal(defaults.global, raw.global ?? {}),
    perSite: mergePerSite(raw.perSite ?? {}),
  }
  return merged
}

function mergeGlobal(
  def: GlobalSettings,
  raw: Partial<GlobalSettings>
): GlobalSettings {
  return {
    personal: { ...def.personal, ...(raw.personal ?? {}) },
    eeo: { ...def.eeo, ...(raw.eeo ?? {}) },
    globalBehavior: { ...def.globalBehavior, ...(raw.globalBehavior ?? {}) },
  }
}

function mergePerSite(
  raw: Record<string, Partial<SiteSettings>>
): Record<string, SiteSettings> {
  const def = structuredClone(DEFAULT_APP_SETTINGS).perSite
  const result: Record<string, SiteSettings> = {}
  // Ensure every known siteId has a full structure
  for (const [siteId, site] of Object.entries(raw)) {
    result[siteId] = {
      search: { ...def[siteId]?.search, ...(site.search ?? {}) },
      filters: { ...def[siteId]?.filters, ...(site.filters ?? {}) },
      answers: { ...def[siteId]?.answers, ...(site.answers ?? {}) },
      pipeline: { ...def[siteId]?.pipeline, ...(site.pipeline ?? {}) },
      additional: { ...def[siteId]?.additional, ...(site.additional ?? {}) },
    }
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  Write — full save                                                  */
/* ------------------------------------------------------------------ */

export async function saveSettings(settings: AppSettings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: settings })
}

/* ------------------------------------------------------------------ */
/*  Partial updates                                                    */
/* ------------------------------------------------------------------ */

export async function updateGlobal(
  patch: Partial<GlobalSettings>
): Promise<AppSettings> {
  const current = await loadSettings()
  current.global = {
    personal: { ...current.global.personal, ...(patch.personal ?? current.global.personal) },
    eeo: { ...current.global.eeo, ...(patch.eeo ?? current.global.eeo) },
    globalBehavior: { ...current.global.globalBehavior, ...(patch.globalBehavior ?? current.global.globalBehavior) },
  }
  await saveSettings(current)
  return current
}

export async function updateSiteSettings(
  siteId: string,
  patch: Partial<SiteSettings>
): Promise<AppSettings> {
  const current = await loadSettings()
  const existing = current.perSite[siteId] ?? ({} as SiteSettings)
  current.perSite[siteId] = {
    search: { ...existing.search, ...(patch.search ?? {}) },
    filters: { ...existing.filters, ...(patch.filters ?? {}) },
    answers: { ...existing.answers, ...(patch.answers ?? {}) },
    pipeline: { ...existing.pipeline, ...(patch.pipeline ?? {}) },
    additional: { ...existing.additional, ...(patch.additional ?? {}) },
  }
  await saveSettings(current)
  return current
}

/* ------------------------------------------------------------------ */
/*  Listen for external storage changes  (cross-tab sync)              */
/* ------------------------------------------------------------------ */

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
