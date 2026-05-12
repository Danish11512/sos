/**
 * Slim FloatingWidget coordinator.
 * Delegates state machine → widget-state.ts, form → settings-form.ts, events → event-bus.ts.
 */

import type { FloatingWidgetOptions, SiteWidgetState, SitePipelineState } from "../types/ui"
import type { AppSettings } from "../settings/sections"
import { settingsManager } from "../settings/manager"
import { loadSettings, saveSettings } from "./storage"
import { browser } from "wxt/browser"
import css from "../styles/ui.css?raw"
import { eventBus } from "./event-bus"
import { canTransition } from "./widget-state"
import { SettingsForm } from "./settings-form"

/* ── Per-site state storage ── */

function stateKey(siteId: string): string { return `sos_state_${siteId}` }

async function loadSiteState(siteId: string): Promise<SitePipelineState | null> {
  const res = await browser.storage.local.get(stateKey(siteId))
  return (res[stateKey(siteId)] as SitePipelineState) ?? null
}

async function saveSiteState(siteId: string, st: SitePipelineState): Promise<void> {
  await browser.storage.local.set({ [stateKey(siteId)]: st })
}

export async function clearSiteState(siteId: string): Promise<void> {
  await browser.storage.local.remove(stateKey(siteId))
}

/* ── Floating Widget ── */

export class FloatingWidget {
  private container: HTMLElement
  private shadow: ShadowRoot
  private expandedEl!: HTMLElement
  private collapsedEl!: HTMLElement
  private toggleBtn!: HTMLButtonElement
  private toggleDot!: HTMLSpanElement
  private toggleLabel!: HTMLSpanElement
  private progressLine!: HTMLDivElement
  private pauseControlsEl!: HTMLElement


  private form = new SettingsForm()
  private curState: SiteWidgetState = "idle"
  // NOTE: `active` flag removed — state machine drives behavior
  // private active = false
  private options: FloatingWidgetOptions
  private settings!: AppSettings
  private siteId: string
  private errMsg: string | null = null

  constructor(options: FloatingWidgetOptions) {
    this.options = options
    this.siteId = options.siteId
    this.container = document.createElement("div")
    this.container.id = "sos-floating-widget"
    this.shadow = this.container.attachShadow({ mode: "closed" })

    const style = document.createElement("style")
    style.textContent = css
    this.shadow.appendChild(style)

    this.buildUI(options)
    if (options.initialState) this.setState(options.initialState)

    document.body.appendChild(this.container)

    const bound = this.handleClickOutside.bind(this)
    requestAnimationFrame(() => document.addEventListener("click", bound))

    this.loadAndSync()
  }

  /* ── Public API ── */

  setProgress(msg: string): void {
    this.progressLine.textContent = msg
    this.progressLine.classList.remove("hidden")
  }

  clearProgress(): void {
    this.progressLine.textContent = ""
    this.progressLine.classList.add("hidden")
  }

  setStopped(): void {
    if (this.curState === "stopped" || this.curState === "ready" || this.curState === "done") return
    this.setState("stopped")
    this.clearProgress()
    this.clearError()
    this.clearPauseControls()
    setTimeout(() => {
      if (this.curState === "stopped") this.setState("ready")
    }, 1500)
  }

  setDone(): void {
    if (this.curState === "done" || this.curState === "stopped" || this.curState === "ready") return
    this.setState("done")
    this.clearProgress()
    this.clearError()
    this.clearPauseControls()
    setTimeout(() => {
      if (this.curState === "done") this.setState("ready")
    }, 2000)
  }

  setPaused(_msg?: string): void {
    this.setState("paused")
    this.showPauseControls()
  }

  /** Public: get current widget state. */
  getState(): SiteWidgetState {
    return this.curState
  }

  /** Public: set widget state. Safe: validates transition internally. */
  setState(state: SiteWidgetState): void {
    this.transitionTo(state)
  }

  /** Destroy widget and remove from DOM. */
  destroy(): void {
    this.container.remove()
    this.form = new SettingsForm() // release old DOM refs
  }

  setError(msg: string): void {
    this.errMsg = msg
    this.setState("error")
    this.clearProgress()
    this.form.showErrorBanner(msg)
  }

  /* ================================================================ */
  /*  Settings I/O                                                     */
  /* ================================================================ */

