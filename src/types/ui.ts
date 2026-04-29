export type WidgetState = "idle" | "ready" | "running" | "done"

export interface FloatingWidgetOptions {
  siteName: string
  siteId: string
  badgeText?: string
  /** Called when the user toggles start/stop */
  onToggle?: (active: boolean) => void
  /** Current running state (controls button appearance) */
  initialState?: WidgetState
}
