/**
 * Global Behavior section.
 * Shared across all sites (global).
 * UI only — logic NOT IMPLEMENTED.
 */
import { SettingsSection } from "./base"

export interface GlobalBehaviorSettings {
  clickGap: number
  smoothScroll: boolean
  keepScreenAwake: boolean
  stealthMode: boolean
}

export const DEFAULT_GLOBAL_BEHAVIOR: GlobalBehaviorSettings = {
  clickGap: 1,
  smoothScroll: false,
  keepScreenAwake: true,
  stealthMode: true,
}

export class GlobalBehaviorSection extends SettingsSection<GlobalBehaviorSettings> {
  readonly defaults = DEFAULT_GLOBAL_BEHAVIOR
}
