/**
 * EEO / Diversity section.
 * Shared across all sites (global).
 * UI only — logic NOT IMPLEMENTED.
 */
import { SettingsSection } from "./base"

export interface EeoSettings {
  ethnicity: string
  gender: string
  disabilityStatus: string
  veteranStatus: string
}

export const DEFAULT_EEO: EeoSettings = {
  ethnicity: "Decline",
  gender: "Decline",
  disabilityStatus: "Decline",
  veteranStatus: "Decline",
}

export class EeoSection extends SettingsSection<EeoSettings> {
  readonly defaults = DEFAULT_EEO
}
