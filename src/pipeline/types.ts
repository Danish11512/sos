/**
 * Types for the pipeline filter-application system.
 */

/** Result of a full filter-application pass */
export interface ApplyFiltersResult {
  success: boolean
  appliedCount: number
  errors: string[]
}

/** A single ID-based mapping from SOS filter values → site-specific selector/value */
export interface FilterMapping {
  /** The SOS internal field value (e.g. "Entry level") */
  value: string
  /** The CSS selector for the checkbox/button on the site */
  selector?: string
  /** The aria-label text to match (alternative to selector) */
  ariaLabel?: string
  /** The visible label text to match */
  labelText?: string
}

/** Configuration for how a filter-type is applied on a site */
export interface FilterTypeConfig {
  /** How to open the filter panel/modal */
  openFilterPanelSelector?: string
  /** How to close/apply the filter panel */
  applyFilterSelector?: string
  /** How to close/cancel the filter panel */
  cancelFilterSelector?: string
  /** CSS selector for the filter panel/modal container (scoped search) */
  panelContainer?: string
  /** Time to wait after opening the panel (ms) */
  panelOpenDelay?: number
  /** Mapping from SOS values → site-specific UI elements */
  mappings: FilterMapping[]
}

/** Pipeline config per site */
export interface PipelineSiteConfig {
  /** Base search URL (terms & location appended) */
  searchUrl: string
  /** How long to wait after nav before starting filter application */
  navWaitMs: number
  /** Delay between filter clicks */
  clickDelayMs: number
  /** Config for each filter category */
  filters: {
    datePosted?: FilterTypeConfig
    sortBy?: FilterTypeConfig
    experienceLevel?: FilterTypeConfig
    jobType?: FilterTypeConfig
    onSite?: FilterTypeConfig
    easyApplyOnly?: FilterTypeConfig
    under10Applicants?: FilterTypeConfig
    inYourNetwork?: FilterTypeConfig
    fairChanceEmployer?: FilterTypeConfig
  }
}
