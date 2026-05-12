/**
 * Wellfound-specific DOM selectors for job cards, detail panels, and apply forms.
 * Extracted from DOM analysis in docs/wellfound-architecture.md.
 *
 * All selectors follow the multi-strategy CSS pattern used in linkedin-constants.ts:
 * current CSS-module design first, then legacy/fallback alternatives.
 */

/* ── Page-level containers ── */

/** Selector for the startup-grouped job listing container.
 *  Each `div[data-test="StartupResult"]` wraps a startup's section with company name
 *  and all its associated job cards. */
export const STARTUP_RESULT_SELECTOR = `div[data-test="StartupResult"]`

/** Selector for the job listing list container.
 *  Contains all individual job cards within a startup section. */
export const JOB_LISTING_LIST_SELECTOR = `div[data-testid="job-listing-list"]`

/* ── Individual job card selectors ── */

/** Selector for job card elements.
 *  Wellfound groups jobs by startup; each job card appears inside the listing list
 *  container. Cards contain title, compensation, location, and action buttons. */
export const JOB_CARD_SELECTOR =
  /* Primary: structured job-listing-list children */
  `div[data-testid="job-listing-list"] > div, ` +
  /* Fallback: any link with /jobs/ path inside startup results */
  `div[data-test="StartupResult"] a[href*="/jobs/"], ` +
  /* Broad fallback: any job link on the page */
  `a[href^="/jobs/"]`

/** Selector for job link anchors.
 *  Wellfound uses `<a>` elements with CSS-module class and `href="/jobs/XXXXX-title"`. */
export const JOB_LINK_SELECTOR =
  /* Primary: CSS-module class from observed DOM */
  `a.styles_jobLink__US40J, ` +
  /* Fallback: any anchor with /jobs/ href inside listing list */
  `div[data-testid="job-listing-list"] a[href*="/jobs/"], ` +
  /* Broad fallback: anything that looks like a job link */
  `a[href^="/jobs/"]`

/** Selector for job title text within a card.
 *  Observed class: `span.styles_title__xpQDw`. */
export const JOB_TITLE_SELECTOR =
  /* Primary: CSS-module class from observed DOM */
  `span.styles_title__xpQDw, ` +
  /* Fallback: any heading-like element inside a card */
  `div[data-testid="job-listing-list"] span:first-child, ` +
  /* Broad fallback */
  `[class*="title"]`

/** Selector for compensation/salary text within a card.
 *  Observed class: `span.styles_compensation__3JnvU` (e.g. "$175k – $200k"). */
export const COMPENSATION_SELECTOR =
  /* Primary: CSS-module class from observed DOM */
  `span.styles_compensation__3JnvU, ` +
  /* Fallback: spans containing currency symbols */
  `span[class*="compensation"], ` +
  `span[class*="salary"]`

/** Selector for location text within a card.
 *  Observed class: `span.styles_location__O9Z62`. */
export const LOCATION_SELECTOR =
  /* Primary: CSS-module class from observed DOM */
  `span.styles_location__O9Z62, ` +
  /* Fallback */
  `span[class*="location"]`

/** Selector for the "Apply on Wellfound" badge on job cards.
 *  Observed class: `div.styles_badge__44SWu` containing SVG + "Apply on Wellfound" text.
 *  Presence indicates a native apply (vs external redirect). */
export const APPLY_ON_WELLFOUND_BADGE_SELECTOR =
  /* Primary: CSS-module class from observed DOM */
  `div.styles_badge__44SWu, ` +
  /* Fallback: container with badge text */
  `div[class*="badge"], ` +
  `[class*="badge"]:has(svg)`

/* ── Action button selectors ── */

/** Selector for the "Learn more" button on job cards.
 *  Observed test attribute: `button[data-test="LearnMoreButton"]`. */
