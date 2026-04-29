/**
 * SettingsManager — container for all setting sections.
 */
import { PersonalSection } from "./sections"
import type { PersonalSettings } from "./sections"
import { EeoSection } from "./sections"
import type { EeoSettings } from "./sections"
import { GlobalBehaviorSection } from "./sections"
import type { GlobalBehaviorSettings } from "./sections"
import { SearchSection } from "./sections"
import type { SearchSettings } from "./sections"
import { FilterSection } from "./sections"
import type { FilterSettings } from "./sections"
import { AnswerSection } from "./sections"
import type { AnswerSettings } from "./sections"
import { PipelineSection } from "./sections"
import type { PipelineSettings } from "./sections"
import { AdditionalSection } from "./sections"
import type { AdditionalSettings } from "./sections"
import {
  DEFAULT_PERSONAL,
  DEFAULT_EEO,
  DEFAULT_GLOBAL_BEHAVIOR,
  DEFAULT_SEARCH,
  DEFAULT_FILTERS,
  DEFAULT_ANSWERS,
  DEFAULT_PIPELINE,
  DEFAULT_ADDITIONAL,
  DEFAULT_SITE,
  DEFAULT_APP_SETTINGS,
} from "./sections"
import type { GlobalSettings, SiteSettings, AppSettings } from "./sections"
import { loadSettings, saveSettings } from "../utils/storage"

export type { GlobalSettings, SiteSettings, AppSettings }
export type { PersonalSettings, EeoSettings, GlobalBehaviorSettings }
export type { SearchSettings, FilterSettings, AnswerSettings, PipelineSettings, AdditionalSettings }
export {
  DEFAULT_PERSONAL, DEFAULT_EEO, DEFAULT_GLOBAL_BEHAVIOR,
  DEFAULT_SEARCH, DEFAULT_FILTERS, DEFAULT_ANSWERS, DEFAULT_PIPELINE, DEFAULT_ADDITIONAL,
  DEFAULT_SITE, DEFAULT_APP_SETTINGS,
}

/* ── Validator result ── */

export interface ValidationEntry {
  section: string
  siteId?: string
  errors: string[]
}

/* ── Manager ── */

export class SettingsManager {
  private personal = new PersonalSection()
  private eeo = new EeoSection()
  private globalBehavior = new GlobalBehaviorSection()
  private search = new SearchSection()
  private filters = new FilterSection()
  private answers = new AnswerSection()
  private pipeline = new PipelineSection()
  private additional = new AdditionalSection()

  private _data: AppSettings = DEFAULT_APP_SETTINGS
  get data(): AppSettings {
    return this._data
  }

  async load(): Promise<void> {
    this._data = await loadSettings()
    this.ensureShape()
  }

  async save(): Promise<void> {
    this.ensureShape()
    await saveSettings(this._data)
  }

  getSite(siteId: string): SiteSettings {
    if (!this._data.perSite[siteId]) {
      this._data.perSite[siteId] = structuredClone(DEFAULT_SITE)
    }
    return this._data.perSite[siteId]
  }

  validateAll(): ValidationEntry[] {
    const results: ValidationEntry[] = []
    results.push({ section: "personal", errors: this.personal.validate(this._data.global.personal) })
    results.push({ section: "eeo", errors: this.eeo.validate(this._data.global.eeo) })
    results.push({ section: "globalBehavior", errors: this.globalBehavior.validate(this._data.global.globalBehavior) })
    for (const [siteId, site] of Object.entries(this._data.perSite)) {
      results.push({ section: "search", siteId, errors: this.search.validate(site.search) })
      results.push({ section: "filters", siteId, errors: this.filters.validate(site.filters) })
      results.push({ section: "answers", siteId, errors: this.answers.validate(site.answers) })
      results.push({ section: "pipeline", siteId, errors: this.pipeline.validate(site.pipeline) })
      results.push({ section: "additional", siteId, errors: this.additional.validate(site.additional) })
    }
    return results
  }

  isSiteReady(siteId: string): boolean {
    const global = this._data.global
    const site = this._data.perSite[siteId]
    if (!site) return false
    const p = global.personal
    return (
      p.firstName.trim().length > 0 &&
      p.lastName.trim().length > 0 &&
      p.phoneNumber.trim().length > 0 &&
      p.currentCity.trim().length > 0 &&
      p.street.trim().length > 0 &&
      p.state.trim().length > 0 &&
      p.zipcode.trim().length > 0 &&
      p.country.trim().length > 0 &&
      site.search.searchTerms.length > 0
    )
  }

  private ensureShape(): void {
    const g = this._data.global as unknown as Record<string, unknown>
    if (!g.personal) g.personal = { ...DEFAULT_PERSONAL }
    if (!g.eeo) g.eeo = { ...DEFAULT_EEO }
    if (!g.globalBehavior) g.globalBehavior = { ...DEFAULT_GLOBAL_BEHAVIOR }
    for (const site of Object.values(this._data.perSite)) {
      const s = site as unknown as Record<string, unknown>
      if (!s.search) s.search = { ...DEFAULT_SEARCH }
      if (!s.filters) s.filters = { ...DEFAULT_FILTERS }
      if (!s.answers) s.answers = { ...DEFAULT_ANSWERS }
      if (!s.pipeline) s.pipeline = { ...DEFAULT_PIPELINE }
      if (!s.additional) s.additional = { ...DEFAULT_ADDITIONAL }
    }
  }

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

export const settingsManager = new SettingsManager()

/** Legacy check — keeps existing callers working */
export function areSiteSettingsReady(
  global: GlobalSettings,
  site: SiteSettings | undefined
): boolean {
  const p = global.personal
  if (!p.firstName.trim()) return false
  if (!p.lastName.trim()) return false
  if (!p.phoneNumber.trim()) return false
  if (!p.currentCity.trim()) return false
  if (!p.street.trim()) return false
  if (!p.state.trim()) return false
  if (!p.zipcode.trim()) return false
  if (!p.country.trim()) return false
  if (!site) return false
  if (site.search.searchTerms.length === 0) return false
  return true
}
