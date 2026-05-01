/**
 * Per-site state machine for the SOS widget.
 *
 * Visual legend:
 *   idle        — grey,  Start disabled (missing required settings)
 *   needsInfo   — grey+warn, Start disabled with validation banner
 *   nav         — blue,  "Go to Jobs" button (not on a search results page)
 *   ready       — green, Start clickable (all fields filled)
 *   starting    — blue,  pipeline initializing
 *   running     — orange, actively processing (click to stop)
 *   paused      — yellow, pipeline paused (hit pauseAfterFilters etc.)
 *   stopped     — red,   user stopped pipeline
 *   done        — green, pipeline completed all terms
 *   error       — red,   unrecoverable error (click to retry)
 *   ready-again — green, after stopped/done/error — can start again
 */
export type SiteWidgetState =
  | "idle"
  | "needsInfo"
  | "nav"
  | "ready"
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "done"
  | "error"
  | "ready-again"

/** Legacy alias for backwards compat. Maps: idle→idle, ready→ready, running→running, done→done */
export type WidgetState = SiteWidgetState

/**
 * Persisted per-site pipeline state.
 * Stored under key `sos_state_<siteId>` in browser.storage.local.
 */
export interface SitePipelineState {
  state: SiteWidgetState
  lastUpdated: number
  progress?: {
    currentTerm: string
    currentTermIndex: number
    totalTerms: number
    processedJobs: number
    approvedJobs: number
  }
  error?: string
}

export interface FloatingWidgetOptions {
  siteName: string
  siteId: string
  badgeText?: string
  /** Called when the user toggles start/stop. active=true when pipeline starts */
  onToggle?: (active: boolean) => void
  /** Called when the user clicks "Stop" while running */
  onStop?: () => void
  /** Called when user clicks Resume while paused */
  onResume?: () => void
  /** Called when user clicks "Go to Jobs" in nav state */
  onNavigate?: () => void
  /** Current running state (controls button appearance) */
  initialState?: SiteWidgetState
}
