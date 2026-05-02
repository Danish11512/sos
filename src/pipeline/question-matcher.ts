/**
 * Keyword/regex matching logic for Easy Apply questions.
 * Maps question labels to user-provided answer values from settings.
 */

import type { AnswerSettings, PersonalSettings, EeoSettings } from "../settings/sections"

/** Context available for answering questions. */
export interface AnswerContext {
  personal: PersonalSettings
  answers: AnswerSettings
  eeo: EeoSettings
  customAnswers: Record<string, string>
}

/**
 * A keyword pattern → answer resolver.
 * Each entry maps a set of label keywords to a function that returns the answer.
 */
interface KeywordEntry {
  keywords: string[]
  resolve: (ctx: AnswerContext) => string
}

/**
 * Ordered list of keyword matchers.
 * First match wins — more specific patterns should come before generic ones.
 */
const KEYWORD_MATCHERS: KeywordEntry[] = [
  // ── Personal Info ──
  {
    keywords: ["first name", "firstname", "given name"],
    resolve: (ctx) => ctx.personal.firstName,
  },
  {
    keywords: ["last name", "lastname", "surname", "family name"],
    resolve: (ctx) => ctx.personal.lastName,
  },
  {
    keywords: ["phone", "mobile", "cell", "telephone", "contact number"],
    resolve: (ctx) => ctx.personal.phoneNumber,
  },
  {
    keywords: ["email", "e-mail", "email address"],
    resolve: (ctx) => "", // LinkedIn already has email — leave blank to skip
  },
  {
    keywords: ["city", "current city", "location"],
    resolve: (ctx) => ctx.personal.currentCity,
  },
  {
    keywords: ["street", "address", "street address"],
    resolve: (ctx) => ctx.personal.street,
  },
  {
    keywords: ["state", "province", "region"],
    resolve: (ctx) => ctx.personal.state,
  },
  {
    keywords: ["zip", "zip code", "postal", "postcode", "postal code"],
    resolve: (ctx) => ctx.personal.zipcode,
  },
  {
    keywords: ["country"],
    resolve: (ctx) => ctx.personal.country,
  },

  // ── Experience & Qualifications ──
  {
    keywords: ["years of experience", "years experience", "experience years", "total experience"],
    resolve: (ctx) => ctx.answers.yearsOfExperience,
  },
  {
    keywords: ["experience", "work experience"],
    resolve: (ctx) => ctx.answers.yearsOfExperience,
  },

  // ── Visa / Sponsorship ──
  {
    keywords: ["visa", "sponsorship", "work authorization", "work authorisation", "legally authorized", "legally entitled", "right to work"],
    resolve: (ctx) => ctx.answers.requireVisa,
  },

  // ── Citizenship ──
  {
    keywords: ["citizen", "citizenship", "employment eligibility", "eligible to work", "us person", "us citizen"],
    resolve: (ctx) => ctx.answers.usCitizenship,
  },

  // ── Salary / Compensation ──
  {
    keywords: ["salary", "compensation", "ctc", "expected salary", "desired salary", "pay expectation"],
    resolve: (ctx) => String(ctx.answers.desiredSalary),
  },
  {
    keywords: ["current ctc", "current salary", "current compensation"],
    resolve: (ctx) => String(ctx.answers.currentCtc),
  },
  {
    keywords: ["notice period", "notice"],
    resolve: (ctx) => String(ctx.answers.noticePeriod),
  },

  // ── LinkedIn / Online ──
  {
    keywords: ["linkedin", "linkedin url", "linkedin profile"],
    resolve: (ctx) => ctx.answers.linkedIn,
  },
  {
    keywords: ["website", "portfolio", "personal website"],
    resolve: (ctx) => ctx.answers.website,
  },

  // ── Headline / Summary ──
  {
    keywords: ["headline", "professional headline", "title"],
    resolve: (ctx) => ctx.answers.linkedinHeadline,
  },
  {
    keywords: ["summary", "professional summary", "about", "bio"],
    resolve: (ctx) => ctx.answers.linkedinSummary,
  },

  // ── Cover Letter ──
  {
    keywords: ["cover letter", "coverletter", "cover letter text"],
    resolve: (ctx) => ctx.answers.coverLetter,
  },

  // ── Recent Employer ──
  {
    keywords: ["recent employer", "current employer", "most recent employer", "last employer"],
    resolve: (ctx) => ctx.answers.recentEmployer,
  },

  // ── EEO / Diversity ──
  {
    keywords: ["ethnicity", "race", "ethnic"],
    resolve: (ctx) => ctx.eeo.ethnicity,
  },
  {
    keywords: ["gender", "sex"],
    resolve: (ctx) => ctx.eeo.gender,
  },
  {
    keywords: ["disability", "disabled", "disability status"],
    resolve: (ctx) => ctx.eeo.disabilityStatus,
  },
  {
    keywords: ["veteran", "veteran status", "military service"],
    resolve: (ctx) => ctx.eeo.veteranStatus,
  },

  // ── Security Clearance ──
  {
    keywords: ["security clearance", "clearance"],
    resolve: (ctx) => ctx.answers.confidenceLevel, // reuse confidenceLevel as fallback
  },

  // ── Education ──
  {
    keywords: ["masters", "master's", "master degree", "graduate degree"],
    resolve: () => "No", // default — user can override via customAnswers
  },
  {
    keywords: ["bachelor", "bachelor's", "bachelor degree", "undergraduate"],
    resolve: () => "Yes",
  },
]

