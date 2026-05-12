/**
 * Job Validator - pure functions that evaluate whether a scraped job listing
 * passes all user-defined filters and criteria.
 *
 * Architecture:
 *   Each check is an isolated pure function (input -> boolean).
 *   The main `validateJobForApplication()` composes them with `&&`.
 */

import type { FilterSettings } from "../settings/sections"

/* ---- Helpers ---- */

/**
 * Cache for compiled word-boundary regex patterns.
 * Avoids rebuilding the same RegExp on repeated checks against the same word.
 */
const _wordBoundaryCache = new Map<string, RegExp>()

/**
 * Check if text contains a word using word-boundary matching.
 * Prevents false positives like "man" matching "Manager".
 * Uses a cache to avoid re-compiling the same regex pattern.
 */
function hasWordBoundary(text: string, word: string): boolean {
  let re = _wordBoundaryCache.get(word)
  if (!re) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    re = new RegExp("\\b" + escaped + "\\b", "i")
    _wordBoundaryCache.set(word, re)
  }
  return re.test(text)
}

/**
 * Check if text contains any word from a list using word-boundary matching.
 */
function hasAnyWordBoundary(text: string, words: string[]): boolean {
  return words.some((w) => hasWordBoundary(text, w))
}

/* ---- Regex helpers ---- */

export function extractYearsOfExperience(description: string): number {
  const matches: number[] = []
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
  const singleRe = /[(]?\s*(\d+)\s*[)]?\s*[+]*\s*year[s]?/gi
  let singleMatch: RegExpExecArray | null
  while ((singleMatch = singleRe.exec(description)) !== null) {
    const val = parseInt(singleMatch[1], 10)
    if (!isNaN(val) && val <= 12) {
      matches.push(val)
    }
  }
  return matches.length > 0 ? Math.max(...matches) : 0
}

/* ---- Individual filter checks ---- */

export function checkCompanyBadWords(
  company: string,
  aboutCompanyBadWords: string[],
  aboutCompanyGoodWords: string[]
): boolean {
  if (!aboutCompanyBadWords || aboutCompanyBadWords.length === 0) return true
  const companyLower = company.toLowerCase()
  const badWords = aboutCompanyBadWords.map((w) => w.trim().toLowerCase()).filter(Boolean)
  const goodExceptions = aboutCompanyGoodWords.map((w) => w.trim().toLowerCase()).filter(Boolean)
  if (!companyLower) {
    console.warn("[SOS] JobValidator: Empty company name passing through (configurable)")
    return true
  }
  const hasBadWord = hasAnyWordBoundary(companyLower, badWords)
  if (!hasBadWord) return true
  if (goodExceptions.length > 0) {
    const hasException = hasAnyWordBoundary(companyLower, goodExceptions)
    if (hasException) return true
  }
  return false
}

export function checkTitleBadWords(title: string, badWords: string[]): boolean {
  if (!badWords || badWords.length === 0) return true
  const titleLower = title.toLowerCase()
  const words = badWords.map((w) => w.trim().toLowerCase()).filter(Boolean)
  return !hasAnyWordBoundary(titleLower, words)
}

export function checkDescriptionBadWords(description: string, badWords: string[]): boolean {
  if (!badWords || badWords.length === 0) return true
  const descLower = description.toLowerCase()
  const words = badWords.map((w) => w.trim().toLowerCase()).filter(Boolean)
  return !hasAnyWordBoundary(descLower, words)
}

export function checkSecurityClearance(description: string, hasClearance: boolean): boolean {
  if (hasClearance) return true
  const descLower = description.toLowerCase()
  const clearanceKeywords = ["polygraph", "clearance", "secret"]
  const hasSecret = hasWordBoundary(descLower, "secret")
  if (hasSecret) {
    const secretIdx = descLower.indexOf("secret")
    const nearClearance = descLower.indexOf("clearance", Math.max(0, secretIdx - 50)) !== -1 &&
      descLower.indexOf("clearance", secretIdx) <= secretIdx + 50
    const nearSecurity = descLower.indexOf("security", Math.max(0, secretIdx - 50)) !== -1 &&
      descLower.indexOf("security", secretIdx) <= secretIdx + 50
    if (!nearClearance && !nearSecurity) {
      const filteredKeywords = clearanceKeywords.filter((k) => k !== "secret")
      return !hasAnyWordBoundary(descLower, filteredKeywords)
    }
  }
  return !hasAnyWordBoundary(descLower, clearanceKeywords)
}

export function checkExperienceRequirement(
  description: string,
  currentExperience: number,
  didMasters: boolean
): boolean {
  if (currentExperience < 0) return true
  const required = extractYearsOfExperience(description)
  if (required === 0) return true
  const mastersBoost = didMasters && description.toLowerCase().includes("master") ? 2 : 0
  return (currentExperience + mastersBoost) >= required
}

export function checkCompanyList(company: string, companies: string[]): boolean {
  if (!companies || companies.length === 0) return true
  const companyLower = company.toLowerCase().trim()
  const list = companies.map((c) => c.trim().toLowerCase()).filter(Boolean)
  if (!companyLower) return true
  return list.some((c) => companyLower.includes(c) || c.includes(companyLower))
}

export function extractSalary(description: string): number {
  const descLower = description.toLowerCase()
  const rangeYearRe = /\$(\d{1,3}(?:,\d{3})?)\s*[-to]+\s*\$(\d{1,3}(?:,\d{3})?)\s*(?:per\s+year|annually|annual|per\s+annum|\/year|\/yr)/gi
  const rangeKRe = /\$(\d+)\s*k\s*[-to]+\s*\$(\d+)\s*k/gi
  const singleYearRe = /\$(\d{1,3}(?:,\d{3})?)\s*(?:per\s+year|annually|annual|per\s+annum|\/year|\/yr)/gi
  const singleKRe = /\$(\d+)\s*k/gi
  let maxSalary = 0
  function processMatch(match: RegExpExecArray): void {
    const src = match[2] || match[1]
    const val = parseFloat(src.replace(/,/g, ""))
    if (!isNaN(val)) maxSalary = Math.max(maxSalary, val)
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
