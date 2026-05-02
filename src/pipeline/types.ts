/** Result of a full filter-application pass */
export interface ApplyFiltersResult {
  success: boolean
  appliedCount: number
  errors: string[]
}

/**
 * Result of attempting to apply to a job after validation.
 * - `applied: true` — job passed all filters and Easy Apply was clicked
 * - `applied: false` — job was rejected by filters or Easy Apply button not found
 * - `reason` — human-readable explanation of the outcome
 */
export interface ApplyToJobResult {
  applied: boolean
  reason: string
}

/** Scraped data from a single job listing (full detail panel read) */
export interface JobListingData {
  title: string
  company: string
  location: string
  description: string
  url: string
  /**
   * Whether this job passed all user-defined filter checks.
   * Set to `true` by the pipeline after `validateJobForApplication()`.
   * The apply flow can gate on this flag before attempting to apply.
   */
  readyToApply: boolean
}

export interface ScrapeJobResult {
  success: boolean
  jobs: JobListingData[]
  errors: string[]
}


/**
 * Preview data extracted from a job card in the list view (no detail panel needed).
 * Use for batch pre-screening before drilling into individual jobs.
 */
export interface JobPreview {
  title: string
  company: string
  location: string
  url: string
  /** Reference to the anchor element for subsequent click navigation */
  element: HTMLAnchorElement
}
