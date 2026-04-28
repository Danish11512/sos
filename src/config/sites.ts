import type { SitePreset } from "../types/site"

// Placeholder presets — selectors will be populated per site during feature work
export const sitePresets: SitePreset[] = [
  {
    id: "linkedin",
    name: "LinkedIn",
    urlPattern: "linkedin.com",
    selectors: {
      applyButton: "",
      submitButton: "",
      inputFields: {},
      reviewSection: "",
      errorMessage: "",
      successIndicator: "",
    },
    steps: [],
  },
  {
    id: "wellfound",
    name: "Wellfound",
    urlPattern: "wellfound.com",
    selectors: {
      applyButton: "",
      submitButton: "",
      inputFields: {},
      reviewSection: "",
      errorMessage: "",
      successIndicator: "",
    },
    steps: [],
  },
]