  private async loadAndSync(): Promise<void> {
    this.settings = await loadSettings()
    this.form.setCtx(this.settings, this.siteId)
    this.form.syncFromSettings()

    const persisted = await loadSiteState(this.siteId)
    if (persisted && !["starting", "running", "paused"].includes(persisted.state)) {
      if (persisted.state === "error" && persisted.error) this.errMsg = persisted.error
      if (["done", "stopped", "error"].includes(persisted.state)) this.setState("ready")
    }
    this.refreshState()
  }

  private async persist(): Promise<void> {
    this.form.gatherIntoSettings()
    settingsManager.setData(this.settings)
    await saveSettings(this.settings)
    eventBus.emit("settings-changed", { settings: this.settings })
    this.refreshState()
  }

  private refreshState(): void {
    if (["running", "starting", "paused"].includes(this.curState)) return


    const ready = settingsManager.getMissingMandatoryFields(this.siteId).length === 0
    if (this.curState === "needsInfo" && !ready) return
    if (this.curState === "needsInfo" && ready) { this.setState("ready"); return }
    if (["error", "done", "stopped", "ready"].includes(this.curState)) return

    const newState = ready ? "ready" : "idle"
    if (this.curState !== newState) {
      this.setState(newState)
      if (ready) this.form.clearValidationBanner()
    }
  }

  /* ================================================================ */
  /*  Build UI                                                        */
  /* ================================================================ */

  private buildUI(opts: FloatingWidgetOptions): void {
    this.expandedEl = document.createElement("div")
    this.expandedEl.className = "sos-expanded"

    // Header
    const header = document.createElement("div")
    header.className = "sos-header"

    const nameEl = document.createElement("span")
    nameEl.className = "sos-site-name"
    nameEl.textContent = opts.siteName
    header.appendChild(nameEl)

    this.toggleBtn = document.createElement("button")

    this.toggleBtn.className = "sos-toggle-btn sos-toggle-btn--idle"
    this.toggleDot = document.createElement("span")
    this.toggleDot.className = "sos-toggle-dot sos-toggle-dot--idle"
    this.toggleLabel = document.createElement("span")
    this.toggleLabel.textContent = "Start"

    this.toggleBtn.appendChild(this.toggleDot)
    this.toggleBtn.appendChild(this.toggleLabel)
    this.toggleBtn.addEventListener("click", (e) => { e.stopPropagation(); this.handleToggle() })
    header.appendChild(this.toggleBtn)
    this.expandedEl.appendChild(header)

    // Progress line
    this.progressLine = document.createElement("div")
    this.progressLine.className = "sos-progress-line hidden"
    this.expandedEl.appendChild(this.progressLine)

    // Pause controls
    this.pauseControlsEl = document.createElement("div")
    this.pauseControlsEl.className = "sos-pause-controls hidden"
    this.pauseControlsEl.innerHTML = `
      <button class="sos-resume-btn" data-resume>▶ Resume</button>
      <button class="sos-pause-stop-btn" data-pause-stop>■ Stop</button>
    `
    this.pauseControlsEl.querySelector("[data-resume]")!.addEventListener("click", (e) => {
      e.stopPropagation(); this.handleResume()
    })
    this.pauseControlsEl.querySelector("[data-pause-stop]")!.addEventListener("click", (e) => {
      e.stopPropagation(); this.handleFromPauseStop()
    })
    this.expandedEl.appendChild(this.pauseControlsEl)

    // Settings form
    const panel = document.createElement("div")
    panel.className = "sos-panel"
    this.form.build(panel, {
      onChange: () => this.persist(),
      onResumeFile: (file) => this.handleResumeFile(file),
    })
    this.expandedEl.appendChild(panel)
    this.shadow.appendChild(this.expandedEl)

    // Collapsed badge
    this.collapsedEl = document.createElement("div")
    this.collapsedEl.className = "sos-collapsed hidden"
    this.collapsedEl.textContent = opts.badgeText ?? "SOS"
    this.collapsedEl.addEventListener("click", (e) => { e.stopPropagation(); this.expand() })
    this.shadow.appendChild(this.collapsedEl)

    // Save button
    panel.querySelector(".sos-save-btn")?.addEventListener("click", (e) => {
      e.stopPropagation()
      this.persist()
      const btn = e.target as HTMLButtonElement
      btn.textContent = "Saved ✓"
      setTimeout(() => { btn.textContent = "Save Settings" }, 1500)
    })
  }

  /* ── Pause stop ── */

  private handleFromPauseStop(): void {
    this.clearProgress()
    this.clearError()
    this.clearPauseControls()
    this.setState("stopped")
    eventBus.emit("stop-requested", { siteId: this.siteId })
    setTimeout(() => {
      if (this.curState === "stopped") this.setState("ready")
    }, 1500)
  }

