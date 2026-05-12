export interface SitePreset {
  id: string
  name: string
  urlPattern: string
  searchResultPatterns: string[]
  requiresSearchQuery?: boolean
}
