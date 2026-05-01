import type { FloatingWidgetOptions, SiteWidgetState, SitePipelineState } from "../types/ui"
import type { AppSettings, GlobalSettings, SiteSettings } from "../settings/sections"
import { settingsManager } from "../settings/manager"
import { DEFAULT_SITE } from "../settings/sections"
import { loadSettings, saveSettings } from "./storage"
import { browser } from "wxt/browser"
import css from "../styles/ui.css?raw"

/* ── Per-site state storage key ── */

function stateKey(siteId: string): string {
  return `sos_state_${siteId}`
}

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

/* ── Allowed-transition map ── */

const ALLOWED_TRANSITIONS: Record<SiteWidgetState, SiteWidgetState[]> = {
  idle:         ["nav", "ready", "needsInfo", "running", "starting", "paused"],
  needsInfo:    ["ready", "idle", "nav"],
  nav:          ["idle", "ready"],
  ready:        ["starting", "needsInfo", "idle", "nav"],
  starting:     ["running", "error", "stopped"],
  running:      ["paused", "done", "error", "stopped"],
  paused:       ["running", "stopped"],
  stopped:      ["ready", "nav"],
  done:         ["ready", "nav"],
  error:        ["ready", "starting", "nav"],

}


function canTransition(from: SiteWidgetState, to: SiteWidgetState): boolean {
  const allowed = ALLOWED_TRANSITIONS[from]
  return allowed ? allowed.includes(to) : false
}

/* ── Floating Widget ── */

/**
 * Floating UI widget injected into the page with Shadow DOM isolation.
 *
 * Full state machine: idle → ready → starting → running → paused|done|stopped|error → ready
 *
 * States:
 *   idle        — grey,   missing required fields
 *   needsInfo   — grey,   user clicked Start but fields missing (validation banner shown)
 *   ready       — green,  all fields set, Start clickable
 *   starting    — blue,   pipeline initializing
 *   running     — orange, pipeline active, click to stop
 *   paused      — yellow, pipeline paused (pauseAfterFilters, unknown question)
 *   stopped     — red,    user stopped pipeline
 *   done        — green,  pipeline completed
 *   error       — red,    unrecoverable error, click to retry

 */
export class FloatingWidget {
  private container: HTMLElement
  private shadow: ShadowRoot
  private expandedEl!: HTMLElement
  private collapsedEl!: HTMLElement
  private toggleBtn!: HTMLButtonElement
  private toggleDot!: HTMLSpanElement
  private toggleLabel!: HTMLSpanElement
  private jobStatusLine!: HTMLDivElement
  private progressLine!: HTMLDivElement
  private pauseControlsEl!: HTMLElement
  private navBtn!: HTMLButtonElement
  private formContainer!: HTMLElement
  private state: SiteWidgetState = "idle"

  private active = false
  private boundClickOutside: (e: MouseEvent) => void
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

    this.boundClickOutside = this.handleClickOutside.bind(this)
    requestAnimationFrame(() => document.addEventListener("click", this.boundClickOutside))

