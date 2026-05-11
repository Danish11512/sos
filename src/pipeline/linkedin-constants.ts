/**
 * LinkedIn-specific selectors, URL param maps, and constants.
 * Extracted from linkedin.ts for reuse and cleaner separation.
 */

/* ── DOM Selectors ── */

/** Selector for the LinkedIn global search bar (top nav, present on ALL pages). */
export const GLOBAL_SEARCH_SELECTOR =
  "input.search-global-typeahead__input, " +
  "input[aria-label*='Search'], " +
  "#global-nav-search input, " +
  "input[role='combobox']"

/** Selector for LinkedIn's new semantic job search input (on jobs pages). */
export const SEMANTIC_SEARCH_SELECTOR =
  "input[data-testid='typeahead-input'], " +
  "input[componentkey='semanticSearchBox'], " +
  "input[placeholder*='Describe the job']"

/** Selector for the LinkedIn jobs-specific search input (only on /jobs/ pages). */
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

/** Selector for job card elements.
 *  Supports both old LinkedIn (anchor-based) and new CSS-module design (div[role='button']).
 *  New design: div[role='button'][tabindex='0'] with componentkey attributes.
 *  Old design: anchor elements with job-card-list__title, etc.
 */
/**
 * Selector for job card elements.
 * NEW LinkedIn CSS-module design uses div[role='button'] cards WITHIN the results list.
 * OLD LinkedIn design uses anchor elements. Critical: every selector must scoped to
 * the results-list container so filter buttons / dropdowns are NOT matched.
 *
 * The key insight: real job cards are children of the jobs-search-results list,
 * whereas filter buttons live in the filter-bar above the list.
 */
export const CARD_SELECTOR =
  /* New LinkedIn CSS-module design: div[role='button'] INSIDE the results list */
  ".jobs-search-results-list div[role='button'][tabindex='0'], " +
  ".jobs-search-results__list div[role='button'], " +
  "div.scaffold-layout__list div[role='button'][tabindex='0'], " +
  /* Old LinkedIn design: anchor-based cards */
  "a.job-card-list__title, " +
  "a.job-card-container__link, " +
  "li.jobs-search-results__list-item a[href*='/jobs/view'], " +
  "a[href*='/jobs/view']"

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

/** LinkedIn jobs search page base URL. */
export const LINKEDIN_JOBS_SEARCH_URL = "https://www.linkedin.com/jobs/search-results/"

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

/* ── New LinkedIn CSS-module design selectors (2026 redesign) ── */

/** Selector for the job card container wrapper in the new design. */
export const NEW_CARD_WRAPPER_SELECTOR =
  "div[data-job-id], " +
  "div[data-occludable-job-id], " +
  "div.job-card-container"

/** Selector for the job list column in the new design (LazyColumn). */
export const NEW_LIST_COLUMN_SELECTOR =
  "div[data-testid='lazy-column'][data-component-type='LazyColumn'], " +
  ".jobs-search-results-list, " +
  "div.scaffold-layout__list"

/** Selector for the detail panel column in the new design. */
export const NEW_DETAIL_COLUMN_SELECTOR =
  "div[data-testid='lazy-column']:not([data-component-type='LazyColumn']), " +
  ".jobs-search__job-details, " +
  "div.scaffold-layout__detail"

/** Selector for job title text in new design cards (screen-reader span). */
export const NEW_CARD_TITLE_SELECTOR =
  "span[aria-hidden='true'], " +
  "a.job-card-list__title, " +
  "span.job-card-container__primary-description"

/** Selector for job title visual text in new design cards (aria-hidden span). */
export const NEW_CARD_TITLE_VISUAL_SELECTOR = "span[aria-hidden='true']"

/** Selector for company name in new design cards. */
export const NEW_CARD_COMPANY_SELECTOR =
  "span.job-card-container__primary-description, " +
  "span[data-testid='company-name'], " +
  "a.job-card-container__company-name"

