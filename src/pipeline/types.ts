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
  /** Reference to the job card element for subsequent click navigation */
  element: HTMLElement
  /** FIX F31: Job ID for re-querying the DOM by URL */
  jobId: string
}

/* ── Modal result types (merged from modal-result.ts) ── */

/** Final outcome of filling an Easy Apply modal. */
export type ModalResult =
  | { status: "success"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "dailyLimitReached"; reason: string }

/** Result of answering a single question step. */
export interface QuestionStepResult {
  answered: number
  errors: string[]
}

/** Result of a single navigation step (clicking Next / Review / Submit). */
export interface NavigationStepResult {
  action: "next" | "review" | "submit" | "stuck" | "done"
  /** If stuck, the label of the question that caused the block. */
  stuckOnLabel?: string
}
