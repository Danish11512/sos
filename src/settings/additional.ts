/**
 * Additional section.
 * Per-site.
 * UI only — logic NOT IMPLEMENTED.
 */
import { SettingsSection } from "./base"

export interface AdditionalSettings {
  autoFillScreeningQuestions: boolean
  customAnswers: Record<string, string>

  /** Resume data stored as base64 data URL */
  resumeData: string
  /** Original filename for display */
  resumeFileName: string
}

export const DEFAULT_ADDITIONAL: AdditionalSettings = {
  autoFillScreeningQuestions: true,
  customAnswers: {},
  resumeData: "",
  resumeFileName: "",
}

export class AdditionalSection extends SettingsSection<AdditionalSettings> {
  readonly defaults = DEFAULT_ADDITIONAL
}