/** Selector for location in new design cards. */
export const NEW_CARD_LOCATION_SELECTOR =
  "li.job-card-container__metadata-item, " +
  "span.job-card-container__metadata-item"

/** Selector for the main workspace container in new design. */
export const NEW_WORKSPACE_SELECTOR =
  "main#workspace, " +
  "div.scaffold-layout"

/** Selector for the results header showing count in new design. */
export const NEW_RESULTS_HEADER_SELECTOR =
  "div.jobs-search-results-list__header, " +
  "h1.jobs-search-results-list__title, " +
  "span.jobs-search-results-list__text"

/** Selector for pagination indicators in new design. */
export const NEW_PAGINATION_SELECTOR =
  "div[data-testid^='pagination-indicator-'], " +
  "div.jobs-search-results-list__pagination"

/* ── Filter dropdown button selectors (top of search results) ── */

/** Filter dropdown button: Date Posted. */
export const FILTER_BTN_DATE_POSTED =
  "button[aria-label*='Date posted filter'], " +
  "button[aria-label*='date posted']"

/** Filter dropdown button: Experience Level. */
export const FILTER_BTN_EXPERIENCE =
  "button[aria-label*='Experience Level filter'], " +
  "button[aria-label*='experience level']"

/** Filter dropdown button: Job Type. */
export const FILTER_BTN_JOB_TYPE =
  "button[aria-label*='Job type filter'], " +
  "button[aria-label*='job type']"

/** Filter dropdown button: On-site/Remote. */
export const FILTER_BTN_ON_SITE =
  "button[aria-label*='On-site/Remote filter'], " +
  "button[aria-label*='on-site/remote']"

/** Filter toggle button: Easy Apply only. */
export const FILTER_BTN_EASY_APPLY =
  "button[aria-label*='Easy Apply filter'], " +
  "button[aria-label*='easy apply']"

/** Filter dropdown button: Sort by. */
export const FILTER_BTN_SORT =
  "button[aria-label*='Sort by'], " +
  "button[aria-label*='sort by']"


/** Generic filter button selector (any filter dropdown at top of results). */
export const FILTER_BUTTONS =
  "button.jobs-search-results-list__filter-button, " +
  "button[aria-label*='filter'], " +
  "button[aria-label*='Filter']"

/** Dropdown panel that appears when a filter button is clicked. */
export const FILTER_DROPDOWN_PANEL =
  ".jobs-search-results-list__filter-dropdown, " +
  "div[data-test-filter-dropdown], " +
  "div[role='listbox'], " +
  ".artdeco-dropdown__content"

/** Option inside a filter dropdown (radio-style: Date Posted, Sort by). */
export const FILTER_DROPDOWN_OPTION =
  "li[role='option'], " +
  "button[role='option'], " +
  "span[role='option']"

/** Checkbox inside a filter dropdown (checkbox-style: Experience Level, Job Type, On-site/Remote). */
export const FILTER_DROPDOWN_CHECKBOX =
  "label, " +
  "span[role='checkbox'], " +
  "div[role='checkbox'], " +
  "input[type='checkbox']"

/** Map from filter setting values to the text shown in LinkedIn's dropdown options. */
export const FILTER_OPTION_TEXT: Record<string, Record<string, string>> = {
  datePosted: {
    "past 24 hours": "Past 24 hours",
    "past week": "Past week",
    "past month": "Past month",
  },
  sortBy: {
    "most recent": "Most recent",
    "most relevant": "Most relevant",
  },
  experienceLevel: {
    "internship": "Internship",
    "entry level": "Entry level",
    "associate": "Associate",
    "mid-senior level": "Mid-Senior level",
    "director": "Director",
    "executive": "Executive",
  },
  jobType: {
    "full-time": "Full-time",
    "part-time": "Part-time",
    "contract": "Contract",
    "temporary": "Temporary",
    "volunteer": "Volunteer",
    "internship": "Internship",
  },
  onSite: {
    "on-site": "On-site",
    "remote": "Remote",
    "hybrid": "Hybrid",
  },
}
