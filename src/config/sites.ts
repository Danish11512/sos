import type { SitePreset } from "../types/site"

export const sitePresets: SitePreset[] = [
  {
    id: "linkedin",
    name: "LinkedIn",
    urlPattern: "linkedin.com",
    searchResultPatterns: ["/jobs/search/", "/jobs/search-results/"],
  },
  {
    id: "indeed",
    name: "Indeed",
    urlPattern: "indeed.com",
    searchResultPatterns: ["/jobs"],
    requiresSearchQuery: true,
  },
  {
    id: "wellfound",
    name: "Wellfound",
    urlPattern: "wellfound.com",
    searchResultPatterns: ["/jobs"],
  },
]
