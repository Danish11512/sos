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
  "li.jobs-search-results__list-item a[href*='/jobs/view'], " +
  "a[href*='/jobs/view'], " +
  "div.job-card-container, " +
  "li[data-occludable-job-id]"

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

/** Selector for the Easy Apply modal close/dismiss button (X). */
export const EASY_APPLY_CLOSE_SELECTOR =
  "button[aria-label*='Dismiss'], " +
  "button[aria-label*='Close'], " +
  "button.artdeco-modal__dismiss, " +
  "button.jobs-easy-apply-modal__close-btn, " +
  ".artdeco-modal__dismiss"

/** LinkedIn jobs search page URL. Uses /search-results/ path with random currentJobId to avoid wrong page. */
const RANDOM_JOB_ID = Math.floor(Math.random() * 900000000) + 100000000
export const LINKEDIN_JOBS_SEARCH_URL = `https://www.linkedin.com/jobs/search-results/?currentJobId=${RANDOM_JOB_ID}&keywords=software%20engineer&origin=SEMANTIC_SEARCH_HISTORY&geoId=90000070&distance=25`

/** URL path fragment that identifies a search results page. */
export const SEARCH_PAGE_PATH = "/jobs/search-results/"

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
export const FILTER_URL_PARAMS = ["f_SB2", "f_TPR", "f_E", "f_JT", "f_WT", "f_AL", "f_CF"]

/** Date posted param values for cycling. */
export const DATE_POSTED_VALUES = ["r86400", "r604800", "r2592000"]

/** Sort param values for alternating. */
export const SORT_VALUES = ["1", "2"]

/** Non-English "All filters" button selectors. */
export const ALL_FILTERS_BUTTON_SELECTORS =
  "button[aria-label*='All filters'], " +
  "button.jobs-search-dropdown__trigger--all-filters, " +
  "button[data-control-name*='filter'], " +
  "button[data-control-name*='all_filters']"

/** Non-English "Show results" button selectors. */
export const SHOW_RESULTS_BUTTON_SELECTORS =
  "button[aria-label*='Show results'], " +
  "button.jobs-search-all-filters__apply-button, " +
  "button[data-control-name*='apply_filters']"

/** Description content selectors (wait for actual content, not skeleton). */
export const DESCRIPTION_CONTENT_SELECTOR =
  ".jobs-description__content, " +
  ".jobs-box__html-content, " +
  ".job-details-jobs-unified-top-card__description-container, " +
  "article, " +
  ".jobs-description"

/** "Show more" button selectors. */
export const SHOW_MORE_BUTTON_SELECTOR =
  "button[aria-label*='Show more'], " +
  "button[aria-label*='Read more'], " +
  "button[aria-label*='View more'], " +
  "button[aria-label*='Show full'], " +
  "button.inline-show-more-text__button, " +
  ".jobs-description__show-more button"

/** Empty state indicator selectors. */
export const EMPTY_STATE_SELECTOR =
  ".jobs-search-no-results, " +
  ".jobs-search-two-pane__no-results, " +
  "div[data-test-no-results]"
