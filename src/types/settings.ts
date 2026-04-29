/**
 * Re-exports from the modular settings/ directory.
 *
 * Each section lives in its own file under src/settings/ with:
 *  - An interface for its data
 *  - A defaults constant
 *  - An abstract class extending SettingsSection<T>
 *
 * The SettingsManager in settings/manager.ts stitches all sections together.
 */
export {
  SettingsManager,
  settingsManager,
  DEFAULT_APP_SETTINGS,
  DEFAULT_GLOBAL,
  DEFAULT_SITE,
} from "../settings/manager"

export type {
  AppSettings,
  GlobalSettings,
  SiteSettings,
  ValidationEntry,
} from "../settings/manager"

export { areSiteSettingsReady } from "../settings/manager"
