export interface FloatingWidgetOptions {
  siteName: string
  badgeText?: string
  /** Called when the user toggles start/stop */
  onToggle?: (active: boolean) => void
  /** Current running state (controls button appearance) */
  initialState?: "idle" | "running" | "done"
}

export type WidgetState = "idle" | "running" | "done"
