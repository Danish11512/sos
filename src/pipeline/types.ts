/** Result of a full filter-application pass */
export interface ApplyFiltersResult {
  success: boolean
  appliedCount: number
  errors: string[]
}

/** Scraped data from a single job listing (full detail panel read) */
export interface JobListingData {
  title: string
  company: string
  location: string
  description: string
  url: string
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
