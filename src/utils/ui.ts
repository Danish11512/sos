import type { FloatingWidgetOptions, WidgetState } from "../types/ui"
import type {
  AppSettings,
  GlobalSettings,
  SiteSettings,
} from "../types/settings"
import { areSiteSettingsReady, DEFAULT_APP_SETTINGS } from "../types/settings"
import { DEFAULT_FILTERS } from "../settings/filters"
import { DEFAULT_ANSWERS } from "../settings/answers"
import { DEFAULT_PIPELINE } from "../settings/pipeline"
import { DEFAULT_ADDITIONAL } from "../settings/additional"
import { loadSettings, saveSettings } from "./storage"
import css from "../styles/ui.css?raw"

/**
 * Floating UI widget injected into the page with Shadow DOM isolation.
 *
 * State machine: idle → ready → running → done
 *
 * NOTE: UI only — logical hooks are in place but actual pipeline logic is not implemented.
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

  private options: FloatingWidgetOptions
  private settings!: AppSettings
  private siteId: string

  constructor(options: FloatingWidgetOptions) {
    this.options = options
    this.siteId = options.siteId
    this.container = document.createElement("div")
    this.container.id = "sos-floating-widget"

    this.shadow = this.container.attachShadow({ mode: "closed" })

    this.injectStyles()
    this.buildUI(options)

    if (options.initialState) {
      this.setState(options.initialState)
    }

    document.body.appendChild(this.container)

    this.boundClickOutside = this.handleClickOutside.bind(this)
    requestAnimationFrame(() => {
      document.addEventListener("click", this.boundClickOutside)
    })

    this.loadAndSync()
  }

  private injectStyles(): void {
    const style = document.createElement("style")
    style.textContent = css
    this.shadow.appendChild(style)
  }

  /* ------------------------------------------------------------------ */
  /*  Settings I/O                                                       */
  /* ------------------------------------------------------------------ */

  private async loadAndSync(): Promise<void> {
    this.settings = await loadSettings()
    this.syncFormFromSettings()
    this.refreshState()
  }

  private async persistAndRefresh(): Promise<void> {
    this.gatherFormIntoSettings()
    await saveSettings(this.settings)
    this.refreshState()
  }

  private refreshState(): void {
    const site = this.settings.perSite[this.siteId]
    const ready = areSiteSettingsReady(this.settings.global, site)
    const newState = ready ? "ready" : "idle"
    if (this.state !== "running" && this.state !== "done") {
      this.setState(newState)
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Build UI                                                           */
  /* ------------------------------------------------------------------ */

  private buildUI(options: FloatingWidgetOptions): void {
    // Expanded
    this.expandedEl = document.createElement("div")
    this.expandedEl.className = "sos-expanded"

    const header = document.createElement("div")
    header.className = "sos-header"

    const nameEl = document.createElement("span")
    nameEl.className = "sos-site-name"
    nameEl.textContent = options.siteName
    header.appendChild(nameEl)

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

    const panel = document.createElement("div")
    panel.className = "sos-panel"

    this.buildSettingsForm(panel)

    this.expandedEl.appendChild(panel)
    this.shadow.appendChild(this.expandedEl)

    // Collapsed badge
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
  /*  Settings Form  [UI ONLY]                                           */
  /* ------------------------------------------------------------------ */

  private formContainer!: HTMLElement

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
          <label>Current City<input class="sos-fld" data-path="global.personal.currentCity" type="text" placeholder="Los Angeles"></label>
          <label>Street<input class="sos-fld" data-path="global.personal.street" type="text" placeholder="123 Main St"></label>
          <label>State<input class="sos-fld" data-path="global.personal.state" type="text" placeholder="CA"></label>
          <label>Zip Code<input class="sos-fld" data-path="global.personal.zipcode" type="text" placeholder="12345"></label>
          <label>Country<input class="sos-fld" data-path="global.personal.country" type="text" placeholder="United States"></label>
        </div>
      </div>

      <div class="sos-section">
        <div class="sos-section-header" data-section="eeo">
          <span class="sos-section-title">EEO / Diversity</span>
          <span class="sos-section-arrow">▶</span>
        </div>
        <div class="sos-section-body hidden">
          <label>Ethnicity
            <select class="sos-fld" data-path="global.eeo.ethnicity">
              <option value="Decline">Decline</option>
              <option value="Hispanic/Latino">Hispanic/Latino</option>
              <option value="American Indian or Alaska Native">American Indian or Alaska Native</option>
              <option value="Asian">Asian</option>
              <option value="Black or African American">Black or African American</option>
              <option value="Native Hawaiian or Other Pacific Islander">Native Hawaiian or Other Pacific Islander</option>
              <option value="White">White</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label>Gender
            <select class="sos-fld" data-path="global.eeo.gender">
              <option value="Decline">Decline</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label>Disability Status
            <select class="sos-fld" data-path="global.eeo.disabilityStatus">
              <option value="Decline">Decline</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </label>
          <label>Veteran Status
            <select class="sos-fld" data-path="global.eeo.veteranStatus">
              <option value="Decline">Decline</option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </label>
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
          <label>Sort By
            <select class="sos-fld" data-path="site.filters.sortBy">
              <option value="">—</option>
              <option value="Most recent">Most recent</option>
              <option value="Most relevant">Most relevant</option>
            </select>
          </label>
          <label>Date Posted
            <select class="sos-fld" data-path="site.filters.datePosted">
              <option value="">—</option>
              <option value="Any time">Any time</option>
              <option value="Past month">Past month</option>
              <option value="Past week">Past week</option>
              <option value="Past 24 hours">Past 24 hours</option>
            </select>
          </label>
          <label>Salary
            <select class="sos-fld" data-path="site.filters.salary">
              <option value="">—</option>
              <option value="$40,000+">$40,000+</option>
              <option value="$60,000+">$60,000+</option>
              <option value="$80,000+">$80,000+</option>
              <option value="$100,000+">$100,000+</option>
              <option value="$120,000+">$120,000+</option>
              <option value="$140,000+">$140,000+</option>
              <option value="$160,000+">$160,000+</option>
              <option value="$180,000+">$180,000+</option>
              <option value="$200,000+">$200,000+</option>
            </select>
          </label>
          <label class="sos-label-toggle">
            <span>Easy Apply Only</span>
            <input class="sos-fld sos-toggle-input" data-path="site.filters.easyApplyOnly" type="checkbox">
          </label>
          <div class="sos-label-sub">Experience Level <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.experienceLevel" type="text" placeholder="Internship, Entry level, Associate, ...">
          <div class="sos-label-sub">Job Type <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.jobType" type="text" placeholder="Full-time, Contract, ...">
          <div class="sos-label-sub">On-site / Remote <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.onSite" type="text" placeholder="On-site, Remote, Hybrid">
          <div class="sos-label-sub">Companies <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.companies" type="text" placeholder="Google, Meta, Apple, ...">
          <div class="sos-label-sub">Location <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.location" type="text" placeholder="United States, Remote, ...">
          <div class="sos-label-sub">Industry <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.industry" type="text" placeholder="Technology, Finance, ...">
          <div class="sos-label-sub">Job Function <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.jobFunction" type="text" placeholder="Engineering, Product, ...">
          <div class="sos-label-sub">Job Titles <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.jobTitles" type="text" placeholder="Software Engineer, ...">
          <div class="sos-label-sub">Benefits <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.benefits" type="text" placeholder="401k, Health Insurance, ...">
          <div class="sos-label-sub">Commitments <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.commitments" type="text" placeholder="Full-time, Contract, ...">
          <label>Switch #<input class="sos-fld" data-path="site.search.switchNumber" type="number" min="1" placeholder="30"></label>
          <label class="sos-label-toggle">
            <span>Randomize Search Order</span>
            <input class="sos-fld sos-toggle-input" data-path="site.search.randomizeSearchOrder" type="checkbox">
          </label>
          <label class="sos-label-toggle">
            <span>Under 10 Applicants</span>
            <input class="sos-fld sos-toggle-input" data-path="site.filters.under10Applicants" type="checkbox">
          </label>
          <label class="sos-label-toggle">
            <span>In Your Network</span>
            <input class="sos-fld sos-toggle-input" data-path="site.filters.inYourNetwork" type="checkbox">
          </label>
          <label class="sos-label-toggle">
            <span>Fair Chance Employer</span>
            <input class="sos-fld sos-toggle-input" data-path="site.filters.fairChanceEmployer" type="checkbox">
          </label>
          <label class="sos-label-toggle">
            <span>Pause After Filters</span>
            <input class="sos-fld sos-toggle-input" data-path="site.filters.pauseAfterFilters" type="checkbox">
          </label>
          <hr class="sos-separator">
          <div class="sos-label-sub">Skip: Bad Words in Company About <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.aboutCompanyBadWords" type="text" placeholder="Staffing, Recruiting, ...">
          <div class="sos-label-sub">Skip: Bad Words for These Exceptions <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.aboutCompanyGoodWords" type="text" placeholder="Robert Half, ...">
          <div class="sos-label-sub">Skip: Bad Words in Job Description <span class="sos-hint">(comma-separated)</span></div>
          <input class="sos-fld" data-path="site.filters.badWords" type="text" placeholder="US Citizen, No C2C, ...">
          <hr class="sos-separator">
          <label>Current Experience (years)
            <input class="sos-fld" data-path="site.filters.currentExperience" type="number" min="-1" placeholder="-1 (apply to all)">
          </label>
          <label class="sos-label-toggle">
            <span>Security Clearance</span>
            <input class="sos-fld sos-toggle-input" data-path="site.filters.securityClearance" type="checkbox">
          </label>
          <label class="sos-label-toggle">
            <span>Has Master's Degree</span>
            <input class="sos-fld sos-toggle-input" data-path="site.filters.didMasters" type="checkbox">
          </label>
        </div>
      </div>

      <div class="sos-section">
        <div class="sos-section-header" data-section="answers">
          <span class="sos-section-title">Application Answers</span>
          <span class="sos-section-arrow">▶</span>
        </div>
        <div class="sos-section-body hidden">
          <label>Years of Experience<input class="sos-fld" data-path="site.answers.yearsOfExperience" type="text" placeholder="5"></label>
          <label>Require Visa
            <select class="sos-fld" data-path="site.answers.requireVisa">
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </label>
          <label>Portfolio / Website<input class="sos-fld" data-path="site.answers.website" type="text" placeholder="https://..."></label>
          <label>LinkedIn URL<input class="sos-fld" data-path="site.answers.linkedIn" type="text" placeholder="https://linkedin.com/in/..."></label>
          <label>US Citizenship
            <select class="sos-fld" data-path="site.answers.usCitizenship">
              <option value="">—</option>
              <option value="U.S. Citizen/Permanent Resident">U.S. Citizen/Permanent Resident</option>
              <option value="Non-citizen allowed to work for any employer">Non-citizen allowed to work for any employer</option>
              <option value="Non-citizen allowed to work for current employer">Non-citizen allowed to work for current employer</option>
              <option value="Non-citizen seeking work authorization">Non-citizen seeking work authorization</option>
              <option value="Canadian Citizen/Permanent Resident">Canadian Citizen/Permanent Resident</option>
              <option value="Other">Other</option>
            </select>
          </label>
          <label>Desired Salary<input class="sos-fld" data-path="site.answers.desiredSalary" type="number" placeholder="120000"></label>
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
          <span class="sos-section-title">Pipeline Controls</span>
          <span class="sos-section-arrow">▶</span>
        </div>
        <div class="sos-section-body hidden">
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
        <div class="sos-section-header" data-section="global">
          <span class="sos-section-title">Global Behavior</span>
          <span class="sos-section-arrow">▶</span>
        </div>
        <div class="sos-section-body hidden">
          <label>Click Gap (sec)<input class="sos-fld" data-path="global.globalBehavior.clickGap" type="number" min="0" step="0.5" placeholder="1"></label>
          <label class="sos-label-toggle"><span>Smooth Scroll</span><input class="sos-fld sos-toggle-input" data-path="global.globalBehavior.smoothScroll" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Keep Screen Awake</span><input class="sos-fld sos-toggle-input" data-path="global.globalBehavior.keepScreenAwake" type="checkbox"></label>
          <label class="sos-label-toggle"><span>Stealth Mode</span><input class="sos-fld sos-toggle-input" data-path="global.globalBehavior.stealthMode" type="checkbox"></label>
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
            <input class="sos-fld sos-resume-input" data-path="site.additional.resumeData" type="file" accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,text/plain">
            <span class="sos-resume-filename" data-path="site.additional.resumeFileName"></span>
          </div>
          <div class="sos-label-sub">Custom Answers <span class="sos-hint">(question,answer per line)</span></div>
          <textarea class="sos-fld sos-textarea sos-custom-answers-input" data-path="site.additional.customAnswers" placeholder="What is your desired salary?,120000&#10;Are you authorized to work in the US?,Yes"></textarea>
        </div>
      </div>

      <div class="sos-section-footer">
        <button class="sos-save-btn">Save Settings</button>
      </div>
    `

    // Accordion logic
    container.querySelectorAll(".sos-section-header").forEach((header) => {
      header.addEventListener("click", (e) => {
        e.stopPropagation()
        const section = (header as HTMLElement).closest(".sos-section")!
        const body = section.querySelector(".sos-section-body") as HTMLElement
        const arrow = header.querySelector(".sos-section-arrow") as HTMLElement
        const isOpen = !body.classList.contains("hidden")
        body.classList.toggle("hidden", isOpen)
        section.classList.toggle("sos-section-open", !isOpen)
        arrow.textContent = isOpen ? "▶" : "▼"
      })
    })

    this.initTagInput()

    // Auto-save on change
    container.querySelectorAll<HTMLElement>(".sos-fld").forEach((el) => {
      el.addEventListener("change", () => this.persistAndRefresh())
      if (
        el.tagName === "INPUT" &&
        (el as HTMLInputElement).type !== "checkbox" &&
        !el.classList.contains("sos-tag-text-input")
      ) {
        el.addEventListener("blur", () => this.persistAndRefresh())
      }
      if (el.tagName === "TEXTAREA" && !el.classList.contains("sos-custom-answers-input")) {
        el.addEventListener("blur", () => this.persistAndRefresh())
      }
    })

    // Resume file upload handler
    const resumeInput = container.querySelector(".sos-resume-input") as HTMLInputElement
    if (resumeInput) {
      resumeInput.addEventListener("change", (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          if (this.settings) {
            const site = this.settings.perSite[this.siteId]
            if (site) {
              site.additional.resumeData = dataUrl
              site.additional.resumeFileName = file.name
              const fnEl = this.formContainer.querySelector(".sos-resume-filename")
              if (fnEl) fnEl.textContent = file.name
              this.persistAndRefresh()
            }
          }
        }
        reader.readAsDataURL(file)
      })
    }

    const saveBtn = container.querySelector(".sos-save-btn")!
    saveBtn.addEventListener("click", (e) => {
      e.stopPropagation()
      this.persistAndRefresh()
      saveBtn.textContent = "Saved ✓"
      setTimeout(() => { saveBtn.textContent = "Save Settings" }, 1500)
    })
  }

  /* ------------------------------------------------------------------ */
  /*  Tag Input                                                          */
  /* ------------------------------------------------------------------ */

  private initTagInput(): void {
    const wrapper = this.formContainer.querySelector(".sos-tag-input-wrapper")
    if (!wrapper) return
    const tagList = wrapper.querySelector(".sos-tag-list") as HTMLElement
    const textInput = wrapper.querySelector(".sos-tag-text-input") as HTMLInputElement

    const addTag = (term: string) => {
      const trimmed = term.trim()
      if (!trimmed) return
      const existingTags: string[] = []
      tagList.querySelectorAll(".sos-tag").forEach((tagEl) => {
        const t = tagEl.querySelector(".sos-tag-text")
        if (t) existingTags.push(t.textContent || "")
      })
      if (existingTags.includes(trimmed)) return
      const tag = document.createElement("span")
      tag.className = "sos-tag"
      tag.innerHTML = `<span class="sos-tag-text">${this.escapeHtml(trimmed)}</span><span class="sos-tag-remove" role="button" tabindex="0">&times;</span>`
      tag.querySelector(".sos-tag-remove")!.addEventListener("click", (e) => {
        e.stopPropagation()
        tag.remove()
        this.persistAndRefresh()
      })
      tagList.appendChild(tag)
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

  private escapeHtml(text: string): string {
    const div = document.createElement("div")
    div.textContent = text
    return div.innerHTML
  }

  private syncTagInputFromSettings(terms: string[]): void {
    const tagList = this.formContainer.querySelector(".sos-tag-list") as HTMLElement
    if (!tagList) return
    tagList.innerHTML = ""
    terms.forEach((term) => {
      const tag = document.createElement("span")
      tag.className = "sos-tag"
      tag.innerHTML = `<span class="sos-tag-text">${this.escapeHtml(term)}</span><span class="sos-tag-remove" role="button" tabindex="0">&times;</span>`
      tag.querySelector(".sos-tag-remove")!.addEventListener("click", (e) => {
        e.stopPropagation()
        tag.remove()
        this.persistAndRefresh()
      })
      tagList.appendChild(tag)
    })
  }

  private gatherTagInput(): string[] {
    const tagList = this.formContainer.querySelector(".sos-tag-list") as HTMLElement
    if (!tagList) return []
    const terms: string[] = []
    tagList.querySelectorAll(".sos-tag").forEach((tagEl) => {
      const t = tagEl.querySelector(".sos-tag-text")
      if (t) terms.push(t.textContent || "")
    })
    return terms
  }

  /* ------------------------------------------------------------------ */
  /*  Sync: Settings → Form                                              */
  /* ------------------------------------------------------------------ */

  /**
   * Get a value from the settings tree using a dot-path like "global.personal.firstName"
   * or "site.search.searchTerms".
   */
  private getValueByPath(path: string): unknown {
    if (!this.settings) return ""
    const site = this.settings.perSite[this.siteId]

    // "global.xxx.yyy"
    if (path.startsWith("global.")) {
      const parts = path.split(".")
      const section = parts[1] as keyof GlobalSettings
      const field = parts[2]
      const obj = this.settings.global[section] as unknown as Record<string, unknown>
      return obj?.[field] ?? ""
    }

    // "site.xxx.yyy"
    if (path.startsWith("site.") && site) {
      const parts = path.split(".")
      const section = parts[1] as keyof SiteSettings
      const field = parts[2]
      const obj = site[section] as unknown as Record<string, unknown>
      return obj?.[field] ?? ""
    }

    return ""
  }

  private syncFormFromSettings(): void {
    if (!this.settings) return
    const site = this.settings.perSite[this.siteId]

    // Sync search terms tag input
    if (site) {
      this.syncTagInputFromSettings(site.search.searchTerms)
    }

    // Sync resume filename (span, not a form field)
    if (site) {
      const fnEl = this.formContainer.querySelector(".sos-resume-filename")
      if (fnEl && site.additional.resumeFileName) {
        fnEl.textContent = site.additional.resumeFileName
      }
    }

    // Sync all data-path fields
    this.formContainer
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "[data-path]"
      )
      .forEach((el) => {
        const path = el.getAttribute("data-path")!
        const val = this.getValueByPath(path)
        this.setFieldValue(el, val, path)
      })
  }

  private setFieldValue(
    el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    val: unknown,
    path?: string
  ): void {
    // CustomAnswers is a Record<string,string> — render as CSV lines
    if (path?.endsWith("customAnswers") && typeof val === "object" && val !== null) {
      el.value = Object.entries(val as Record<string, string>)
        .map(([q, a]) => `${q},${a}`)
        .join("\n")
      return
    }

    if (el.type === "checkbox") {
      (el as HTMLInputElement).checked = Boolean(val)
    } else if (Array.isArray(val)) {
      el.value = val.join(", ")
    } else if (val != null) {
      el.value = String(val)
    } else {
      el.value = ""
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Sync: Form → Settings                                              */
  /* ------------------------------------------------------------------ */

  private setValueByPath(path: string, raw: { string: string; number: number; boolean: boolean }): void {
    // "global.xxx.yyy"
    if (path.startsWith("global.")) {
      const parts = path.split(".")
      const section = parts[1] as keyof GlobalSettings
      const field = parts[2]
      const obj = this.settings.global[section] as unknown as Record<string, unknown>
      const dim = this.dimension(field)
      obj[field] = dim === "num" ? raw.number : dim === "bool" ? raw.boolean : raw.string
      return
    }

    // "site.xxx.yyy"
    if (path.startsWith("site.")) {
      const parts = path.split(".")
      const section = parts[1] as keyof SiteSettings
      const field = parts[2]
      let site = this.settings.perSite[this.siteId]
      if (!site) {
        site = {
          search: { searchTerms: [], searchLocation: "", switchNumber: 30, randomizeSearchOrder: false },
          filters: DEFAULT_FILTERS,
          answers: DEFAULT_ANSWERS,
          pipeline: DEFAULT_PIPELINE,
          additional: DEFAULT_ADDITIONAL,
        }
        this.settings.perSite[this.siteId] = site
      }
      const obj = site[section] as unknown as Record<string, unknown>
      const dim = this.dimension(field)
      obj[field] = dim === "num" ? raw.number : dim === "bool" ? raw.boolean : raw.string
      return
    }
  }

  /** Determine the type dimension of a field by name convention */
  private dimension(field: string): "str" | "num" | "bool" {
    const nums = [
      "clickGap", "switchNumber", "desiredSalary", "currentCtc", "noticePeriod",
      "currentExperience",
    ]
    const bools = [
      "randomizeSearchOrder", "easyApplyOnly", "under10Applicants",
      "inYourNetwork", "fairChanceEmployer", "pauseAfterFilters",
      "securityClearance", "didMasters",
      "pauseBeforeSubmit", "pauseAtFailedQuestion", "overwritePreviousAnswers",
      "closeTabs", "followCompanies", "runNonStop", "runInBackground",
      "alternateSortby", "cycleDatePosted", "stopDateCycleAt24hr",
      "smoothScroll", "keepScreenAwake", "stealthMode",
      "autoFillScreeningQuestions",
    ]
    if (nums.includes(field)) return "num"
    if (bools.includes(field)) return "bool"
    return "str"
  }

  private gatherFormIntoSettings(): void {
    if (!this.settings) return

    // Gather search terms from tag input
    const site = this.settings.perSite[this.siteId]
    if (site) {
      site.search.searchTerms = this.gatherTagInput()
    }

    // Gather all data-path fields
    this.formContainer
      .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "[data-path]:not([data-tag-container])"
      )
      .forEach((el) => {
        const path = el.getAttribute("data-path")!
        // CustomAnswers — parse CSV from textarea
        if (path.endsWith("customAnswers")) {
          const site2 = this.settings.perSite[this.siteId]
          if (site2) {
            const textarea = el as HTMLTextAreaElement
            const lines = textarea.value.split("\n").filter(Boolean)
            const answers: Record<string, string> = {}
            lines.forEach((line) => {
              const commaIdx = line.indexOf(",")
              if (commaIdx > 0) {
                answers[line.slice(0, commaIdx).trim()] = line.slice(commaIdx + 1).trim()
              }
            })
            site2.additional.customAnswers = answers
          }
          return
        }
        this.setValueByPath(path, this.getFieldValue(el))
      })
  }

  private getFieldValue(
    el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  ): { string: string; number: number; boolean: boolean } {
    if (el.type === "checkbox") {
      const b = (el as HTMLInputElement).checked
      return { string: String(b), number: b ? 1 : 0, boolean: b }
    }
    if (el.type === "number") {
      const n = el.value ? parseFloat(el.value) : 0
      return { string: el.value, number: n, boolean: n !== 0 }
    }
    return {
      string: el.value,
      number: parseFloat(el.value) || 0,
      boolean: el.value !== "" && el.value !== "0" && el.value !== "false",
    }
  }

  /* ------------------------------------------------------------------ */
  /*  State management                                                   */
  /* ------------------------------------------------------------------ */

  private handleClickOutside(e: MouseEvent): void {
    if (this.expandedEl.classList.contains("hidden")) return
    if (!this.container.contains(e.target as Node)) this.collapse()
  }

  setState(state: WidgetState): void {
    this.state = state
    this.toggleBtn.classList.remove(
      "sos-toggle-btn--idle", "sos-toggle-btn--ready",
      "sos-toggle-btn--running", "sos-toggle-btn--done"
    )
    this.toggleDot.classList.remove(
      "sos-toggle-dot--idle", "sos-toggle-dot--ready",
      "sos-toggle-dot--running", "sos-toggle-dot--done"
    )

    switch (state) {
      case "idle":
        this.toggleBtn.classList.add("sos-toggle-btn--idle")
        this.toggleDot.classList.add("sos-toggle-dot--idle")
        this.toggleLabel.textContent = this.active ? "Stop" : "Start"
        this.toggleBtn.disabled = false
        break
      case "ready":
        this.toggleBtn.classList.add("sos-toggle-btn--ready")
        this.toggleDot.classList.add("sos-toggle-dot--ready")
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
    if (this.state === "idle") {
      this.expandPersonalSection()
      return
    }
    this.active = !this.active
    if (this.active) {
      this.persistAndRefresh()
      this.setState("running")
    } else {
      this.setState(this.state === "running" ? "ready" : "idle")
    }
    this.options.onToggle?.(this.active)
  }

  private expandPersonalSection(): void {
    this.formContainer.querySelectorAll(".sos-section").forEach((section) => {
      const header = section.querySelector(".sos-section-header")
      const body = section.querySelector(".sos-section-body") as HTMLElement
      const arrow = header?.querySelector(".sos-section-arrow") as HTMLElement
      const isPersonal = header?.getAttribute("data-section") === "personal"
      if (isPersonal) {
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