/**
 * Match a question label to an answer value from the user's settings.
 * Returns the answer string, or empty string if no match found.
 */
export function matchQuestionToAnswer(
  label: string,
  ctx: AnswerContext
): string {
  const lowerLabel = label.toLowerCase().trim()

  // 1. Check custom answers first (user-defined overrides)
  for (const [pattern, answer] of Object.entries(ctx.customAnswers)) {
    if (lowerLabel.includes(pattern.toLowerCase())) {
      return answer
    }
  }

  // 2. Check keyword matchers
  for (const entry of KEYWORD_MATCHERS) {
    for (const keyword of entry.keywords) {
      if (lowerLabel.includes(keyword)) {
        return entry.resolve(ctx)
      }
    }
  }

  return ""
}

/**
 * Find the best matching option from a list of <option> or label texts.
 * Uses fuzzy matching (case-insensitive substring).
 */
export function findBestOption(
  options: string[],
  answer: string
): string | null {
  if (!answer) return null

  const lowerAnswer = answer.toLowerCase().trim()

  // Exact match first
  for (const opt of options) {
    if (opt.toLowerCase().trim() === lowerAnswer) return opt
  }

  // Substring match
  for (const opt of options) {
    if (opt.toLowerCase().includes(lowerAnswer) || lowerAnswer.includes(opt.toLowerCase())) {
      return opt
    }
  }

  // For yes/no questions, try common variants
  if (lowerAnswer === "yes" || lowerAnswer === "true" || lowerAnswer === "y") {
    for (const opt of options) {
      const lo = opt.toLowerCase()
      if (lo === "yes" || lo === "true" || lo === "y" || lo.includes("yes")) return opt
    }
  }
  if (lowerAnswer === "no" || lowerAnswer === "false" || lowerAnswer === "n") {
    for (const opt of options) {
      const lo = opt.toLowerCase()
      if (lo === "no" || lo === "false" || lo === "n" || lo.includes("no")) return opt
    }
  }

  return null
}

/**
 * Classify a form element's question type.
 */
export type QuestionType = "select" | "radio" | "text" | "textarea" | "checkbox" | "unknown"

export function classifyQuestion(element: Element): QuestionType {
  const tag = element.tagName.toLowerCase()

  if (tag === "select") return "select"

  if (tag === "textarea") return "textarea"

  if (tag === "input") {
    const input = element as HTMLInputElement
    const type = (input.type || "text").toLowerCase()
    if (type === "radio") return "radio"
    if (type === "checkbox") return "checkbox"
    if (type === "text" || type === "email" || type === "tel" || type === "number" || type === "url") {
      return "text"
    }
    return "text"
  }

  if (tag === "input") return "text"

  return "unknown"
}

/**
 * Extract the visible label text associated with a form element.
 * Looks at:
 *   1. The element's aria-label attribute
 *   2. A preceding <label> element (via `for` attribute)
 *   3. A parent <label> that wraps the element
 *   4. aria-labelledby reference
 *   5. The closest preceding sibling text / heading
 *   6. Placeholder attribute
 */
export function extractLabel(element: Element): string {
  const el = element as HTMLElement

  // 1. aria-label
  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel?.trim()) return ariaLabel.trim()

  // 2. aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby")
  if (labelledBy) {
    const ref = document.getElementById(labelledBy)
    if (ref?.textContent?.trim()) return ref.textContent.trim()
  }

  // 3. Associated <label> via `for` attribute
  if (el.id) {
    const label = document.querySelector(`label[for="${el.id}"]`)
    if (label?.textContent?.trim()) return label.textContent.trim()
  }

  // 4. Parent <label> that wraps the element
  const parentLabel = el.closest("label")
  if (parentLabel?.textContent?.trim()) {
    // Remove the element's own value from the label text
    const labelText = parentLabel.textContent.trim()
    const inputVal = (el as HTMLInputElement).value?.trim()
    if (inputVal && labelText.includes(inputVal)) {
      return labelText.replace(inputVal, "").trim()
    }
    return labelText
  }

  // 5. Placeholder
  const placeholder = el.getAttribute("placeholder")
  if (placeholder?.trim()) return placeholder.trim()

  // 6. Closest preceding sibling with text (heuristic)
  let prev = el.previousElementSibling
  while (prev) {
    const text = prev.textContent?.trim()
    if (text && text.length > 0 && text.length < 200) {
      return text
    }
    prev = prev.previousElementSibling
  }

  // 7. Look up the fieldset/group heading for radio/checkbox groups
  const fieldset = el.closest("fieldset")
  if (fieldset) {
    const legend = fieldset.querySelector("legend")
    if (legend?.textContent?.trim()) return legend.textContent.trim()
  }

  return ""
}