  /* ── Resume file ── */

  private handleResumeFile(file: File): void {
    if (!this.settings) return
    const reader = new FileReader()
    reader.onload = () => {
      const site = this.settings.perSite[this.siteId]
      if (site) {
        site.additional.resumeData = reader.result as string
        site.additional.resumeFileName = file.name
        this.persist()
      }
    }
    reader.readAsDataURL(file)
  }

  /* ================================================================ */
  /*  State management                                                */
  /* ================================================================ */

  private handleClickOutside(e: MouseEvent): void {
    if (this.expandedEl.classList.contains("hidden") ||
        ["running", "starting", "paused"].includes(this.curState)) return
    if (!this.container.contains(e.target as Node)) this.collapse()
  }

  private transitionTo(state: SiteWidgetState): void {
    if (!canTransition(this.curState, state)) {
      console.warn(`[SOS] Invalid transition: ${this.curState} → ${state}`)
      return
    }
    const from = this.curState
    console.log(`[SOS] State: ${from} → ${state}`)
    this.curState = state
    this.toggleBtn.className = `sos-toggle-btn sos-toggle-btn--${state}`
    this.toggleDot.className = `sos-toggle-dot sos-toggle-dot--${state}`

    switch (state) {
      case "idle":
      case "needsInfo":
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Start"
        this.toggleBtn.disabled = true
        if (state === "idle") { this.clearPauseControls(); this.clearError(); this.clearProgress() }
        break
      case "ready":
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Start"
        this.toggleBtn.disabled = false
        this.clearPauseControls(); this.clearError(); this.clearProgress()
        break
      case "starting":
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Starting"
        this.toggleBtn.disabled = true
        break
      case "running":
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Running"
        this.toggleBtn.disabled = false
        this.clearPauseControls()
        break
      case "paused":
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Paused"
        this.toggleBtn.disabled = true
        break
      case "stopped":
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Stopped"
        this.toggleBtn.disabled = true
        this.clearPauseControls()
        break
      case "done":
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Done ✓"
        this.toggleBtn.disabled = true
        this.clearPauseControls(); this.clearError(); this.clearProgress()
        break
      case "error":
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Error"
        this.toggleBtn.disabled = false
        this.clearPauseControls(); this.clearProgress()
        break
    }


    eventBus.emit("state-changed", { from, to: state, siteId: this.siteId })
    saveSiteState(this.siteId, { state, lastUpdated: Date.now(), error: this.errMsg ?? undefined })
  }

  private showPauseControls(): void { this.pauseControlsEl.classList.remove("hidden") }
  private clearPauseControls(): void { this.pauseControlsEl.classList.add("hidden") }
  private clearError(): void { this.form.clearErrorBanner() }

  private showValidationErrors(missing: { section: string; field: string; label: string }[]): void {
    this.form.showValidationBanner(missing)
    this.form.expandSectionsWithMissing(missing)
  }

  /* ================================================================ */
  /*  Toggle / Start / Stop / Resume                                   */
  /* ================================================================ */

  private async handleToggle(): Promise<void> {
    if (this.curState === "idle" || this.curState === "needsInfo") {

      await this.persist()
      const missing = settingsManager.getMissingMandatoryFields(this.siteId)
      if (missing.length === 0) {
        this.startPipeline()
      } else {
        this.setState("needsInfo")
        this.showValidationErrors(missing)
      }
      return
    }

    if (this.curState === "running") {
      eventBus.emit("stop-requested", { siteId: this.siteId })
      this.setStopped()
      return
    }

    if (this.curState === "ready" || this.curState === "error") {
      this.startPipeline()
      return
    }

    console.warn(`[SOS] Toggle ignored in state: ${this.curState}`)
  }

  private startPipeline(): void {
    eventBus.emit("start-requested", { siteId: this.siteId })
    this.setState("starting")
    this.options.onToggle?.(true)
  }

  private handleResume(): void {
    if (this.curState !== "paused") return
    eventBus.emit("resume-requested", { siteId: this.siteId })
    this.options.onResume?.()
  }

  /* ================================================================ */
  /*  Collapse / Expand                                                */
  /* ================================================================ */

  private collapse(): void {
    this.expandedEl.classList.add("hidden")
    this.collapsedEl.classList.remove("hidden")
  }

  expand(): void {
    this.expandedEl.classList.remove("hidden")
    this.collapsedEl.classList.add("hidden")
  }
}
