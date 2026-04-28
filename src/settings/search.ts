/**
 * Search preferences section.
 * Per-site.
 * UI only — logic NOT IMPLEMENTED.
 */
import { SettingsSection } from "./base"

export interface SearchSettings {
  searchTerms: string[]
  searchLocation: string
  switchNumber: number
  randomizeSearchOrder: boolean
}

export const DEFAULT_SEARCH: SearchSettings = {
  searchTerms: [],
  searchLocation: "",
  switchNumber: 30,
  randomizeSearchOrder: false,
}

export class SearchSection extends SettingsSection<SearchSettings> {
  readonly defaults = DEFAULT_SEARCH

  /** Require at least one search term */
  override validate(data: SearchSettings): string[] {
    const errors: string[] = []
    if (data.searchTerms.length === 0) errors.push("At least one search term is required")
    return errors
  }
}