    this.loadAndSync()
  }

  /* ── Public API ── */

  /** Update the job status line (shown above the toggle button when running). */
  setJobStatus(jobTitle: string, isValid: boolean): void {
    this.jobStatusLine.textContent = `${jobTitle} — Valid Job: ${isValid ? "Yes" : "No"}`
  }

  /** Update progress line (shown when running/starting). */
  setProgress(msg: string): void {
    this.progressLine.textContent = msg
    this.progressLine.classList.remove("hidden")
  }

  /** Clear progress message. */
  clearProgress(): void {
    this.progressLine.textContent = ""
    this.progressLine.classList.add("hidden")
  }

  /**
   * Mark pipeline as stopped.
   * Safe to call multiple times — idempotent after first call.
   * After a brief moment auto-transitions to ready.
   */
  setStopped(): void {
    // Guard: already handled by prior call (handleStop() via pause Stop or toggle)
    if (this.state === "stopped" || this.state === "ready" || this.state === "done") return
    this.active = false
    this.setState("stopped")
    this.jobStatusLine.textContent = ""
    this.clearProgress()
    this.clearError()
    this.clearPauseControls()
    setTimeout(() => {
      if (this.state === "stopped") {
        this.setState("ready")
      }
    }, 1500)

  }

  /** Transition to paused state with optional message. */
  setPaused(msg?: string): void {
    this.setState("paused")
    if (msg) this.jobStatusLine.textContent = msg
    this.showPauseControls()
  }

  /** Transition to error state with error message. */
  setError(msg: string): void {
    this.errMsg = msg
    this.active = false
    this.setState("error")
    this.jobStatusLine.textContent = ""
    this.clearProgress()
    this.showError(msg)
  }

  /* ================================================================ */
  /*  Settings I/O                                                     */
  /* ================================================================ */

  private async loadAndSync(): Promise<void> {
    this.settings = await loadSettings()
    this.syncFormFromSettings()
    // Restore persisted state
    const persisted = await loadSiteState(this.siteId)
    if (persisted && persisted.state !== "starting" && persisted.state !== "running" && persisted.state !== "paused") {
      // Only restore terminal/non-active states (active ones are transient)
      if (persisted.state === "error" && persisted.error) this.errMsg = persisted.error
      if (persisted.state === "done" || persisted.state === "stopped" || persisted.state === "error") {
        this.setState("ready")
      }
    }
    this.refreshState()

  }

  private async persistAndRefresh(): Promise<void> {
    this.gatherFormIntoSettings()
    await saveSettings(this.settings)
    settingsManager.setData(this.settings)
    this.refreshState()
  }

  private refreshState(): void {
    if (this.state === "nav" || this.state === "running" || this.state === "starting" || this.state === "paused") return

    const ready = settingsManager.getMissingMandatoryFields(this.siteId).length === 0
    if (this.state === "needsInfo" && !ready) return // keep needsInfo until user fills fields
    if (this.state === "needsInfo" && ready) { this.setState("ready"); return }
    if (this.state === "error" || this.state === "done" || this.state === "stopped" || this.state === "ready") return

    const newState = ready ? "ready" : "idle"
    if (this.state !== newState) {
      this.setState(newState)
      if (ready) this.clearValidationErrors()
    }
  }

  /* ================================================================ */
  /*  Build UI                                                        */
  /* ================================================================ */

  private buildUI(options: FloatingWidgetOptions): void {
    this.expandedEl = document.createElement("div")
    this.expandedEl.className = "sos-expanded"

    // ── Header ──
    const header = document.createElement("div")
    header.className = "sos-header"

    const nameEl = document.createElement("span")
    nameEl.className = "sos-site-name"
    nameEl.textContent = options.siteName
    header.appendChild(nameEl)

    // Nav button — shown only when not on a search results page
    this.navBtn = document.createElement("button")
    this.navBtn.className = "sos-nav-btn hidden"
    this.navBtn.textContent = "Go to Jobs →"
    this.navBtn.addEventListener("click", (e) => { e.stopPropagation(); this.options.onNavigate?.() })
    header.appendChild(this.navBtn)

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


    // ── Progress line (for running/starting) ──
    this.progressLine = document.createElement("div")
    this.progressLine.className = "sos-progress-line hidden"
    this.progressLine.textContent = ""
    this.expandedEl.appendChild(this.progressLine)

    // ── Pause controls (for paused state) ──
    this.pauseControlsEl = document.createElement("div")
    this.pauseControlsEl.className = "sos-pause-controls hidden"
    this.buildPauseControls()
    this.expandedEl.appendChild(this.pauseControlsEl)

    // ── Job status line ──
    this.jobStatusLine = document.createElement("div")
    this.jobStatusLine.className = "sos-job-status"
    this.jobStatusLine.textContent = ""
    this.expandedEl.appendChild(this.jobStatusLine)

    // ── Settings panel ──
    const panel = document.createElement("div")
    panel.className = "sos-panel"
    this.buildSettingsForm(panel)
    this.expandedEl.appendChild(panel)
    this.shadow.appendChild(this.expandedEl)

    // ── Collapsed badge ──
    this.collapsedEl = document.createElement("div")
    this.collapsedEl.className = "sos-collapsed hidden"
    this.collapsedEl.textContent = options.badgeText ?? "SOS"
    this.collapsedEl.addEventListener("click", (e) => { e.stopPropagation(); this.expand() })
    this.shadow.appendChild(this.collapsedEl)
  }

  private buildPauseControls(): void {
    this.pauseControlsEl.innerHTML = `
      <button class="sos-resume-btn" data-resume>▶ Resume</button>
      <button class="sos-pause-stop-btn" data-pause-stop>■ Stop</button>
    `
    this.pauseControlsEl.querySelector("[data-resume]")?.addEventListener("click", (e) => {
      e.stopPropagation()
      this.handleResume()
    })
    this.pauseControlsEl.querySelector("[data-pause-stop]")?.addEventListener("click", (e) => {
      e.stopPropagation()
      this.handleFromPauseStop()
    })
  }

  /* ── Pause-controls stop (from paused state) ── */
  private handleFromPauseStop(): void {
    this.active = false
    this.jobStatusLine.textContent = ""
    this.clearProgress()
    this.clearError()
    this.clearPauseControls()
    // Transition paused → stopped immediately
    this.setState("stopped")
    // Notify the parent to clean up (the pipeline may be awaiting user input)
    this.options.onStop?.()
    // After a brief moment, ready to start again
    setTimeout(() => {
      if (this.state === "stopped") {
        this.setState("ready")
      }
    }, 1500)

  }

  /* ================================================================ */
  /*  Settings Form                                                   */
  /* ================================================================ */

  private buildSettingsForm(container: HTMLElement): void {
    this.formContainer = container
    container.innerHTML = `
      <div class="sos-section sos-section-open">
        <div class="sos-section-header" data-section="personal">
          <span class="sos-section-title">Personal Info</span>
          <span class="sos-section-arrow">▼</span>
        </div>
        <div class="sos-section-body">
          <label>First Name *<input class="sos-fld" data-path="global.personal.firstName" type="text" placeholder="John"></label>
          <label>Last Name *<input class="sos-fld" data-path="global.personal.lastName" type="text" placeholder="Doe"></label>
          <label>Phone *<input class="sos-fld" data-path="global.personal.phoneNumber" type="tel" placeholder="9876543210"></label>
          <label>Current City *<input class="sos-fld" data-path="global.personal.currentCity" type="text" placeholder="Los Angeles"></label>
          <label>Street *<input class="sos-fld" data-path="global.personal.street" type="text" placeholder="123 Main St"></label>
          <label>State *<input class="sos-fld" data-path="global.personal.state" type="text" placeholder="CA"></label>
          <label>Zip Code *<input class="sos-fld" data-path="global.personal.zipcode" type="text" placeholder="12345"></label>
          <label>Country *<input class="sos-fld" data-path="global.personal.country" type="text" placeholder="United States"></label>
        </div>
      </div>
      <div class="sos-section">
        <div class="sos-section-header" data-section="eeo">
          <span class="sos-section-title">EEO / Diversity</span>
          <span class="sos-section-arrow">▶</span>
        </div>
        <div class="sos-section-body hidden">
          <label>Ethnicity<select class="sos-fld" data-path="global.eeo.ethnicity">
            <option value="Decline">Decline</option>
            <option value="Hispanic/Latino">Hispanic/Latino</option>
            <option value="American Indian or Alaska Native">American Indian or Alaska Native</option>
            <option value="Asian">Asian</option>
            <option value="Black or African American">Black or African American</option>
            <option value="Native Hawaiian or Other Pacific Islander">Native Hawaiian or Other Pacific Islander</option>
            <option value="White">White</option>
            <option value="Other">Other</option>
          </select></label>
          <label>Gender<select class="sos-fld" data-path="global.eeo.gender">
            <option value="Decline">Decline</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select></label>
          <label>Disability Status<select class="sos-fld" data-path="global.eeo.disabilityStatus">
            <option value="Decline">Decline</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select></label>
          <label>Veteran Status<select class="sos-fld" data-path="global.eeo.veteranStatus">
            <option value="Decline">Decline</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select></label>
        </div>
      </div>
      <div class="sos-section">
        <div class="sos-section-header" data-section="search">
          <span class="sos-section-title">Search & Filters</span>
          <span class="sos-section-arrow">▶</span>
        </div>
        <div class="sos-section-body hidden">
          <div class="sos-label-sub">Search Terms *</div>
          <div class="sos-tag-input-wrapper">
            <div class="sos-tag-list" data-path="site.search.searchTerms" data-tag-container></div>
            <input class="sos-fld sos-tag-text-input" type="text" placeholder="Type a term and press Enter or comma to add">
          </div>
          <label>Search Location<input class="sos-fld" data-path="site.search.searchLocation" type="text" placeholder="United States"></label>
          <label>Sort By<select class="sos-fld" data-path="site.filters.sortBy">
            <option value="">—</option>
            <option value="Most recent">Most recent</option>
            <option value="Most relevant">Most relevant</option>
          </select></label>
          <label>Date Posted<select class="sos-fld" data-path="site.filters.datePosted">
            <option value="">—</option>
            <option value="Any time">Any time</option>
            <option value="Past month">Past month</option>
            <option value="Past week">Past week</option>
            <option value="Past 24 hours">Past 24 hours</option>
          </select></label>
          <div class="sos-label-sub">Experience Level</div>
          <div class="sos-checkbox-group" data-checkbox-group="site.filters.experienceLevel">
            <label class="sos-label-chk"><input type="checkbox" value="Internship"> Internship</label>
            <label class="sos-label-chk"><input type="checkbox" value="Entry level"> Entry level</label>
            <label class="sos-label-chk"><input type="checkbox" value="Associate"> Associate</label>
            <label class="sos-label-chk"><input type="checkbox" value="Mid-Senior level"> Mid-Senior level</label>
            <label class="sos-label-chk"><input type="checkbox" value="Director"> Director</label>
            <label class="sos-label-chk"><input type="checkbox" value="Executive"> Executive</label>
          </div>
          <div class="sos-label-sub">Job Type</div>
          <div class="sos-checkbox-group" data-checkbox-group="site.filters.jobType">
            <label class="sos-label-chk"><input type="checkbox" value="Full-time"> Full-time</label>
            <label class="sos-label-chk"><input type="checkbox" value="Part-time"> Part-time</label>
            <label class="sos-label-chk"><input type="checkbox" value="Contract"> Contract</label>
            <label class="sos-label-chk"><input type="checkbox" value="Temporary"> Temporary</label>
            <label class="sos-label-chk"><input type="checkbox" value="Volunteer"> Volunteer</label>
            <label class="sos-label-chk"><input type="checkbox" value="Internship"> Internship</label>
            <label class="sos-label-chk"><input type="checkbox" value="Other"> Other</label>
          </div>
          <div class="sos-label-sub">On-site / Remote</div>
          <div class="sos-checkbox-group" data-checkbox-group="site.filters.onSite">
            <label class="sos-label-chk"><input type="checkbox" value="On-site"> On-site</label>
            <label class="sos-label-chk"><input type="checkbox" value="Remote"> Remote</label>
            <label class="sos-label-chk"><input type="checkbox" value="Hybrid"> Hybrid</label>
          </div>
          <div class="sos-label-sub">Companies <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.companies" type="text" placeholder="Google, Meta, Apple, ...">
          <label>Switch #<input class="sos-fld" data-path="site.search.switchNumber" type="number" min="1" placeholder="30"></label>
          <label class="sos-label-toggle"><span>Easy Apply Only</span><input class="sos-fld sos-toggle-input" data-path="site.filters.easyApplyOnly" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Randomize Search Order</span><input class="sos-fld sos-toggle-input" data-path="site.search.randomizeSearchOrder" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Under 10 Applicants</span><input class="sos-fld sos-toggle-input" data-path="site.filters.under10Applicants" type="checkbox"></label>
          <label class="sos-label-toggle"><span>In Your Network</span><input class="sos-fld sos-toggle-input" data-path="site.filters.inYourNetwork" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Fair Chance Employer</span><input class="sos-fld sos-toggle-input" data-path="site.filters.fairChanceEmployer" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Pause After Filters</span><input class="sos-fld sos-toggle-input" data-path="site.filters.pauseAfterFilters" type="checkbox"></label>
          <hr class="sos-separator">
          <div class="sos-label-sub">Skip: Bad Words in Company About <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.aboutCompanyBadWords" type="text" placeholder="Staffing, Recruiting, ...">
          <div class="sos-label-sub">Skip: Bad Words for These Exceptions <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.aboutCompanyGoodWords" type="text" placeholder="Robert Half, ...">
          <div class="sos-label-sub">Skip: Bad Words in Job Description <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.badWords" type="text" placeholder="US Citizen, No C2C, ...">
          <label>Current Experience (years)<input class="sos-fld" data-path="site.filters.currentExperience" type="number" min="0" placeholder="5"></label>
          <hr class="sos-separator">
          <label class="sos-label-toggle"><span>Security Clearance</span><input class="sos-fld sos-toggle-input" data-path="site.filters.securityClearance" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Has Master's Degree</span><input class="sos-fld sos-toggle-input" data-path="site.filters.didMasters" type="checkbox"></label>
        </div>
      </div>
      <div class="sos-section">
        <div class="sos-section-header" data-section="answers">
          <span class="sos-section-title">Application Answers</span>
          <span class="sos-section-arrow">▶</span>
        </div>
        <div class="sos-section-body hidden">
          <label>Years of Experience<input class="sos-fld" data-path="site.answers.yearsOfExperience" type="text" placeholder="5"></label>
          <label>Desired Salary *<select class="sos-fld" data-path="site.answers.desiredSalary">
            <option value="">—</option>
            <option value="40000">$40,000+</option>
            <option value="60000">$60,000+</option>
            <option value="80000">$80,000+</option>
            <option value="100000">$100,000+</option>
            <option value="120000">$120,000+</option>
            <option value="140000">$140,000+</option>
            <option value="160000">$160,000+</option>
            <option value="180000">$180,000+</option>
            <option value="200000">$200,000+</option>
          </select></label>
          <label>Require Visa<select class="sos-fld" data-path="site.answers.requireVisa">
            <option value="No">No</option>
            <option value="Yes">Yes</option>
          </select></label>
          <label>Portfolio / Website<input class="sos-fld" data-path="site.answers.website" type="text" placeholder="https://..."></label>
          <label>LinkedIn URL<input class="sos-fld" data-path="site.answers.linkedIn" type="text" placeholder="https://linkedin.com/in/..."></label>
          <label>US Citizenship<select class="sos-fld" data-path="site.answers.usCitizenship">
            <option value="">—</option>
            <option value="U.S. Citizen/Permanent Resident">U.S. Citizen/Permanent Resident</option>
            <option value="Non-citizen allowed to work for any employer">Non-citizen allowed to work for any employer</option>
            <option value="Non-citizen allowed to work for current employer">Non-citizen allowed to work for current employer</option>
            <option value="Non-citizen seeking work authorization">Non-citizen seeking work authorization</option>
            <option value="Canadian Citizen/Permanent Resident">Canadian Citizen/Permanent Resident</option>
            <option value="Other">Other</option>
          </select></label>
          <label>Current CTC<input class="sos-fld" data-path="site.answers.currentCtc" type="number" placeholder="80000"></label>
          <label>Notice Period (days)<input class="sos-fld" data-path="site.answers.noticePeriod" type="number" min="0" placeholder="30"></label>
          <label>LinkedIn Headline<input class="sos-fld" data-path="site.answers.linkedinHeadline" type="text" placeholder="Software Engineer @ Google..."></label>
          <label>Summary<textarea class="sos-fld sos-textarea" data-path="site.answers.linkedinSummary" placeholder="Professional summary..."></textarea></label>
          <label>Cover Letter<textarea class="sos-fld sos-textarea" data-path="site.answers.coverLetter" placeholder="Cover letter..."></textarea></label>
          <label>Recent Employer<input class="sos-fld" data-path="site.answers.recentEmployer" type="text" placeholder="Google"></label>
          <label>Confidence Level (1-10)<input class="sos-fld" data-path="site.answers.confidenceLevel" type="text" placeholder="8"></label>
        </div>
      </div>
      <div class="sos-section">
        <div class="sos-section-header" data-section="pipeline">
          <span class="sos-section-title">Pipeline & Behavior</span>
          <span class="sos-section-arrow">▶</span>
        </div>
        <div class="sos-section-body hidden">
          <label>Click Gap (sec)<input class="sos-fld" data-path="global.globalBehavior.clickGap" type="number" min="0" step="0.5" placeholder="1"></label>
          <label class="sos-label-toggle"><span>Smooth Scroll</span><input class="sos-fld sos-toggle-input" data-path="global.globalBehavior.smoothScroll" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Keep Screen Awake</span><input class="sos-fld sos-toggle-input" data-path="global.globalBehavior.keepScreenAwake" type="checkbox"></label>
          <hr class="sos-separator">
          <label class="sos-label-toggle"><span>Pause Before Submit</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.pauseBeforeSubmit" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Pause on Unknown Questions</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.pauseAtFailedQuestion" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Overwrite Previous Answers</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.overwritePreviousAnswers" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Close External Tabs</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.closeTabs" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Follow Companies</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.followCompanies" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Run Non-Stop</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.runNonStop" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Run in Background</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.runInBackground" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Alternate Sort By</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.alternateSortby" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Cycle Date Posted</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.cycleDatePosted" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Stop Date Cycle at 24h</span><input class="sos-fld sos-toggle-input" data-path="site.pipeline.stopDateCycleAt24hr" type="checkbox"></label>
        </div>
      </div>
      <div class="sos-section">
        <div class="sos-section-header" data-section="additional">
          <span class="sos-section-title">Additional</span>
          <span class="sos-section-arrow">▶</span>
        </div>
        <div class="sos-section-body hidden">
          <label class="sos-label-toggle"><span>Auto-fill Screening Questions</span><input class="sos-fld sos-toggle-input" data-path="site.additional.autoFillScreeningQuestions" type="checkbox"></label>
          <div class="sos-label-sub">Resume Upload <span class="sos-hint">(.pdf, .doc, .docx, .txt)</span></div>
          <div class="sos-resume-upload">
            <input class="sos-resume-input" type="file" accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,text/plain">
            <span class="sos-resume-filename"></span>
          </div>
          <div class="sos-label-sub">Custom Answers <span class="sos-hint">(question,answer per line)</span></div>
          <textarea class="sos-fld sos-textarea sos-custom-answers-input" data-path="site.additional.customAnswers" placeholder="What is your desired salary?,120000&#10;Are you authorized to work in the US?,Yes"></textarea>
        </div>
      </div>
      <div class="sos-section-footer">
        <button class="sos-save-btn">Save Settings</button>
      </div>
    `

    container.querySelectorAll(".sos-section-header").forEach((header) => {
        header.addEventListener("click", (e) => {
          e.stopPropagation()
          const section = (header as HTMLElement).closest(".sos-section")!
          const body = section.querySelector(".sos-section-body") as HTMLElement
          const arrow = header.querySelector(".sos-section-arrow") as HTMLElement
          const isOpen = !body.classList.contains("hidden")
          body.classList.toggle("hidden", isOpen)
          section.classList.toggle("sos-section-open", isOpen)
          arrow.textContent = isOpen ? "▶" : "▼"
        })
    })

    this.initTagInput()

    container.querySelectorAll<HTMLElement>(".sos-fld:not(.sos-tag-text-input)").forEach((el) => {
      el.addEventListener("change", () => this.persistAndRefresh())
    })

    const resumeInput = container.querySelector(".sos-resume-input") as HTMLInputElement
    resumeInput?.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file || !this.settings) return
      const reader = new FileReader()
      reader.onload = () => {
        const site = this.settings.perSite[this.siteId]
        if (site) {
          site.additional.resumeData = reader.result as string
          site.additional.resumeFileName = file.name
          const fnEl = this.formContainer.querySelector(".sos-resume-filename")
          if (fnEl) fnEl.textContent = file.name
          this.persistAndRefresh()
        }
      }
      reader.readAsDataURL(file)
    })

    const saveBtn = container.querySelector(".sos-save-btn")!
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      this.persistAndRefresh()
      saveBtn.textContent = "Saved ✓"
      setTimeout(() => { saveBtn.textContent = "Save Settings" }, 1500)
    })
  }

  /* ================================================================ */
  /*  Tag Input                                                       */
  /* ================================================================ */

  private initTagInput(): void {
    const wrapper = this.formContainer.querySelector(".sos-tag-input-wrapper")
    if (!wrapper) return
    const tagList = wrapper.querySelector(".sos-tag-list") as HTMLElement
    const textInput = wrapper.querySelector(".sos-tag-text-input") as HTMLInputElement

    const addTag = (term: string) => {
      const trimmed = term.trim()
      if (!trimmed) return
      const existing = new Set(
        [...tagList.querySelectorAll(".sos-tag")].map(
          (t) => t.querySelector(".sos-tag-text")?.textContent || ""
        )
      )
      if (existing.has(trimmed)) return
      tagList.appendChild(this.createTagEl(trimmed))
      textInput.value = ""
      this.persistAndRefresh()
    }

    textInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault()
        addTag(textInput.value.replace(/,/g, ""))
      }
    })
    textInput.addEventListener("blur", () => {
      if (textInput.value.trim()) addTag(textInput.value)
    })
  }

  private createTagEl(term: string): HTMLSpanElement {
    const tag = document.createElement("span")
    tag.className = "sos-tag"
    tag.innerHTML = `<span class="sos-tag-text">${term}</span><span class="sos-tag-remove" role="button" tabindex="0">×</span>`
    tag.querySelector(".sos-tag-remove")!.addEventListener("click", (e) => {
      e.stopPropagation()
      tag.remove()
      this.persistAndRefresh()
    })
    return tag
  }

  private syncTagInputFromSettings(terms: string[]): void {
    const tagList = this.formContainer.querySelector(".sos-tag-list") as HTMLElement
    if (!tagList) return
    tagList.innerHTML = ""
    terms.forEach((term) => tagList.appendChild(this.createTagEl(term)))
  }

  private gatherTagInput(): string[] {
    const tagList = this.formContainer.querySelector(".sos-tag-list") as HTMLElement
    if (!tagList) return []
    return [...tagList.querySelectorAll(".sos-tag")].map(
      (t) => t.querySelector(".sos-tag-text")?.textContent || ""
    )
  }

  /* ================================================================ */
  /*  Sync: Settings → Form                                          */
  /* ================================================================ */

  /**
   * Normalize a value that should be a string[].
   * Handles backwards compatibility: if the value was stored as a raw string
   * (before the ARRAY_FIELDS fix), splits it on comma.
   */
  private static normalizeArrayVal(val: unknown): string[] {
    if (Array.isArray(val)) return val
    if (typeof val === "string" && val.trim()) {
      return val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    }
    return []
  }

  private getValueByPath(path: string): unknown {
    if (!this.settings) return ""
    if (path.startsWith("global.")) {
      const [, section, field] = path.split(".")
      const obj = this.settings.global[section as keyof GlobalSettings] as unknown as Record<string, unknown>
      const val = obj?.[field] ?? ""
      // Normalize array fields for backwards compatibility with old string-format data
      if (FloatingWidget.ARRAY_FIELDS.has(field)) {
        return FloatingWidget.normalizeArrayVal(val)
      }
      return val
    }
    if (path.startsWith("site.")) {
      const [, section, field] = path.split(".")
      const site = this.settings.perSite[this.siteId]
      if (!site) return ""
      const obj = site[section as keyof SiteSettings] as unknown as Record<string, unknown>
      const val = obj?.[field] ?? ""
      // Normalize array fields for backwards compatibility with old string-format data
      if (FloatingWidget.ARRAY_FIELDS.has(field)) {
        return FloatingWidget.normalizeArrayVal(val)
      }
      return val
    }
    return ""
  }

  private syncFormFromSettings(): void {
    if (!this.settings) return
    const site = this.settings.perSite[this.siteId]

    if (site) {
      this.syncTagInputFromSettings(site.search.searchTerms)
      const fnEl = this.formContainer.querySelector(".sos-resume-filename")
      if (fnEl && site.additional.resumeFileName) fnEl.textContent = site.additional.resumeFileName
    }

    this.formContainer.querySelectorAll<HTMLElement>("[data-checkbox-group]").forEach((group) => {
      const path = group.getAttribute("data-checkbox-group")!
      const val = this.getValueByPath(path)
      const arr = Array.isArray(val) ? val as string[] : []
      group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
        cb.checked = arr.includes(cb.value)
      })
    })

    this.formContainer.querySelectorAll<HTMLElement>("[data-path]:not([data-tag-container])").forEach((el) => {
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "file") return
      const path = el.getAttribute("data-path")!
      const val = this.getValueByPath(path)
      this.setFieldValue(el as HTMLInputElement, val, path)
    })
  }

  private setFieldValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, val: unknown, path?: string): void {
    if (path?.endsWith("customAnswers") && typeof val === "object" && val !== null) {
      el.value = Object.entries(val as Record<string, string>).map(([q, a]) => `${q},${a}`).join("\n")
      return
    }
    if (el.type === "checkbox") {
      (el as HTMLInputElement).checked = Boolean(val)
    } else if (Array.isArray(val)) {
      el.value = val.join(", ")
    } else {
      el.value = val != null ? String(val) : ""
    }
  }

  /* ================================================================ */
  /*  Sync: Form → Settings                                          */
  /* ================================================================ */

  /** Fields that are typed as string[] but entered as comma-separated text in the UI. */
  private static readonly ARRAY_FIELDS = new Set([
    "aboutCompanyBadWords", "aboutCompanyGoodWords", "badWords", "companies",
  ])

  private static readonly TYPE_MAP: Record<string, "num" | "bool"> = {
    clickGap: "num", switchNumber: "num", desiredSalary: "num", currentCtc: "num",
    noticePeriod: "num", currentExperience: "num",
    randomizeSearchOrder: "bool", easyApplyOnly: "bool", under10Applicants: "bool",
    inYourNetwork: "bool", fairChanceEmployer: "bool", pauseAfterFilters: "bool",
    securityClearance: "bool", didMasters: "bool",
    pauseBeforeSubmit: "bool", pauseAtFailedQuestion: "bool", overwritePreviousAnswers: "bool",
    closeTabs: "bool", followCompanies: "bool", runNonStop: "bool", runInBackground: "bool",
    alternateSortby: "bool", cycleDatePosted: "bool", stopDateCycleAt24hr: "bool",
    smoothScroll: "bool", keepScreenAwake: "bool", autoFillScreeningQuestions: "bool",
  }

  private setValueByPath(path: string, value: string): void {
    const parts = path.split(".")
    const field = parts[2]
    const type = FloatingWidget.TYPE_MAP[field] ?? "str"

    let typed: string | number | boolean | string[] = value
    if (type === "num") typed = parseFloat(value) || 0
    else if (type === "bool") typed = value === "true"
    else if (FloatingWidget.ARRAY_FIELDS.has(field)) {
      typed = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    }

    if (path.startsWith("global.")) {
      const section = parts[1] as keyof GlobalSettings
      const obj = this.settings.global[section] as unknown as Record<string, unknown>
      obj[field] = typed
      return
    }

    if (path.startsWith("site.")) {
      const section = parts[1] as keyof SiteSettings
      let site = this.settings.perSite[this.siteId]
      if (!site) {
        site = structuredClone(DEFAULT_SITE) as SiteSettings
        this.settings.perSite[this.siteId] = site
      }
      const obj = site[section] as unknown as Record<string, unknown>
      obj[field] = typed
    }
  }

  private gatherFormIntoSettings(): void {
    if (!this.settings) return

    const site = this.settings.perSite[this.siteId]
    if (site) site.search.searchTerms = this.gatherTagInput()

    this.formContainer.querySelectorAll<HTMLElement>("[data-checkbox-group]").forEach((group) => {
      const path = group.getAttribute("data-checkbox-group")!
      if (!path.startsWith("site.")) return
      const [, section, field] = path.split(".")
      const site_ = this.settings.perSite[this.siteId]
      if (!site_) return
      const obj = site_[section as keyof SiteSettings] as unknown as Record<string, unknown>
      obj[field] = [...group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((cb) => cb.value)
    })

    this.formContainer.querySelectorAll<HTMLElement>("[data-path]:not([data-tag-container])").forEach((el) => {
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "file") return
      const path = el.getAttribute("data-path")!

      if (path.endsWith("customAnswers")) {
        const site_ = this.settings.perSite[this.siteId]
        if (site_) {
          site_.additional.customAnswers = Object.fromEntries(
            (el as HTMLTextAreaElement).value.split("\n").filter(Boolean).map((line) => {
              const idx = line.indexOf(",")
              return idx > 0 ? [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as const : null
            }).filter(Boolean) as [string, string][]
          )
        }
        return
      }

      const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      this.setValueByPath(path, input.type === "checkbox" ? String((input as HTMLInputElement).checked) : input.value)
    })
  }

  /* ================================================================ */
  /*  State management                                                */
  /* ================================================================ */

  private handleClickOutside(e: MouseEvent): void {
    if (this.expandedEl.classList.contains("hidden") || this.state === "running" || this.state === "starting" || this.state === "paused") return
    if (!this.container.contains(e.target as Node)) this.collapse()
  }

  setState(state: SiteWidgetState): void {
    if (!canTransition(this.state, state)) {
      console.warn(`[SOS] Invalid state transition: ${this.state} → ${state}`)
      return
    }
    console.log(`[SOS] State: ${this.state} → ${state}`)
    this.state = state
    this.toggleBtn.className = `sos-toggle-btn sos-toggle-btn--${state}`
    this.toggleDot.className = `sos-toggle-dot sos-toggle-dot--${state}`

    switch (state) {
      case "nav":
        this.navBtn.classList.remove("hidden")
        this.toggleBtn.classList.add("hidden")
        this.toggleLabel.textContent = "Start"
        this.toggleBtn.disabled = false
        this.clearPauseControls()
        this.clearError()
        this.clearProgress()
        break
      case "idle":
        this.navBtn.classList.add("hidden")
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Start"
        this.toggleBtn.disabled = true
        this.clearPauseControls()
        this.clearError()
        this.clearProgress()
        break

      case "needsInfo":
        this.navBtn.classList.add("hidden")
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Start"
        this.toggleBtn.disabled = true
        break
      case "ready":
        this.navBtn.classList.add("hidden")
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Start"
        this.toggleBtn.disabled = false
        this.clearPauseControls()
        this.clearError()
        this.clearProgress()
        break
      case "starting":

        this.navBtn.classList.add("hidden")
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Starting"
        this.toggleBtn.disabled = true
        break
      case "running":
        this.navBtn.classList.add("hidden")
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Running"
        this.toggleBtn.disabled = false
        this.clearPauseControls()
        break
      case "paused":
        this.navBtn.classList.add("hidden")
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Paused"
        this.toggleBtn.disabled = true
        break
      case "stopped":
        this.navBtn.classList.add("hidden")
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Stopped"
        this.toggleBtn.disabled = true
        this.clearPauseControls()
        break
      case "done":
        this.navBtn.classList.add("hidden")
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Done ✓"
        this.toggleBtn.disabled = true
        this.clearPauseControls()
        this.clearError()
        this.clearProgress()
        break
      case "error":
        this.navBtn.classList.add("hidden")
        this.toggleBtn.classList.remove("hidden")
        this.toggleLabel.textContent = "Error"
        this.toggleBtn.disabled = false
        this.clearPauseControls()
        this.clearProgress()
        break

    }

    // Persist state
    saveSiteState(this.siteId, { state, lastUpdated: Date.now(), error: this.errMsg ?? undefined })
  }

  private showPauseControls(): void {
    this.pauseControlsEl.classList.remove("hidden")
  }

  private clearPauseControls(): void {
    this.pauseControlsEl.classList.add("hidden")
  }

  private showError(msg: string): void {
    this.clearError()
    const banner = document.createElement("div")
    banner.className = "sos-error-banner"
    banner.setAttribute("data-error-banner", "")
    banner.innerHTML = `<div class="sos-error-title">Pipeline Error</div><div class="sos-error-message">${msg}</div>`
    this.formContainer.prepend(banner)
  }

  private clearError(): void {
    this.formContainer.querySelector("[data-error-banner]")?.remove()
  }

  private async handleToggle(): Promise<void> {
    if (this.state === "nav") {
      this.options.onNavigate?.()
      return
    }

    if (this.state === "idle" || this.state === "needsInfo") {
      await this.persistAndRefresh()
      const missing = settingsManager.getMissingMandatoryFields(this.siteId)
      if (missing.length === 0) {
        this.startPipeline()
      } else {
        this.setState("needsInfo")
        this.showValidationErrors(missing)
        this.expandSectionsWithMissing(missing)
      }
      return
    }

    if (this.state === "running") {
      this.handleStop()
      return
    }

    if (this.state === "ready" || this.state === "error") {

      this.startPipeline()
      return
    }

    console.warn(`[SOS] Toggle ignored in state: ${this.state}`)
  }

  /**
   * Stop triggered by user clicking the toggle button while state = running.
   * The pipeline catch block will also call setStopped(), but setStopped()
   * is idempotent so the second call is harmless.
   */
  private handleStop(): void {
    this.options.onStop?.()
    this.toggleLabel.textContent = "Stopping..."
  }

  private handleResume(): void {
    if (this.state !== "paused") return
    this.setState("running")
    this.jobStatusLine.textContent = ""
    this.options.onResume?.()
  }

  private startPipeline(): void {
    this.active = true
    this.jobStatusLine.textContent = ""
    this.clearValidationErrors()
    this.clearError()
    this.setState("starting")
    this.options.onToggle?.(true)
  }

  private showValidationErrors(missing: { section: string; field: string; label: string }[]): void {
    this.clearValidationErrors()

    const banner = document.createElement("div")
    banner.className = "sos-validation-banner"
    banner.setAttribute("data-validation-banner", "")

    const title = document.createElement("div")
    title.className = "sos-validation-title"
    title.textContent = "Please complete the following required fields:"

    const list = document.createElement("ul")
    list.className = "sos-validation-list"
    for (const item of missing) {
      const li = document.createElement("li")
      li.textContent = item.label
      li.setAttribute("data-section-ref", item.section)
      li.addEventListener("click", () => {
        const header = this.formContainer.querySelector(`[data-section="${item.section}"]`)
        if (!header) return
        const section = header.closest(".sos-section")
        if (!section) return
        const body = section.querySelector(".sos-section-body") as HTMLElement
        const arrow = header.querySelector(".sos-section-arrow") as HTMLElement
        body.classList.remove("hidden")
        section.classList.add("sos-section-open")
        if (arrow) arrow.textContent = "▼"
        section.classList.add("sos-section-highlight")
        setTimeout(() => section.classList.remove("sos-section-highlight"), 2000)
      })
      list.appendChild(li)
    }

    banner.appendChild(title)
    banner.appendChild(list)

    const firstSection = this.formContainer.querySelector(".sos-section")
    if (firstSection) this.formContainer.insertBefore(banner, firstSection)
    else this.formContainer.prepend(banner)

    banner.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  private clearValidationErrors(): void {
    this.formContainer.querySelector("[data-validation-banner]")?.remove()
  }

  private expandSectionsWithMissing(missing: { section: string; field: string; label: string }[]): void {
    const sectionNames = new Set(missing.map((m) => m.section))
    this.formContainer.querySelectorAll(".sos-section").forEach((section) => {
      const header = section.querySelector(".sos-section-header")
      const body = section.querySelector(".sos-section-body") as HTMLElement
      const arrow = header?.querySelector(".sos-section-arrow") as HTMLElement
      const secName = header?.getAttribute("data-section") || ""
      if (sectionNames.has(secName)) {
        body.classList.remove("hidden")
        section.classList.add("sos-section-open")
        if (arrow) arrow.textContent = "▼"
        section.classList.add("sos-section-highlight")
        setTimeout(() => section.classList.remove("sos-section-highlight"), 2000)
      } else {
        body.classList.add("hidden")
        section.classList.remove("sos-section-open")
        if (arrow) arrow.textContent = "▶"
      }
    })
  }

  expand(): void {
    this.expandedEl.classList.remove("hidden")
    this.collapsedEl.classList.add("hidden")
  }

  collapse(): void {
    this.expandedEl.classList.add("hidden")
    this.collapsedEl.classList.remove("hidden")
  }

  destroy(): void {
    document.removeEventListener("click", this.boundClickOutside)
    this.container.remove()
  }
}