export const LEARN_MORE_BUTTON_SELECTOR =
  /* Primary: data-test attribute from observed DOM */
  `button[data-test="LearnMoreButton"], ` +
  /* Fallback: button with matching text */
  `button[class*="learnMore"], ` +
  `button[class*="learn-more"]`

/** Selector for the "Apply" button inside the detail panel.
 *  Observed test attribute: `button[data-test="JobDescriptionSlideIn--SubmitButton"]`. */
export const DETAIL_APPLY_BUTTON_SELECTOR =
  /* Primary: data-test attribute from observed DOM */
  `button[data-test="JobDescriptionSlideIn--SubmitButton"], ` +
  /* Fallback: apply button within the detail panel modal */
  `div[data-test="DiscoverModal"] button[type="submit"], ` +
  `div[data-test="DiscoverModal"] button:has-text("Apply"), ` +
  /* Broad fallback */
  `button[class*="SubmitButton"]`

/** Selector for the mobile sticky footer "Apply" button.
 *  Observed: bottom fixed bar with `data-test="Button"` and text "Apply". */
export const MOBILE_APPLY_BUTTON_SELECTOR =
  /* Primary: data-test attribute */
  `button[data-test="Button"]:has-text("Apply"), ` +
  /* Fallback: fixed/sticky bottom bar */
  `[class*="fixed"] [class*="bottom"] button:has-text("Apply"), ` +
  `[class*="sticky"] [class*="bottom"] button:has-text("Apply")`

/* ── Detail panel & form selectors ── */

/** Selector for close/dismiss buttons inside the detail panel modal.
 *  Used to close an already-open modal before opening a new job's details. */
export const MODAL_CLOSE_BUTTON_SELECTOR =
  `button[aria-label*="Close"], ` +
  `button[aria-label*="Dismiss"], ` +
  `button[aria-label*="Back"], ` +
  `button[class*="close"], ` +
  `button[class*="dismiss"]`

/** Selector for the detail/apply panel container (slide-in modal on the same page).
 *  Observed test attribute: `div[data-test="DiscoverModal"]`.
 *  Left 3/5 = job details, right 2/5 = application form. */
export const DETAIL_PANEL_SELECTOR =
  /* Primary: data-test attribute from observed DOM */
  `div[data-test="DiscoverModal"], ` +
  /* Fallback: slide-in panel */
  `div[role="dialog"][class*="slide"], ` +
  `div[class*="modal"]:has(button[data-test="JobDescriptionSlideIn--SubmitButton"])`

/** Selector for the job detail content side (left 3/5) of the detail panel. */
export const DETAIL_CONTENT_SELECTOR =
  /* Primary: left side of split panel */
  `div[data-test="DiscoverModal"] > div:first-child, ` +
  `div[data-test="DiscoverModal"] div:not([class*="w-2/5"]):not([class*="lg:w-2/5"])`

/** Selector for the apply form side (right 2/5) of the detail panel.
 *  Observed class: `lg:w-2/5`. */
export const APPLY_FORM_SELECTOR =
  /* Primary: right side with responsive width class */
  `div[class*="lg:w-2/5"], ` +
  /* Fallback: second child of modal */
  `div[data-test="DiscoverModal"] > div:nth-child(2), ` +
  `div[data-test="DiscoverModal"] div:last-child`

/** Selector for textarea form fields in the apply form.
 *  Observed pattern: `textarea[name^="customQuestionAnswers["]`. */
export const FORM_TEXTAREA_SELECTOR =
  /* Primary: custom question textareas */
  `textarea[name^="customQuestionAnswers["], ` +
  /* Fallback: any visible textarea in the form */
  `div[data-test="DiscoverModal"] textarea, ` +
  `textarea`

/** Selector for all visible form input fields in the apply modal.
 *  Covers text inputs, textareas, and select dropdowns. */
export const FORM_INPUT_SELECTOR =
  `input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ` +
  `textarea, ` +
  `select`

