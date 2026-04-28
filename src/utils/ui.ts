import type { FloatingWidgetOptions, WidgetState } from "../types/ui"
import css from "../styles/ui.css?raw"

/**
 * Floating UI widget injected into the page with Shadow DOM isolation.
 *
 * Layout:
 *   Collapsed  → tiny vertical badge on the right edge ("SOS")
 *   Expanded   → two-piece UI:
 *                 1. Header bar (site name + start/stop toggle button)
 *                 2. Settings panel below it
 *
 * Click-outside collapses; click-badge re-expands.
 */
export class FloatingWidget {
  private container: HTMLElement
  private shadow: ShadowRoot

  private expandedEl!: HTMLElement
  private collapsedEl!: HTMLElement

  private toggleBtn!: HTMLButtonElement
  private toggleDot!: HTMLSpanElement
  private toggleLabel!: HTMLSpanElement

  private state: WidgetState = "idle"
  private active: boolean = false
  private boundClickOutside: (e: MouseEvent) => void

  /* Exposed for external state updates */
  private options: FloatingWidgetOptions

  constructor(options: FloatingWidgetOptions) {
    this.options = options
    this.container = document.createElement("div")
    this.container.id = "sos-floating-widget"

    // Closed shadow root so page CSS never interferes
    this.shadow = this.container.attachShadow({ mode: "closed" })

    this.injectStyles()
    this.buildUI(options)

    if (options.initialState) {
      this.setState(options.initialState)
    }

    document.body.appendChild(this.container)

    // Click-outside listener
    this.boundClickOutside = this.handleClickOutside.bind(this)
    // Delay binding to avoid the click that triggered the widget being counted
    requestAnimationFrame(() => {
      document.addEventListener("click", this.boundClickOutside)
    })
  }

  /* ------------------------------------------------------------------ */
  /*  Styles                                                             */
  /* ------------------------------------------------------------------ */

  private injectStyles(): void {
    const style = document.createElement("style")
    style.textContent = css
    this.shadow.appendChild(style)
  }

  /* ------------------------------------------------------------------ */
  /*  Build elements                                                     */
  /* ------------------------------------------------------------------ */

  private buildUI(options: FloatingWidgetOptions): void {
    // ======== Expanded ========
    this.expandedEl = document.createElement("div")
    this.expandedEl.className = "sos-expanded"

    // --- Header row ---
    const header = document.createElement("div")
    header.className = "sos-header"

    const nameEl = document.createElement("span")
    nameEl.className = "sos-site-name"
    nameEl.textContent = options.siteName
    header.appendChild(nameEl)

    // Toggle button
    this.toggleBtn = document.createElement("button")
    this.toggleBtn.className = "sos-toggle-btn sos-toggle-btn--idle"

    this.toggleDot = document.createElement("span")
    this.toggleDot.className = "sos-toggle-dot sos-toggle-dot--idle"

    this.toggleLabel = document.createElement("span")
    this.toggleLabel.textContent = "Start"

    this.toggleBtn.appendChild(this.toggleDot)
    this.toggleBtn.appendChild(this.toggleLabel)

    this.toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      this.handleToggle()
    })

    header.appendChild(this.toggleBtn)
    this.expandedEl.appendChild(header)

    // --- Settings panel ---
    const panel = document.createElement("div")
    panel.className = "sos-panel"

    const labelEl = document.createElement("div")
    labelEl.className = "sos-panel-label"
    labelEl.textContent = "Settings"
    panel.appendChild(labelEl)

    const input = document.createElement("input")
    input.className = "sos-panel-input"
    input.type = "text"
    input.placeholder = "Configure..."
    input.addEventListener("click", (e) => e.stopPropagation())
    panel.appendChild(input)

    this.expandedEl.appendChild(panel)
    this.shadow.appendChild(this.expandedEl)

    // ======== Collapsed ========
    this.collapsedEl = document.createElement("div")
    this.collapsedEl.className = "sos-collapsed hidden"
    this.collapsedEl.textContent = options.badgeText ?? "SOS"
    this.collapsedEl.addEventListener("click", (e) => {
      e.stopPropagation()
      this.expand()
    })
    this.shadow.appendChild(this.collapsedEl)
  }

  /* ------------------------------------------------------------------ */
  /*  State management                                                   */
  /* ------------------------------------------------------------------ */

  private handleClickOutside(e: MouseEvent): void {
    const expanded = this.expandedEl
    if (expanded.classList.contains("hidden")) return

    const target = e.target as Node
    if (!this.container.contains(target)) {
      this.collapse()
    }
  }

  /** Update the toggle button to reflect a new state */
  setState(state: WidgetState): void {
    this.state = state
    // Strip existing state classes
    this.toggleBtn.classList.remove(
      "sos-toggle-btn--idle",
      "sos-toggle-btn--running",
      "sos-toggle-btn--done"
    )
    this.toggleDot.classList.remove(
      "sos-toggle-dot--idle",
      "sos-toggle-dot--running",
      "sos-toggle-dot--done"
    )

    switch (state) {
      case "idle":
        this.toggleBtn.classList.add("sos-toggle-btn--idle")
        this.toggleDot.classList.add("sos-toggle-dot--idle")
        this.toggleLabel.textContent = this.active ? "Stop" : "Start"
        this.toggleBtn.disabled = false
        break
      case "running":
        this.toggleBtn.classList.add("sos-toggle-btn--running")
        this.toggleDot.classList.add("sos-toggle-dot--running")
        this.toggleLabel.textContent = "Running"
        this.toggleBtn.disabled = false
        break
      case "done":
        this.toggleBtn.classList.add("sos-toggle-btn--done")
        this.toggleDot.classList.add("sos-toggle-dot--done")
        this.toggleLabel.textContent = "Done"
        this.toggleBtn.disabled = true
        break
    }
  }

  private handleToggle(): void {
    this.active = !this.active
    this.state = this.active ? "running" : "idle"
    this.setState(this.state)
    this.options.onToggle?.(this.active)
  }

  expand(): void {
    this.expandedEl.classList.remove("hidden")
    this.collapsedEl.classList.add("hidden")
  }

  collapse(): void {
    this.expandedEl.classList.add("hidden")
    this.collapsedEl.classList.remove("hidden")
  }

  /* ------------------------------------------------------------------ */
  /*  Cleanup                                                            */
  /* ------------------------------------------------------------------ */

  destroy(): void {
    document.removeEventListener("click", this.boundClickOutside)
    this.container.remove()
  }
}
