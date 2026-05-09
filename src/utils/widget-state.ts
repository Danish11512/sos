/**
 * Pure state machine for the SOS widget.
 * Extracted from FloatingWidget for testability and memory efficiency.
 *
 * No DOM, no storage, no side effects — just state + transition rules.
 */

import type { SiteWidgetState } from "../types/ui"

/* ── Transition table ── */

export const ALLOWED_TRANSITIONS: Record<SiteWidgetState, SiteWidgetState[]> = {
  idle:         ["nav", "ready", "needsInfo"],
  needsInfo:    ["ready", "idle"],
  nav:          ["idle", "ready"],
  ready:        ["starting", "needsInfo", "idle"],
  starting:     ["running", "error", "stopped"],
  running:      ["paused", "done", "error", "stopped"],
  paused:       ["running", "stopped"],
  stopped:      ["ready"],
  done:         ["ready"],
  error:        ["ready", "starting"],
}

/* ── Pure functions ── */

/** Check if a state transition is allowed. */
export function canTransition(from: SiteWidgetState, to: SiteWidgetState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

/** Get all states reachable from a given state. */
export function reachableStates(state: SiteWidgetState): readonly SiteWidgetState[] {
  return ALLOWED_TRANSITIONS[state] ?? []
}

/** Check if a state is "terminal" (no auto-advance, needs user action). */
export function isTerminal(state: SiteWidgetState): boolean {
  return state === "error" || state === "done" || state === "stopped"
}

/** Check if a state allows user interaction with the form. */
export function allowsFormEdit(state: SiteWidgetState): boolean {
  return state === "idle" || state === "needsInfo" || state === "ready" || isTerminal(state) || state === "nav"
}

/** Check if a state represents an active pipeline. */
export function isActive(state: SiteWidgetState): boolean {
  return state === "starting" || state === "running" || state === "paused"
}
