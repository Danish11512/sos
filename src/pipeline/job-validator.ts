/**
 * Job Validator — pure functions that evaluate whether a scraped job listing
 * passes all user-defined filters and criteria.
 *
 * Architecture:
 *   Each check is an isolated pure function (input -> boolean).
 *   The main `validateJobForApplication()` composes them with `&&`.
 *
 * Usage:
 *   import { validateJobForApplication } from "./job-validator"
 *   const ready = validateJobForApplication(jobData, siteSettings.filters)
 *   if (ready) console.log("[SOS] Job ready to apply")
 */

import type { FilterSettings } from "../settings/sections"

/* ---- Regex helpers ---- */

/**
 * Extract the maximum years of experience required from a job description.
 * Handles patterns like:
 *   - "3+ years", "5 years"
 *   - "3-5 years"
 *   - "10+ years of experience"
 *   - "2 to 4 years"
 *   - "(5) years"
 *
 * Returns 0 if no pattern matches (meaning no explicit requirement found).
 */
export function extractYearsOfExperience(description: string): number {
  const re = /[(]?\s*(\d+)\s*[)]?\s*[-to]*\s*\d*[+]*\s*year[s]?/gi
  const matches: number[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(description)) !== null) {
    const val = parseInt(match[1], 10)
    // Filter out unreasonably high values (>12) - they're likely not
    // actual experience requirements (e.g. "100 years" in "100 years of history")
    if (!isNaN(val) && val <= 12) {
      matches.push(val)
    }
  }
  return matches.length > 0 ? Math.max(...matches) : 0
}

/* ---- Individual filter checks (each returns boolean) ---- */

/**
 * Check if a company name contains a "bad word" from the user's block list,
 * respecting the "good word" exception list.
 *
 * Returns `true` if the company passes (no bad words found, or it's an exception).
 * Returns `false` if the company should be filtered out.
 */
export function checkCompanyBadWords(
  company: string,
  aboutCompanyBadWords: string[],
  aboutCompanyGoodWords: string[]
): boolean {
  if (!aboutCompanyBadWords || aboutCompanyBadWords.length === 0) return true

  const companyLower = company.toLowerCase()
  const badWords = aboutCompanyBadWords
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
  const goodExceptions = aboutCompanyGoodWords
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)

  // Check if any exception applies first
  if (goodExceptions.length > 0) {
    const hasException = goodExceptions.some((ex) => companyLower.includes(ex))
    if (hasException) return true
  }

  // Check for bad words
  const hasBadWord = badWords.some((w) => companyLower.includes(w))
  return !hasBadWord
}

/**
 * Check if a job title contains any bad words.
 * Returns `true` if the title passes, `false` if filtered out.
 */
export function checkTitleBadWords(
  title: string,
  badWords: string[]
): boolean {
  if (!badWords || badWords.length === 0) return true

  const titleLower = title.toLowerCase()
  const words = badWords.map((w) => w.trim().toLowerCase()).filter(Boolean)

  const hasBadWord = words.some((w) => titleLower.includes(w))
  return !hasBadWord
}

/**
 * Check if a job description contains any bad words.
 * Returns `true` if the description passes, `false` if filtered out.
 */
export function checkDescriptionBadWords(
  description: string,
  badWords: string[]
): boolean {
  if (!badWords || badWords.length === 0) return true

  const descLower = description.toLowerCase()
  const words = badWords.map((w) => w.trim().toLowerCase()).filter(Boolean)

  const hasBadWord = words.some((w) => descLower.includes(w))
  return !hasBadWord
}

/**
 * Check if a job mentions security clearance requirements that the user
 * does not have.
 *
 * If `hasClearance` is `true`, all jobs pass.
 * If `hasClearance` is `false`, jobs mentioning "clearance", "polygraph",
 * or "secret" (in the context of security) are filtered out.
 *
 * Returns `true` if the job passes the security check.
 */
export function checkSecurityClearance(
  description: string,
  hasClearance: boolean
): boolean {
  if (hasClearance) return true

  const descLower = description.toLowerCase()

  // Keywords that strongly suggest a security clearance requirement
  const clearanceKeywords = ["polygraph", "clearance", "secret"]

  return !clearanceKeywords.some((keyword) => descLower.includes(keyword))
}

/**
 * Check if the user meets the experience requirement extracted from the
 * job description.
 *
 * - If `currentExperience` is -1 (unset), all experience levels pass.
 * - If the user has a master's degree (`didMasters`), the effective
 *   experience threshold is increased by 2 years.
 * - Returns `true` if the user meets the requirement (or no requirement
 *   could be extracted).
 */
export function checkExperienceRequirement(
  description: string,
  currentExperience: number,
  didMasters: boolean
): boolean {
  // -1 means "don't check experience"
  if (currentExperience < 0) return true

  const required = extractYearsOfExperience(description)

  // If no explicit requirement could be extracted, let it pass
  if (required === 0) return true

  // Master's degree boosts effective experience by 2 years
  const mastersBoost = didMasters && description.toLowerCase().includes("master") ? 2 : 0
  const effectiveExperience = currentExperience + mastersBoost

  return effectiveExperience >= required
}

/* ---- Composer ---- */

/**
 * Validate a scraped job listing against ALL user-defined filter criteria.
 *
 * @param company        - Company name from the job listing
 * @param title          - Job title from the listing
 * @param description    - Full job description text
 * @param filters        - User's FilterSettings from the extension config
 *
 * @returns `true` if the job passes ALL filters and is ready to apply to,
 *          `false` if any filter rejects it.
 */
export function validateJobForApplication(
  company: string,
  title: string,
  description: string,
  filters: FilterSettings
): boolean {
  return (
    checkCompanyBadWords(company, filters.aboutCompanyBadWords, filters.aboutCompanyGoodWords) &&
    checkTitleBadWords(title, filters.badWords) &&
    checkDescriptionBadWords(description, filters.badWords) &&
    checkSecurityClearance(description, filters.securityClearance) &&
    checkExperienceRequirement(description, filters.currentExperience, filters.didMasters)
  )
}
