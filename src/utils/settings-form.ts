/**
 * Settings form builder + DOM sync for the SOS widget.
 * Extracted from FloatingWidget for SRP + testability.
 * Lazy DOM refs — no element queries until build() called.
 */

import type { AppSettings, GlobalSettings, SiteSettings } from "../settings/sections"
import { DEFAULT_SITE } from "../settings/sections"

/* ── Typed path helpers ── */

type PathCtx = { settings: AppSettings; siteId: string }

function getValueByPath(ctx: PathCtx, path: string): unknown {
  if (path.startsWith("global.")) {
    const [, section, field] = path.split(".")
    const obj = ctx.settings.global[section as keyof GlobalSettings] as unknown as Record<string, unknown>
    return obj?.[field] ?? ""
  }
  if (path.startsWith("site.")) {
    const [, section, field] = path.split(".")
    const site = ctx.settings.perSite[ctx.siteId]
    return (site as any)?.[section]?.[field] ?? ""
  }
  return ""
}

function setValueByPath(ctx: PathCtx, path: string, rawValue: string): void {
  const parts = path.split(".")
  const field = parts[2]
  const type = SettingsForm.TYPE_MAP[field] ?? "str"

  let typed: string | number | boolean | string[] = rawValue
  if (type === "num") typed = parseFloat(rawValue) || 0
  else if (type === "bool") typed = rawValue === "true"
  else if (SettingsForm.ARRAY_FIELDS.has(field)) {
    typed = rawValue.split(",").map((s) => s.trim()).filter(Boolean)
  }

  if (path.startsWith("global.")) {
    const section = parts[1] as keyof GlobalSettings
    const obj = ctx.settings.global[section] as unknown as Record<string, unknown>
    obj[field] = typed
    return
  }

  if (path.startsWith("site.")) {
    const section = parts[1] as keyof SiteSettings
    let site = ctx.settings.perSite[ctx.siteId]
    if (!site) {
      site = structuredClone(DEFAULT_SITE) as SiteSettings
      ctx.settings.perSite[ctx.siteId] = site
    }
    const obj = (site as any)[section] as Record<string, unknown>
    obj[field] = typed
  }
}

/* ── Settings Form class ── */

export class SettingsForm {
  static readonly ARRAY_FIELDS = new Set([
    "aboutCompanyBadWords", "aboutCompanyGoodWords", "badWords", "companies",
  ])

  static readonly TYPE_MAP: Record<string, "num" | "bool"> = {
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

  private container: HTMLElement | null = null
  private ctx: PathCtx | null = null
  private resumeFileCb: ((file: File) => void) | null = null
  private changeCb: (() => void) | null = null

  /** Build the form DOM inside container. Returns self for chaining. */
  build(
    container: HTMLElement,
    deps: {
      onResumeFile: (file: File) => void
      onChange: () => void
    }
  ): this {
    this.container = container
    this.resumeFileCb = deps.onResumeFile
    this.changeCb = deps.onChange

    container.innerHTML = this.html()

    // Accordion section headers
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

    // Tag input
    this.initTagInput()

    // Field change listeners
    container.querySelectorAll<HTMLElement>(".sos-fld:not(.sos-tag-text-input)").forEach((el) => {
      el.addEventListener("change", () => deps.onChange())
    })

    // Resume file input
    const resumeInput = container.querySelector(".sos-resume-input") as HTMLInputElement
    resumeInput?.addEventListener("change", (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file && this.resumeFileCb) {
        this.resumeFileCb(file)
      }
    })

    return this
  }

  /** Set the settings context for sync operations. */
  setCtx(settings: AppSettings, siteId: string): void {
    this.ctx = { settings, siteId }
  }

