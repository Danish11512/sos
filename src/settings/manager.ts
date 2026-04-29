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
    return this.getMissingMandatoryFields(siteId).length === 0
  }

  /**
   * Returns a list of { section, field, label } objects for all mandatory
   * fields that are NOT yet properly filled in.
   *
   * Exemptions (not checked):
   *   - EEO section entirely (ethicity, gender, disabilityStatus, veteranStatus)
   *   - companies (filters)
   *   - website, currentCtc, noticePeriod (answers)
   *   - linkedinSummary, coverLetter, recentEmployer, confidenceLevel (answers)
   *   - All checkbox / toggle fields (unchecked = valid "no")
   *   - All checkbox-group fields (experienceLevel, jobType, onSite)

   */
  getMissingMandatoryFields(siteId: string): { section: string; field: string; label: string }[] {
    const missing: { section: string; field: string; label: string }[] = []
    const global = this._data.global
    const site = this._data.perSite[siteId]
    if (!site) return [{ section: "general", field: "site", label: "Site settings not initialized" }]

    const g = global

    /* ── Personal Info ── */
    const p = g.personal
    const personalChecks: [string, string, string][] = [
      ["personal", "firstName", "First Name"],
      ["personal", "lastName", "Last Name"],
      ["personal", "phoneNumber", "Phone Number"],
      ["personal", "currentCity", "Current City"],
      ["personal", "street", "Street"],
      ["personal", "state", "State"],
      ["personal", "zipcode", "Zip Code"],
      ["personal", "country", "Country"],
    ]
    for (const [sec, field, label] of personalChecks) {
      if (!(p as unknown as Record<string, string>)[field]?.trim()) {
        missing.push({ section: sec, field, label })
      }
    }

    /* ── Search ── */
    const s = site.search
    if (s.searchTerms.length === 0) {
      missing.push({ section: "search", field: "searchTerms", label: "Search Terms (at least 1)" })
    }
    if (!s.searchLocation.trim()) {
      missing.push({ section: "search", field: "searchLocation", label: "Search Location" })
    }
    // switchNumber — mandatory (not in exempt list)
    if (s.switchNumber <= 0 || isNaN(s.switchNumber)) {
      missing.push({ section: "search", field: "switchNumber", label: "Switch #" })
    }


    /* ── Filters ── */
    const f = site.filters
    const filterTextFields: [string, string][] = [
      ["sortBy", "Sort By"],
      ["datePosted", "Date Posted"],
    ]
    for (const [field, label] of filterTextFields) {
      if (!(f as unknown as Record<string, string>)[field]?.toString().trim()) {
        missing.push({ section: "filters", field, label })
      }
    }
    // companies is EXEMPT
    // All checkbox/toggle/checkbox-group fields are EXEMPT

    // Bad word fields are optional
    // currentExperience — number; empty/NaN is missing
    const curExp = (f as unknown as Record<string, unknown>).currentExperience
    if (curExp == null || (typeof curExp === "number" && isNaN(curExp)) || String(curExp).trim() === "") {
      missing.push({ section: "filters", field: "currentExperience", label: "Current Experience (years)" })
    }

    /* ── Answers ── */

    const a = site.answers
    const answerMandatory: [string, string][] = [
      ["requireVisa", "Require Visa"],
      ["yearsOfExperience", "Years of Experience"],
      ["linkedIn", "LinkedIn URL"],
      ["usCitizenship", "US Citizenship"],
      ["desiredSalary", "Desired Salary"],
      
    ]
    for (const [field, label] of answerMandatory) {
      const val = (a as unknown as Record<string, unknown>)[field]
      const str = String(val ?? "").trim()
      if (field === "desiredSalary") {
        const num = typeof val === "number" ? val : parseFloat(str)
        if (num <= 0 || isNaN(num)) missing.push({ section: "answers", field, label })
      } else {
        if (!str) missing.push({ section: "answers", field, label })
      }
    }
    // website, currentCtc, noticePeriod, linkedinSummary, coverLetter, recentEmployer, confidenceLevel are EXEMPT



    /* ── Pipeline & Behavior ── */
    // clickGap (global) — mandatory
    const clickGap = g.globalBehavior.clickGap
    if (clickGap == null || clickGap <= 0) {
      missing.push({ section: "pipeline", field: "clickGap", label: "Click Gap" })
    }
    // All other pipeline fields are checkboxes — EXEMPT

    /* ── Additional ── */
    const ad = site.additional
    // resumeFileName — must be non-empty (file uploaded)
    if (!ad.resumeFileName?.trim()) {
      missing.push({ section: "additional", field: "resumeFileName", label: "Resume Upload" })
    }
    // customAnswers — mandatory (empty record = valid, but field must exist)
    // autoFillScreeningQuestions is a checkbox — EXEMPT (unchecked = valid "no")

    return missing

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
