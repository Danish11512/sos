/**
 * Job search filters section.
 * Per-site. Includes all LinkedIn filter options plus skip/qualification logic.
 * UI only — logic NOT IMPLEMENTED.
 */
import { SettingsSection } from "./base"

export interface FilterSettings {
  sortBy: string
  datePosted: string
  salary: string
  easyApplyOnly: boolean
  experienceLevel: string[]
  jobType: string[]
  onSite: string[]
  under10Applicants: boolean
  inYourNetwork: boolean
  fairChanceEmployer: boolean

  /** Advanced filter fields (dynamic multi-select) */
  companies: string[]
  location: string[]
  industry: string[]
  jobFunction: string[]
  jobTitles: string[]
  benefits: string[]
  commitments: string[]

  /** Pause after applying filters to let user tweak results */
  pauseAfterFilters: boolean

  /** Skip logic — companies/words to avoid */
  aboutCompanyBadWords: string[]
  aboutCompanyGoodWords: string[]
  badWords: string[]

  /** Qualification checks */
  securityClearance: boolean
  didMasters: boolean
  currentExperience: number
}

export const DEFAULT_FILTERS: FilterSettings = {
  sortBy: "",
  datePosted: "",
  salary: "",
  easyApplyOnly: true,
  experienceLevel: [],
  jobType: [],
  onSite: [],
  under10Applicants: false,
  inYourNetwork: false,
  fairChanceEmployer: false,

  companies: [],
  location: [],
  industry: [],
  jobFunction: [],
  jobTitles: [],
  benefits: [],
  commitments: [],

  pauseAfterFilters: true,

  aboutCompanyBadWords: [],
  aboutCompanyGoodWords: [],
  badWords: [],

  securityClearance: false,
  didMasters: false,
  currentExperience: -1,
}

export class FilterSection extends SettingsSection<FilterSettings> {
  readonly defaults = DEFAULT_FILTERS
}
