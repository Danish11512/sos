/**
 * SettingsManager — container for all setting sections.
 */
import type { PersonalSettings, SearchSettings, FilterSettings, AnswerSettings, PipelineSettings } from "./sections"
import {
  PersonalSection, EeoSection, GlobalBehaviorSection,
  SearchSection, FilterSection, AnswerSection, PipelineSection, AdditionalSection,
  DEFAULT_GLOBAL, DEFAULT_SITE, DEFAULT_APP_SETTINGS,
} from "./sections"
import type { GlobalSettings, SiteSettings, AppSettings } from "./sections"
import { loadSettings, saveSettings } from "../utils/storage"

export type { GlobalSettings, SiteSettings, AppSettings }
export type { PersonalSettings, SearchSettings, FilterSettings, AnswerSettings, PipelineSettings }
export { DEFAULT_SITE, DEFAULT_APP_SETTINGS }

export interface ValidationEntry {
  section: string
  siteId?: string
  errors: string[]
}

export class SettingsManager {
  private sections = {
    personal: new PersonalSection(),
    eeo: new EeoSection(),
    globalBehavior: new GlobalBehaviorSection(),
    search: new SearchSection(),
    filters: new FilterSection(),
    answers: new AnswerSection(),
    pipeline: new PipelineSection(),
    additional: new AdditionalSection(),
  }

  private _data: AppSettings = structuredClone(DEFAULT_APP_SETTINGS)
  get data(): AppSettings { return this._data }

  async load(): Promise<void> {
    this._data = await loadSettings()
    this.ensureShape()
  }

  /** Direct-sync the manager's cache without a storage round-trip. */
  setData(data: AppSettings): void {
    this._data = data
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
    const g = this._data.global
    results.push({ section: "personal", errors: this.sections.personal.validate(g.personal) })
    results.push({ section: "eeo", errors: this.sections.eeo.validate(g.eeo) })
    results.push({ section: "globalBehavior", errors: this.sections.globalBehavior.validate(g.globalBehavior) })
    for (const [siteId, site] of Object.entries(this._data.perSite)) {
      results.push({ section: "search", siteId, errors: this.sections.search.validate(site.search) })
      results.push({ section: "filters", siteId, errors: this.sections.filters.validate(site.filters) })
      results.push({ section: "answers", siteId, errors: this.sections.answers.validate(site.answers) })
      results.push({ section: "pipeline", siteId, errors: this.sections.pipeline.validate(site.pipeline) })
      results.push({ section: "additional", siteId, errors: this.sections.additional.validate(site.additional) })
    }
    return results
  }

  isSiteReady(siteId: string): boolean {
    return this.getMissingMandatoryFields(siteId).length === 0
  }

  /**
   * Returns mandatory fields that are NOT yet filled in.
   * Exemptions: EEO section, companies, website/currentCtc/noticePeriod/linkedinSummary/coverLetter/recentEmployer/confidenceLevel,
   * all checkbox/toggle/checkbox-group fields.
   */
  getMissingMandatoryFields(siteId: string): { section: string; field: string; label: string }[] {
    const missing: { section: string; field: string; label: string }[] = []
    const global = this._data.global
    const site = this._data.perSite[siteId]
    if (!site) return [{ section: "general", field: "site", label: "Site settings not initialized" }]

    /* Personal Info */
    const p = global.personal
    for (const [field, label] of [
      ["firstName", "First Name"], ["lastName", "Last Name"], ["phoneNumber", "Phone Number"],
      ["currentCity", "Current City"], ["street", "Street"], ["state", "State"],
      ["zipcode", "Zip Code"], ["country", "Country"],
    ] as const) {
      if (emptyStr(p[field])) missing.push({ section: "personal", field, label })
    }

    /* Search */
    const s = site.search
    if (s.searchTerms.length === 0) missing.push({ section: "search", field: "searchTerms", label: "Search Terms (at least 1)" })
    if (emptyStr(s.searchLocation)) missing.push({ section: "search", field: "searchLocation", label: "Search Location" })
    if (s.switchNumber <= 0 || isNaN(s.switchNumber)) missing.push({ section: "search", field: "switchNumber", label: "Switch #" })

    /* Filters */
    if (emptyStr(site.filters.sortBy)) missing.push({ section: "filters", field: "sortBy", label: "Sort By" })
    if (emptyStr(site.filters.datePosted)) missing.push({ section: "filters", field: "datePosted", label: "Date Posted" })
    if (site.filters.currentExperience < 0 || isNaN(site.filters.currentExperience)) {
      missing.push({ section: "filters", field: "currentExperience", label: "Current Experience (years)" })
    }

    /* Answers */
    for (const [field, label] of [
      ["requireVisa", "Require Visa"], ["yearsOfExperience", "Years of Experience"],
      ["linkedIn", "LinkedIn URL"], ["usCitizenship", "US Citizenship"],
    ] as const) {
      if (emptyStr(site.answers[field])) missing.push({ section: "answers", field, label })
    }
    const salNum = site.answers.desiredSalary
    if (salNum <= 0 || isNaN(salNum)) missing.push({ section: "answers", field: "desiredSalary", label: "Desired Salary" })

    /* Pipeline & Behavior */
    if (global.globalBehavior.clickGap <= 0) missing.push({ section: "pipeline", field: "clickGap", label: "Click Gap" })

    /* Additional */
    if (emptyStr(site.additional.resumeFileName)) missing.push({ section: "additional", field: "resumeFileName", label: "Resume Upload" })

    return missing
  }

  private ensureShape(): void {
    const g = this._data.global
    if (!g.personal) g.personal = structuredClone(DEFAULT_GLOBAL.personal)
    if (!g.eeo) g.eeo = structuredClone(DEFAULT_GLOBAL.eeo)
    if (!g.globalBehavior) g.globalBehavior = structuredClone(DEFAULT_GLOBAL.globalBehavior)
    for (const site of Object.values(this._data.perSite)) {
      if (!site.search) site.search = structuredClone(DEFAULT_SITE.search)
      if (!site.filters) site.filters = structuredClone(DEFAULT_SITE.filters)
      if (!site.answers) site.answers = structuredClone(DEFAULT_SITE.answers)
      if (!site.pipeline) site.pipeline = structuredClone(DEFAULT_SITE.pipeline)
      if (!site.additional) site.additional = structuredClone(DEFAULT_SITE.additional)
    }
  }
}

/* ── Helpers ── */

const emptyStr = (_: unknown) => !String(_ ?? "").trim()

export const settingsManager = new SettingsManager()
