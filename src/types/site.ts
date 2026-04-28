export interface JobFieldSelectors {
  applyButton: string
  submitButton: string
  inputFields: Record<string, string>
  reviewSection: string
  errorMessage: string
  successIndicator: string
}

export interface ApplyStep {
  name: string
  action: "click" | "fill" | "wait" | "scroll" | "review"
  target?: string
  value?: string
  timeout?: number
}

export interface SitePreset {
  id: string
  name: string
  urlPattern: string
  selectors: JobFieldSelectors
  steps: ApplyStep[]
}

export interface SiteConfig {
  presets: SitePreset[]
}
