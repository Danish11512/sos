/**
 * SettingsManager — container for all setting sections.
 *
 * Holds the complete AppSettings tree and provides:
 *  - load / save via chrome.storage.local
 *  - Section-level access (personal, eeo, search, filters, etc.)
 *  - Validation across all sections
 *  - Convenience methods for the UI layer
 *
 * UI only — logic NOT IMPLEMENTED.
 */
import { PersonalSection, DEFAULT_PERSONAL } from "./personal"
import type { PersonalSettings } from "./personal"
import { EeoSection, DEFAULT_EEO } from "./eeo"
import type { EeoSettings } from "./eeo"
import { GlobalBehaviorSection, DEFAULT_GLOBAL_BEHAVIOR } from "./global"
import type { GlobalBehaviorSettings } from "./global"
import { SearchSection, DEFAULT_SEARCH } from "./search"
import type { SearchSettings } from "./search"
import { FilterSection, DEFAULT_FILTERS } from "./filters"
import type { FilterSettings } from "./filters"
import { AnswerSection, DEFAULT_ANSWERS } from "./answers"
import type { AnswerSettings } from "./answers"
import { PipelineSection, DEFAULT_PIPELINE } from "./pipeline"
import type { PipelineSettings } from "./pipeline"
import { AdditionalSection, DEFAULT_ADDITIONAL } from "./additional"
import type { AdditionalSettings } from "./additional"
import { loadSettings, saveSettings } from "../utils/storage"

/* ------------------------------------------------------------------ */
/*  Data types                                                         */
/* ------------------------------------------------------------------ */

export interface GlobalSettings {
  personal: PersonalSettings
  eeo: EeoSettings
  globalBehavior: GlobalBehaviorSettings
}

export interface SiteSettings {
  search: SearchSettings
  filters: FilterSettings
  answers: AnswerSettings
  pipeline: PipelineSettings
  additional: AdditionalSettings
}

export interface AppSettings {
  global: GlobalSettings
  perSite: Record<string, SiteSettings>
}

export const DEFAULT_GLOBAL: GlobalSettings = {
  personal: DEFAULT_PERSONAL,
  eeo: DEFAULT_EEO,
  globalBehavior: DEFAULT_GLOBAL_BEHAVIOR,
}

export const DEFAULT_SITE: SiteSettings = {
  search: DEFAULT_SEARCH,
  filters: DEFAULT_FILTERS,
  answers: DEFAULT_ANSWERS,
  pipeline: DEFAULT_PIPELINE,
  additional: DEFAULT_ADDITIONAL,
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  global: DEFAULT_GLOBAL,
  perSite: {},
}

/* ------------------------------------------------------------------ */
/*  Validator result                                                    */
/* ------------------------------------------------------------------ */

export interface ValidationEntry {
  section: string
  siteId?: string
  errors: string[]
}

/* ------------------------------------------------------------------ */
/*  Manager                                                             */
/* ------------------------------------------------------------------ */

export class SettingsManager {
  // Section instances (carry validate/apply logic)
  private personal = new PersonalSection()
  private eeo = new EeoSection()
  private globalBehavior = new GlobalBehaviorSection()
  private search = new SearchSection()
  private filters = new FilterSection()
  private answers = new AnswerSection()
  private pipeline = new PipelineSection()
  private additional = new AdditionalSection()

  /** Current data tree */
  private _data: AppSettings = DEFAULT_APP_SETTINGS
  get data(): AppSettings {
    return this._data
  }

  /* ---- Load / Save ---- */

  async load(): Promise<void> {
    this._data = await loadSettings()
    // Ensure the nested structure exists
    this.ensureShape()
  }

  async save(): Promise<void> {
    this.ensureShape()
    await saveSettings(this._data)
  }

  /* ---- Per-site get/set ---- */

  getSite(siteId: string): SiteSettings {
    if (!this._data.perSite[siteId]) {
      this._data.perSite[siteId] = structuredClone(DEFAULT_SITE)
    }
    return this._data.perSite[siteId]
  }

