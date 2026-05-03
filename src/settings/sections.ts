import { SettingsSection } from "./base"

/* ── Personal Info (global) ── */

export interface PersonalSettings {
  firstName: string; lastName: string; phoneNumber: string
  currentCity: string; street: string; state: string; zipcode: string; country: string
}

export const DEFAULT_PERSONAL: PersonalSettings = {
  firstName: "", lastName: "", phoneNumber: "",
  currentCity: "", street: "", state: "", zipcode: "", country: "",
}

export class PersonalSection extends SettingsSection<PersonalSettings> {
  readonly defaults = DEFAULT_PERSONAL
  override validate(data: PersonalSettings): string[] {
    const errors: string[] = []
    if (!data.firstName.trim()) errors.push("First name is required")
    if (!data.lastName.trim()) errors.push("Last name is required")
    if (!data.phoneNumber.trim()) errors.push("Phone number is required")
    if (!data.currentCity.trim()) errors.push("Current city is required")
    if (!data.street.trim()) errors.push("Street is required")
    if (!data.state.trim()) errors.push("State is required")
    if (!data.zipcode.trim()) errors.push("Zip code is required")
    if (!data.country.trim()) errors.push("Country is required")
    return errors
  }
}

/* ── EEO / Diversity (global) ── */

export interface EeoSettings {
  ethnicity: string; gender: string; disabilityStatus: string; veteranStatus: string
}

export const DEFAULT_EEO: EeoSettings = {
  ethnicity: "Decline", gender: "Decline", disabilityStatus: "Decline", veteranStatus: "Decline",
}

export class EeoSection extends SettingsSection<EeoSettings> {
  readonly defaults = DEFAULT_EEO
}

/* ── Global Behavior (global) ── */

export interface GlobalBehaviorSettings {
  clickGap: number; smoothScroll: boolean; keepScreenAwake: boolean
}

export const DEFAULT_GLOBAL_BEHAVIOR: GlobalBehaviorSettings = {
  clickGap: 1, smoothScroll: false, keepScreenAwake: true,
}

export class GlobalBehaviorSection extends SettingsSection<GlobalBehaviorSettings> {
  readonly defaults = DEFAULT_GLOBAL_BEHAVIOR
}

/* ── Search (per-site) ── */

export interface SearchSettings {
  searchTerms: string[]; searchLocation: string; switchNumber: number; randomizeSearchOrder: boolean
}

export const DEFAULT_SEARCH: SearchSettings = {
  searchTerms: [], searchLocation: "", switchNumber: 30, randomizeSearchOrder: false,
}

export class SearchSection extends SettingsSection<SearchSettings> {
  readonly defaults = DEFAULT_SEARCH
  override validate(data: SearchSettings): string[] {
    return data.searchTerms.length === 0 ? ["At least one search term is required"] : []
  }
}

/* ── Filters (per-site) ── */

export interface FilterSettings {
  sortBy: string; datePosted: string; salary: string; easyApplyOnly: boolean
  experienceLevel: string[]; jobType: string[]; onSite: string[]
  under10Applicants: boolean; inYourNetwork: boolean; fairChanceEmployer: boolean
  companies: string[]
  pauseAfterFilters: boolean
  aboutCompanyBadWords: string[]; aboutCompanyGoodWords: string[]; badWords: string[]
  securityClearance: boolean; didMasters: boolean; currentExperience: number
}

export const DEFAULT_FILTERS: FilterSettings = {
  sortBy: "", datePosted: "", salary: "", easyApplyOnly: true,
  experienceLevel: [], jobType: [], onSite: [],
  under10Applicants: false, inYourNetwork: false, fairChanceEmployer: false,
  companies: [],
  pauseAfterFilters: false,
  aboutCompanyBadWords: [], aboutCompanyGoodWords: [], badWords: [],
  securityClearance: false, didMasters: false, currentExperience: -1,
}

export class FilterSection extends SettingsSection<FilterSettings> {
  readonly defaults = DEFAULT_FILTERS
}

/* ── Application Answers (per-site) ── */

export interface AnswerSettings {
  yearsOfExperience: string; requireVisa: string; website: string; linkedIn: string
  usCitizenship: string; desiredSalary: number; currentCtc: number; noticePeriod: number
  linkedinHeadline: string; linkedinSummary: string; coverLetter: string; recentEmployer: string
  confidenceLevel: string
}

export const DEFAULT_ANSWERS: AnswerSettings = {
  yearsOfExperience: "", requireVisa: "No", website: "", linkedIn: "",
  usCitizenship: "", desiredSalary: 0, currentCtc: 0, noticePeriod: 0,
  linkedinHeadline: "", linkedinSummary: "", coverLetter: "", recentEmployer: "",
  confidenceLevel: "",
}

export class AnswerSection extends SettingsSection<AnswerSettings> {
  readonly defaults = DEFAULT_ANSWERS
}

/* ── Pipeline Controls (per-site) ── */

export interface PipelineSettings {
  pauseBeforeSubmit: boolean; pauseAtFailedQuestion: boolean; overwritePreviousAnswers: boolean
  closeTabs: boolean; followCompanies: boolean; runNonStop: boolean; runInBackground: boolean
  alternateSortby: boolean; cycleDatePosted: boolean; stopDateCycleAt24hr: boolean
  clickDelayMs: number
}

export const DEFAULT_PIPELINE: PipelineSettings = {
  pauseBeforeSubmit: true, pauseAtFailedQuestion: true, overwritePreviousAnswers: false,
  closeTabs: false, followCompanies: false, runNonStop: false, runInBackground: false,
  alternateSortby: true, cycleDatePosted: true, stopDateCycleAt24hr: true,
  clickDelayMs: 500,
}


export class PipelineSection extends SettingsSection<PipelineSettings> {
  readonly defaults = DEFAULT_PIPELINE
}

/* ── Additional (per-site) ── */

export interface AdditionalSettings {
  autoFillScreeningQuestions: boolean
  customAnswers: Record<string, string>
  resumeData: string
  resumeFileName: string
}

export const DEFAULT_ADDITIONAL: AdditionalSettings = {
  autoFillScreeningQuestions: true,
  customAnswers: {},
  resumeData: "",
  resumeFileName: "",
}

export class AdditionalSection extends SettingsSection<AdditionalSettings> {
  readonly defaults = DEFAULT_ADDITIONAL
}

/* ── Composite type aliases ── */

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
