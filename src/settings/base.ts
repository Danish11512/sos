/**
 * Abstract base for setting sections.
 * Subclasses provide the data shape + defaults + optional validation.
 */
export abstract class SettingsSection<T> {
  abstract readonly defaults: T

  validate(_data: T): string[] {
    return []
  }

  reset(): T {
    return { ...this.defaults }
  }
}