  /* ---- Validation ---- */

  /**
   * Validate all settings across global and every site.
   * Returns a flat list of errors grouped by section.
   */
  validateAll(): ValidationEntry[] {
    const results: ValidationEntry[] = []

    // Global sections
    results.push({
      section: "personal",
      errors: this.personal.validate(this._data.global.personal),
    })
    results.push({
      section: "eeo",
      errors: this.eeo.validate(this._data.global.eeo),
    })
    results.push({
      section: "globalBehavior",
      errors: this.globalBehavior.validate(this._data.global.globalBehavior),
    })

    // Per-site sections
    for (const [siteId, site] of Object.entries(this._data.perSite)) {
      results.push({ section: "search", siteId, errors: this.search.validate(site.search) })
      results.push({ section: "filters", siteId, errors: this.filters.validate(site.filters) })
      results.push({ section: "answers", siteId, errors: this.answers.validate(site.answers) })
      results.push({ section: "pipeline", siteId, errors: this.pipeline.validate(site.pipeline) })
      results.push({ section: "additional", siteId, errors: this.additional.validate(site.additional) })
    }

    return results
  }

  /**
   * Quick check: is a given site ready to run?
   * Requires personal info + at least one search term.
   */
  isSiteReady(siteId: string): boolean {
    const global = this._data.global
    const site = this._data.perSite[siteId]
    if (!site) return false

    return (
      global.personal.firstName.trim().length > 0 &&
      global.personal.lastName.trim().length > 0 &&
      global.personal.phoneNumber.trim().length > 0 &&
      site.search.searchTerms.length > 0
    )
  }

  /* ---- Helpers ---- */

  /** Ensure the nested shape exists after loading legacy flat data */
  private ensureShape(): void {
    const g = this._data.global as unknown as Record<string, unknown>
    if (!g.personal) (g as unknown as Record<string, unknown>).personal = { ...DEFAULT_PERSONAL }
    if (!g.eeo) (g as unknown as Record<string, unknown>).eeo = { ...DEFAULT_EEO }
    if (!g.globalBehavior) (g as unknown as Record<string, unknown>).globalBehavior = { ...DEFAULT_GLOBAL_BEHAVIOR }

    for (const site of Object.values(this._data.perSite)) {
      const s = site as unknown as Record<string, unknown>
      if (!s.search) (s as unknown as Record<string, unknown>).search = { ...DEFAULT_SEARCH }
      if (!s.filters) (s as unknown as Record<string, unknown>).filters = { ...DEFAULT_FILTERS }
      if (!s.answers) (s as unknown as Record<string, unknown>).answers = { ...DEFAULT_ANSWERS }
      if (!s.pipeline) (s as unknown as Record<string, unknown>).pipeline = { ...DEFAULT_PIPELINE }
      if (!s.additional) (s as unknown as Record<string, unknown>).additional = { ...DEFAULT_ADDITIONAL }
    }
  }

  /* ---- Expose section classes for the UI layer to access defaults ---- */

  get sections() {
    return {
      personal: this.personal,
      eeo: this.eeo,
      globalBehavior: this.globalBehavior,
      search: this.search,
      filters: this.filters,
      answers: this.answers,
      pipeline: this.pipeline,
      additional: this.additional,
    }
  }
}

/** Singleton for use throughout the extension */
export const settingsManager = new SettingsManager()

/**
 * Legacy wrapper for content.ts — checks if settings are complete for a site.
 * Delegates to SettingsManager.isSiteReady.
 */
export function areSiteSettingsReady(
  global: GlobalSettings,
  site: SiteSettings | undefined
): boolean {
  if (!global.personal.firstName.trim()) return false
  if (!global.personal.lastName.trim()) return false
  if (!global.personal.phoneNumber.trim()) return false
  if (!site) return false
  if (site.search.searchTerms.length === 0) return false
  return true
}