/** Selector for the submit/send button within the apply form.
 *  Same as DETAIL_APPLY_BUTTON_SELECTOR — the "Apply" button submits the form. */
export const SUBMIT_BUTTON_SELECTOR = DETAIL_APPLY_BUTTON_SELECTOR

/* ── Detail panel close ── */

/** Selector for the backdrop/overlay element outside the detail panel.
 *  The DiscoverModal is relative positioned; clicking the overlay dismisses it. */
export const DETAIL_PANEL_OVERLAY_SELECTOR =
  /* Primary: CSS-module overlay/backdrop classes */
  `div[class*="overlay" i], ` +
  `div[class*="backdrop" i], ` +
  /* Fallback: presentation role or data-test attribute */
  `div[role="presentation"], ` +
  `div[data-test="Overlay"], ` +
  `[class*="Overlay"]`

/** Selector for the close/dismiss button inside the detail panel. */
export const DETAIL_PANEL_CLOSE_SELECTOR =
  /* Primary: aria-label based close/dismiss */
  `button[aria-label*="close" i], ` +
  `button[aria-label*="dismiss" i], ` +
  /* Fallback: class-based close/dismiss */
  `button[class*="close" i], ` +
  `button[class*="dismiss" i], ` +
  /* Fallback: data-test attribute */
  `[data-test*="close" i], ` +
  `[data-test*="dismiss" i], ` +
  `[data-test="CloseButton"], ` +
  /* Broad fallback: X-style button */
  `button[class*="x"]`

/* ── Login detection ── */

/** Selector for the user avatar/profile element indicating logged-in state.
 *  Wellfound shows a user avatar/icon in the top nav when logged in. */
export const USER_AVATAR_SELECTOR =
  `img[alt*="avatar"], ` +
  `img[alt*="profile"], ` +
  `[data-test="UserAvatar"], ` +
  `[class*="avatar"], ` +
  `[class*="user-menu"], ` +
  `nav a[href*="/profile"]`

/* ── Empty / no-results state ── */

/** Selector for empty-state indicators when no jobs match the current search. */
export const EMPTY_STATE_SELECTOR =
  `[data-test="NoResults"], ` +
  `[class*="no-results"], ` +
  `[class*="empty-state"]`

/* ── Submission & confirmation selectors ── */

/** Selector for the green success banner after a successful application.
 *  Observed: `div.bg-green-600` containing "Congrats! Your application has been submitted." */
export const SUCCESS_BANNER_SELECTOR = `div.bg-green-600`

/** Selector for a disabled button on a job card, indicating already-applied status.
 *  Observed: `button[disabled]` with text "Applied" or containing "✓". */
export const DISABLED_BUTTON_SELECTOR = `button[disabled]`

/** Selector for form elements with a required constraint.
 *  Covers HTML5 `required` attribute and ARIA `aria-required="true"`. */
export const REQUIRED_FIELD_SELECTOR =
  `input[required], textarea[required], select[required], ` +
  `[aria-required="true"]`

/** Selector for visible (non-hidden, non-submit, non-button) form fields
 *  in the right-side apply form area of the detail panel.
 *  Observed: the right 2/5 panel uses `lg:w-2/5`. */
export const FORM_FIELD_SELECTOR =
  `div[class*="lg:w-2/5"] input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ` +
  `div[class*="lg:w-2/5"] textarea, ` +
  `div[class*="lg:w-2/5"] select`

/* ── Navigation ── */

/** Wellfound jobs search page URL. */
export const WELLFOUND_JOBS_URL = "https://wellfound.com/jobs"


/* ── Application form defaults ── */

/** Default placeholder text for textarea fields on the Wellfound application form. */
export const DEFAULT_TEXTAREA_RESPONSE =
  "I am excited about this opportunity and believe my skills and experience align well with the role. I look forward to contributing to the team."

/** Number of milliseconds to wait for the user to start typing before timing out. */
export const TYPING_WAIT_TIMEOUT_MS = 20_000
