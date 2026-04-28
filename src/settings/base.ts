/**
 * Abstract base for all setting sections.
 *
 * Each section type (personal, eeo, global, search, filters, answers,
 * pipeline, additional) should extend this base to provide:
 *  - A type for its data fields
 *  - Default values
 *  - Abstract hooks that can later be implemented with real logic
 *
 * NOTE: All logic hooks are marked as NOT IMPLEMENTED — they are placeholders
 * for future wiring.
 */

export abstract class SettingsSection<T> {
  /** The raw data for this section */
  abstract readonly defaults: T

  /**
   * Validate current settings.
   * Return an array of error messages (empty = valid).
   * NOT IMPLEMENTED — override in subclass.
   */
  validate(data: T): string[] {
    // default: no validation
    return []
  }

  /**
   * Apply these settings to the page context.
   * Called when the pipeline runs.
   * NOT IMPLEMENTED — override in subclass.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async apply(_data: T): Promise<void> {
    // NO-OP: placeholder
  }

  /**
   * Reset section to defaults.
   * NOT IMPLEMENTED — override in subclass.
   */
  reset(): T {
    return { ...this.defaults }
  }
}
