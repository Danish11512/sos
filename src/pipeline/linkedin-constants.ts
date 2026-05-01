/**
 * LinkedIn-specific selectors, URL param maps, and constants.
 * Extracted from linkedin.ts for reuse and cleaner separation.
 */

/* ── DOM Selectors ── */

/** Selector for the LinkedIn search input. */
export const SEARCH_INPUT_SELECTOR =
  "input[aria-label*='Search by title'], " +
  "input.jobs-search-box__text-input, " +
  "#jobs-search-box-keywords"

/** Selector for the search results sidebar container. */
export const LINKEDIN_RESULTS_SELECTOR =
  ".jobs-search-results-list, " +
  ".jobs-search-results__list, " +
  "ul.jobs-search-results__list, " +
  "div.scaffold-layout__list"

/** Selector for job card anchor elements. */
export const CARD_SELECTOR =
  "a.job-card-list__title, " +
  "a.job-card-container__link, " +
  "li.jobs-search-results__list-item a[href*='/jobs/view']"

/** Selector for the job detail panel. */
export const DETAIL_PANEL_SELECTOR =
  ".jobs-search__job-details, " +
  "div.jobs-details, " +
  ".job-view-layout, " +
  "div.job-details-actions"

/** Selector for the job list sidebar scroller. */
export const LIST_SCROLLER_SELECTOR =
  ".jobs-search-results-list, " +
  ".jobs-search-results__list, " +
  "ul.jobs-search-results__list, " +
  "div.scaffold-layout__list"

/** Selector for the Easy Apply / Apply button in the detail panel. */
export const EASY_APPLY_BUTTON_SELECTOR =
  "button.jobs-apply-button, " +
  "button[aria-label*='Easy Apply'], " +
  "button[aria-label*='Apply now'], " +
  "button[aria-label*='Apply'], " +
  "button.jobs-apply-button--primary"

/** Selector for external apply links (redirect off LinkedIn). */
export const EXTERNAL_APPLY_SELECTOR =
  "a[href*='/jobs/view/'], " +
  "a.jobs-apply-button--external, " +
  "a[data-tracking-control-name*='external_job']"

/** Selector for the Easy Apply modal. */
export const EASY_APPLY_MODAL_SELECTOR =
  ".jobs-easy-apply-modal, " +
  "div[data-job-applicant-modal], " +
  "div.artdeco-modal-layer--default, " +
  "div[data-easy-apply-modal]"

/** LinkedIn jobs search page URL. */
export const LINKEDIN_JOBS_SEARCH_URL = "https://www.linkedin.com/jobs/search/"

/** URL path fragment that identifies a search results page. */
export const SEARCH_PAGE_PATH = "/jobs/search/"

/* ── URL param maps ── */

export const DATE_POSTED_MAP: Record<string, string> = {
  "past 24 hours": "r86400",
  "past week": "r604800",
  "past month": "r2592000",
}

export const EXPERIENCE_MAP: Record<string, string> = {
  "Internship": "1",
  "Entry level": "2",
  "Associate": "3",
  "Mid-Senior level": "4",
  "Director": "5",
  "Executive": "6",
}

export const JOB_TYPE_MAP: Record<string, string> = {
  "Full-time": "F",
  "Part-time": "P",
  "Contract": "C",
  "Temporary": "T",
  "Volunteer": "V",
  "Internship": "I",
}

export const ON_SITE_MAP: Record<string, string> = {
  "On-site": "1",
  "Remote": "2",
  "Hybrid": "3",
}

export const SORT_MAP: Record<string, string> = {
  "most recent": "1",
  "most relevant": "2",
}

/** Filter URL param keys cleaned before rebuilding. */
export const FILTER_URL_PARAMS = ["f_SB2", "f_TPR", "f_E", "f_JT", "f_WT", "f_AL"]
