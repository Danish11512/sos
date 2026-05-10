/**
 * Per-site state machine for the SOS widget.
 *
 * Visual legend:
 *   idle        — grey,  Start disabled (missing required settings)
 *   needsInfo   — grey+warn, Start disabled with validation banner
 *   ready       — green, Start clickable (all fields filled)
 *   starting    — blue,  pipeline initializing
 *   running     — orange, actively processing (click to stop)
 *   paused      — yellow, pipeline paused (hit pauseAfterFilters etc.)
 *   stopped     — red,   user stopped pipeline
 *   done        — green, pipeline completed all terms
 *   error       — red,   unrecoverable error (click to retry)
 */
export type SiteWidgetState =
  | "idle"
  | "needsInfo"
  | "ready"
  | "starting"
  | "running"

  | "paused"
  | "stopped"
  | "done"
  | "error"


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
  /** Current running state (controls button appearance) */
  initialState?: SiteWidgetState
}

