import type { FloatingWidgetOptions } from "../types/ui"
import css from "../styles/ui.css?raw"

/**
 * Creates a floating UI widget injected into the page with Shadow DOM isolation.
 * Mimics the Fonts Ninja extension pattern:
 *   - Expanded: a rounded pill showing the site name (no close button)
 *   - Collapsed: a tiny badge anchored to the right edge showing "SOS"
 *   - Click-outside collapses; click-badge re-expands.
 */
export class FloatingWidget {
  private container: HTMLElement
  private shadow: ShadowRoot
  private expandedEl!: HTMLElement
  private collapsedEl!: HTMLElement
  private isExpanded: boolean = true
  private boundClickOutside: (e: MouseEvent) => void

  constructor(options: FloatingWidgetOptions) {
    this.container = document.createElement("div")
    this.container.id = "sos-floating-widget"

    // Closed shadow root so page CSS never interferes
    this.shadow = this.container.attachShadow({ mode: "closed" })

    this.injectStyles()
    this.buildUI(options)

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
    // --- Expanded ---
    this.expandedEl = document.createElement("div")
    this.expandedEl.className = "sos-expanded"
    this.expandedEl.textContent = options.siteName
    this.shadow.appendChild(this.expandedEl)

    // --- Collapsed ---
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
    if (!this.isExpanded) return
    // The event target is inside the shadow root, so we check the root host
    const target = e.target as Node
    if (!this.container.contains(target)) {
      this.collapse()
    }
  }

  expand(): void {
    this.isExpanded = true
    this.expandedEl.classList.remove("hidden")
    this.collapsedEl.classList.add("hidden")
  }

  collapse(): void {
    this.isExpanded = false
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
