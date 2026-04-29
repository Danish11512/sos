/** Result of a full filter-application pass */
export interface ApplyFiltersResult {
  success: boolean
  appliedCount: number
  errors: string[]
}
