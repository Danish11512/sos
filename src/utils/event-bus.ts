/**
 * Lightweight event bus for decoupling widget ↔ pipeline ↔ content.
 *
 * Usage:
 *   import { eventBus } from "./event-bus"
 *
 *   // Subscribe (returns unsubscribe fn)
 *   const unsub = eventBus.on("pipeline-progress", (msg) => console.log(msg))
 *
 *   // With AbortSignal (auto-cleanup on abort)
 *   eventBus.on("stop-requested", () => cleanup(), signal)
 *
 *   // Publish
 *   eventBus.emit("pipeline-progress", { message: "Processing..." })
 */

import type { SiteWidgetState } from "../types/ui"
import type { AppSettings } from "../settings/sections"

export interface EventMap {
  "state-changed": { from: SiteWidgetState; to: SiteWidgetState; siteId: string }
  "settings-changed": { settings: AppSettings }
  "pipeline-progress": { message: string; siteId: string }
  "stop-requested": { siteId: string }
  "resume-requested": { siteId: string }
  "start-requested": { siteId: string }
  "pipeline-error": { message: string; siteId: string }
  "pipeline-done": { siteId: string }
  "url-changed": { url: string }
}

export type EventKey = keyof EventMap

type Listener = (data: any) => void

class EventBus {
  private listeners = new Map<string, Set<Listener>>()

  on<K extends EventKey>(
    event: K,
    cb: (data: EventMap[K]) => void,
    signal?: AbortSignal
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)!.add(cb as Listener)

    // Auto-cleanup on abort
    if (signal) {
      signal.addEventListener("abort", () => this.off(event, cb as Listener), { once: true })
    }

    return () => this.off(event, cb as Listener)
  }

  off<K extends EventKey>(event: K, cb: (data: EventMap[K]) => void): void {
    this.listeners.get(event)?.delete(cb as Listener)
    if (this.listeners.get(event)?.size === 0) {
      this.listeners.delete(event)
    }
  }

  emit<K extends EventKey>(event: K, data: EventMap[K]): void {
    this.listeners.get(event)?.forEach((cb) => {
      try { cb(data) } catch (e) { console.warn(`[SOS] EventBus error on ${event}:`, e) }
    })
  }

  /** Remove all listeners for an event (or all events if no arg). */
  clear(event?: EventKey): void {
    if (event) this.listeners.delete(event)
    else this.listeners.clear()
  }

  /** Number of listeners for an event (useful for leak detection). */
  listenerCount(event: EventKey): number {
    return this.listeners.get(event)?.size ?? 0
  }
}

export const eventBus = new EventBus()
