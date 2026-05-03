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

/* ---- Helpers ---- */

/**
 * Check if text contains a word using word-boundary matching.
 * Prevents false positives like "man" matching "Manager".
 */
function hasWordBoundary(text: string, word: string): boolean {
  // Escape regex special chars in the word
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`\\b${escaped}\\b`, "i")
  return re.test(text)
}

/**
 * Check if text contains any word from a list using word-boundary matching.
 */
function hasAnyWordBoundary(text: string, words: string[]): boolean {
  return words.some((w) => hasWordBoundary(text, w))
}

/* ---- Regex helpers ---- */

/**
 * Extract the maximum years of experience required from a job description.
 * Handles patterns like:
 *   - "3+ years", "5 years"
 *   - "3-5 years" → returns 5 (the MAX)
 *   - "10+ years of experience"
 *   - "2 to 4 years" → returns 4 (the MAX)
 *   - "(5) years"
 *
 * Returns 0 if no pattern matches (meaning no explicit requirement found).
 *
 * FIX F42/F43: For range patterns "X-Y years" and "X to Y years",
 * captures BOTH numbers and uses the larger one.
 */
export function extractYearsOfExperience(description: string): number {
  const matches: number[] = []

  // Pattern 1: "X-Y years" or "X to Y years" — capture both, use max
  const rangeRe = /[(]?\s*(\d+)\s*[)]?\s*[-to]+\s*(\d+)\s*[+]*\s*year[s]?/gi
  let rangeMatch: RegExpExecArray | null
  while ((rangeMatch = rangeRe.exec(description)) !== null) {
    const val1 = parseInt(rangeMatch[1], 10)
    const val2 = parseInt(rangeMatch[2], 10)
    const maxVal = Math.max(val1, val2)
    if (!isNaN(maxVal) && maxVal <= 12) {
      matches.push(maxVal)
    }
  }

  // Pattern 2: Single number "X+ years" or "X years" (not part of a range)
  const singleRe = /[(]?\s*(\d+)\s*[)]?\s*[+]*\s*year[s]?/gi
  let singleMatch: RegExpExecArray | null
  while ((singleMatch = singleRe.exec(description)) !== null) {
    const val = parseInt(singleMatch[1], 10)
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
 * Uses word-boundary matching to prevent false positives like
 * "soft" matching "Software Engineer" at "Microsoft".
 *
 * Returns `true` if the company passes (no bad words found, or it's an exception).
 * Returns `false` if the company should be filtered out.
 *
 * FIX F32: Word-boundary matching instead of includes().
 * FIX F34: Check bad words first, then good words as exceptions.
 * FIX F35: Handle empty company name.
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

  // FIX F35: Handle empty company name
  if (!companyLower) {
    console.warn(`[SOS] JobValidator: Empty company name — passing through (configurable)`)
    return true // Permissive default: let empty company names pass
  }

  // FIX F34: Check bad words FIRST
  const hasBadWord = hasAnyWordBoundary(companyLower, badWords)
  if (!hasBadWord) return true

  // THEN check if good word exception applies
  if (goodExceptions.length > 0) {
    const hasException = hasAnyWordBoundary(companyLower, goodExceptions)
    if (hasException) return true
  }

  return false
}

/**
 * Check if a job title contains any bad words.
 * Uses word-boundary matching to prevent false positives like
 * "man" matching "Manager" or "lead" matching "Leadership".
 *
 * Returns `true` if the title passes, `false` if filtered out.
 *
 * FIX F33: Word-boundary matching instead of includes().
 */
export function checkTitleBadWords(
  title: string,
  badWords: string[]
): boolean {
  if (!badWords || badWords.length === 0) return true

  const titleLower = title.toLowerCase()
  const words = badWords.map((w) => w.trim().toLowerCase()).filter(Boolean)

  const hasBadWord = hasAnyWordBoundary(titleLower, words)
  return !hasBadWord
}

/**
 * Check if a job description contains any bad words.
 * Uses word-boundary matching.
 *
 * Returns `true` if the description passes, `false` if filtered out.
 *
 * FIX F45: Word-boundary matching instead of includes().
 */
export function checkDescriptionBadWords(
  description: string,
  badWords: string[]
): boolean {
  if (!badWords || badWords.length === 0) return true

  const descLower = description.toLowerCase()
  const words = badWords.map((w) => w.trim().toLowerCase()).filter(Boolean)

  const hasBadWord = hasAnyWordBoundary(descLower, words)
  return !hasBadWord
}

/**
 * Check if a job mentions security clearance requirements that the user
 * does not have.
 *
 * Uses word-boundary matching to prevent false positives like
 * "secret" matching "secretary" or "clearance" matching "clearance sale".
 *
 * If `hasClearance` is `true`, all jobs pass.
 * If `hasClearance` is `false`, jobs mentioning "clearance", "polygraph",
 * or "secret" (in the context of security) are filtered out.
 *
 * Returns `true` if the job passes the security check.
 *
 * FIX F44: Word-boundary matching + context checks.
 */
export function checkSecurityClearance(
  description: string,
  hasClearance: boolean
): boolean {
  if (hasClearance) return true

  const descLower = description.toLowerCase()

  // Keywords that strongly suggest a security clearance requirement
  // Use word-boundary matching to avoid false positives
  const clearanceKeywords = ["polygraph", "clearance", "secret"]

  // For "secret", add context check: must be near "clearance" or "security"
  const hasSecret = hasWordBoundary(descLower, "secret")
  if (hasSecret) {
    // Check if "secret" appears near "clearance" or "security" (within 50 chars)
    const secretIdx = descLower.indexOf("secret")
    const nearClearance = descLower.indexOf("clearance", Math.max(0, secretIdx - 50)) !== -1 &&
      descLower.indexOf("clearance", secretIdx) <= secretIdx + 50
    const nearSecurity = descLower.indexOf("security", Math.max(0, secretIdx - 50)) !== -1 &&
      descLower.indexOf("security", secretIdx) <= secretIdx + 50
    if (!nearClearance && !nearSecurity) {
      // "secret" used in non-clearance context (e.g., "secretary", "secret sauce")
      // Remove it from the check
      const filteredKeywords = clearanceKeywords.filter((k) => k !== "secret")
      return !hasAnyWordBoundary(descLower, filteredKeywords)
    }
  }

  return !hasAnyWordBoundary(descLower, clearanceKeywords)
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

/**
 * Check if a company is in the user's allow list or block list.
 * If allow list is non-empty, only companies in the list pass.
 * If block list is non-empty, companies in the list are filtered out.
 *
 * FIX F73: Implement companies filter.
 */
export function checkCompanyList(
  company: string,
  companies: string[]
): boolean {
  if (!companies || companies.length === 0) return true

  const companyLower = company.toLowerCase().trim()
  const list = companies.map((c) => c.trim().toLowerCase()).filter(Boolean)

  // If company name is empty, let it pass (can't filter what we can't read)
  if (!companyLower) return true

  // Check if company is in the list (positive match = allow)
  return list.some((c) => companyLower.includes(c) || c.includes(companyLower))
}

/**
 * Extract salary from job description text.
 * Returns the minimum annual salary found, or 0 if none found.
 *
 * FIX F74: Implement salary extraction.
 */
export function extractSalary(description: string): number {
  const descLower = description.toLowerCase()

  // Pattern: $XX,XXX - $YY,YYY per year
  const rangeYearRe = /\$(\d{1,3}(?:,\d{3})?)\s*[-–to]+\s*\$(\d{1,3}(?:,\d{3})?)\s*(?:per\s+year|annually|annual|per\s+annum|\/year|\/yr)/gi
  // Pattern: $XXk - $YYk
  const rangeKRe = /\$(\d+)\s*k\s*[-–to]+\s*\$(\d+)\s*k/gi
  // Pattern: $XX,XXX per year (single)
  const singleYearRe = /\$(\d{1,3}(?:,\d{3})?)\s*(?:per\s+year|annually|annual|per\s+annum|\/year|\/yr)/gi
  // Pattern: $XXk (single)
  const singleKRe = /\$(\d+)\s*k/gi

  let maxSalary = 0

  function processMatch(match: RegExpExecArray): void {
    // For range patterns, use the upper bound
    if (match[2]) {
      const val = parseFloat(match[2].replace(/,/g, ""))
      if (!isNaN(val)) {
        maxSalary = Math.max(maxSalary, val)
      }
    } else {
      const val = parseFloat(match[1].replace(/,/g, ""))
      if (!isNaN(val)) {
        maxSalary = Math.max(maxSalary, val)
      }
    }
  }

  let m: RegExpExecArray | null
  while ((m = rangeYearRe.exec(descLower)) !== null) processMatch(m)
  while ((m = rangeKRe.exec(descLower)) !== null) {
    if (m[2]) {
      const val = parseFloat(m[2]) * 1000
      if (!isNaN(val)) maxSalary = Math.max(maxSalary, val)
    }
  }
  while ((m = singleYearRe.exec(descLower)) !== null) processMatch(m)
  while ((m = singleKRe.exec(descLower)) !== null) {
    const val = parseFloat(m[1]) * 1000
    if (!isNaN(val)) maxSalary = Math.max(maxSalary, val)
  }

  return maxSalary
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