  /** Sync settings → form fields. */
  syncFromSettings(): void {
    if (!this.container || !this.ctx) return
    const { settings, siteId } = this.ctx

    // Tag input
    const site = settings.perSite[siteId]
    this.syncTagInput(site?.search?.searchTerms ?? [])

    // Resume filename
    const fnEl = this.container.querySelector(".sos-resume-filename")
    if (fnEl && site?.additional.resumeFileName) fnEl.textContent = site.additional.resumeFileName

    // Checkbox groups
    this.container.querySelectorAll<HTMLElement>("[data-checkbox-group]").forEach((group) => {
      const path = group.getAttribute("data-checkbox-group")!
      const val = this.getValueByPath(path)
      const arr = Array.isArray(val) ? (val as string[]) : []
      group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((cb) => {
        cb.checked = arr.includes(cb.value)
      })
    })

    // Regular fields
    this.container.querySelectorAll<HTMLElement>("[data-path]:not([data-tag-container])").forEach((el) => {
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "file") return
      const path = el.getAttribute("data-path")!
      const val = this.getValueByPath(path)
      this.setFieldValue(el as HTMLInputElement, val, path)
    })
  }

  /** Sync form → settings (mutates ctx.settings in place). */
  gatherIntoSettings(): void {
    if (!this.container || !this.ctx) return
    const { settings, siteId } = this.ctx

    const site = settings.perSite[siteId]
    if (site) site.search.searchTerms = this.gatherTagInput()

    // Checkbox groups
    this.container.querySelectorAll<HTMLElement>("[data-checkbox-group]").forEach((group) => {
      const path = group.getAttribute("data-checkbox-group")!
      if (!path.startsWith("site.")) return
      const [, section, field] = path.split(".")
      const site_ = settings.perSite[siteId]
      if (!site_) return
      const obj = (site_ as any)[section] as Record<string, unknown>
      obj[field] = [...group.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((cb) => cb.value)
    })

    // Regular fields
    this.container.querySelectorAll<HTMLElement>("[data-path]:not([data-tag-container])").forEach((el) => {
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "file") return
      const path = el.getAttribute("data-path")!

      if (path.endsWith("customAnswers")) {
        const site_ = settings.perSite[siteId]
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

  /** Show validation error banner. Returns banner element. */
  showValidationBanner(missing: { section: string; field: string; label: string }[]): HTMLElement {
    this.clearValidationBanner()
    if (!this.container) return document.createElement("div")

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
      li.addEventListener("click", () => this.openSection(item.section))
      list.appendChild(li)
    }

    banner.appendChild(title)
    banner.appendChild(list)

    const firstSection = this.container.querySelector(".sos-section")
    if (firstSection) this.container.insertBefore(banner, firstSection)
    else this.container.prepend(banner)

    banner.scrollIntoView({ behavior: "smooth", block: "center" })
    return banner
  }

  clearValidationBanner(): void {
    this.container?.querySelector("[data-validation-banner]")?.remove()
  }

  /** Show error banner. */
  showErrorBanner(msg: string): void {
    this.clearErrorBanner()
    if (!this.container) return
    const banner = document.createElement("div")
    banner.className = "sos-error-banner"
    banner.setAttribute("data-error-banner", "")
    banner.innerHTML = `<div class="sos-error-title">Pipeline Error</div><div class="sos-error-message">${msg}</div>`
    this.container.prepend(banner)
  }

  clearErrorBanner(): void {
    this.container?.querySelector("[data-error-banner]")?.remove()
  }

  /** Expand sections that have missing fields. */
  expandSectionsWithMissing(missing: { section: string }[]): void {
    if (!this.container) return
    const sectionNames = new Set(missing.map((m) => m.section))
    this.container.querySelectorAll(".sos-section").forEach((section) => {
      const header = section.querySelector(".sos-section-header")
      const body = section.querySelector(".sos-section-body") as HTMLElement
      const arrow = header?.querySelector(".sos-section-arrow") as HTMLElement
      const secName = header?.getAttribute("data-section") || ""
      if (sectionNames.has(secName)) {
        body?.classList.remove("hidden")
        section.classList.add("sos-section-open")
        if (arrow) arrow.textContent = "▼"
        section.classList.add("sos-section-highlight")
        setTimeout(() => section.classList.remove("sos-section-highlight"), 2000)
      } else {
        body?.classList.add("hidden")
        section.classList.remove("sos-section-open")
        if (arrow) arrow.textContent = "▶"
      }
    })
  }

  /* ================================================================ */
  /*  Private: value path helpers                                      */
  /* ================================================================ */

  private normalizeArrayVal(val: unknown): string[] {
    if (Array.isArray(val)) return val
    if (typeof val === "string" && val.trim()) {
      return val.split(",").map((s) => s.trim()).filter(Boolean)
    }
    return []
  }

  private getValueByPath(path: string): unknown {
    if (!this.ctx) return ""
    const val = getValueByPath(this.ctx, path)
    if (SettingsForm.ARRAY_FIELDS.has(path.split(".")[2] ?? "")) {
      return this.normalizeArrayVal(val)
    }
    return val
  }

  private setValueByPath(path: string, value: string): void {
    if (!this.ctx) return
    setValueByPath(this.ctx, path, value)
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

  private openSection(sectionName: string): void {
    if (!this.container) return
    const header = this.container.querySelector(`[data-section="${sectionName}"]`)
    if (!header) return
    const section = header.closest(".sos-section")
    if (!section) return
    const body = section.querySelector(".sos-section-body") as HTMLElement
    const arrow = header.querySelector(".sos-section-arrow") as HTMLElement
    body?.classList.remove("hidden")
    section.classList.add("sos-section-open")
    if (arrow) arrow.textContent = "▼"
    section.classList.add("sos-section-highlight")
    setTimeout(() => section.classList.remove("sos-section-highlight"), 2000)
  }

  /* ================================================================ */
  /*  Private: tag input                                               */
  /* ================================================================ */

  private initTagInput(): void {
    if (!this.container) return
    const wrapper = this.container.querySelector(".sos-tag-input-wrapper")
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
      tagList.appendChild(this.createTagEl(trimmed, tagList))
      textInput.value = ""
      this.changeCb?.()
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

  private createTagEl(term: string, tagList: HTMLElement): HTMLSpanElement {
    const tag = document.createElement("span")
    tag.className = "sos-tag"
    tag.innerHTML = `<span class="sos-tag-text">${term}</span><span class="sos-tag-remove" role="button" tabindex="0">×</span>`
    tag.querySelector(".sos-tag-remove")!.addEventListener("click", (e) => {
      e.stopPropagation()
      tag.remove()
      this.changeCb?.()
    })
    return tag
  }

  private syncTagInput(terms: string[]): void {
    if (!this.container) return
    const tagList = this.container.querySelector(".sos-tag-list") as HTMLElement
    if (!tagList) return
    tagList.innerHTML = ""
    terms.forEach((term) => tagList.appendChild(this.createTagEl(term, tagList)))
  }

  private gatherTagInput(): string[] {
    if (!this.container) return []
    const tagList = this.container.querySelector(".sos-tag-list") as HTMLElement
    if (!tagList) return []
    return [...tagList.querySelectorAll(".sos-tag")].map(
      (t) => t.querySelector(".sos-tag-text")?.textContent || ""
    )
  }

  /* ================================================================ */
  /*  Private: HTML template                                           */
  /* ================================================================ */

  private html(): string {
    return `
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
  }
}
