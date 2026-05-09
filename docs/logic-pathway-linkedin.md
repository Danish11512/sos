# SOS Extension — Complete Logic Flow Map (LinkedIn)

## Overview

This document maps every function in the SOS extension, tracing the full execution flow from LinkedIn site detection through pipeline completion. Each function is documented with its callers, callees, and the logic that governs its invocation.

---

## 1. ENTRY POINT: Site Detection

### 1.1 Background Script (`src/entrypoints/background.ts`)

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `defineBackground(main)` | WXT runtime | `notifyIfSearchPage()` | Registers two listeners for URL detection |
| `notifyIfSearchPage(tabId, url)` | `tabs.onUpdated`, `webNavigation.onHistoryStateUpdated` | `browser.tabs.sendMessage()` | Checks if URL matches a site preset AND is a search results page. For LinkedIn: checks `/jobs/search/` in URL. Sends `SOS_SITE_DETECTED` message to content script. Skips if `sos_running` param present (legacy pipeline). |
| `tabs.onUpdated` listener | Browser event | `notifyIfSearchPage()` | Fires on every tab load/refresh. Checks `changeInfo.status === "loading"` or `"complete"`. |
| `webNavigation.onHistoryStateUpdated` listener | Browser event (SPA) | `notifyIfSearchPage()` | Fires on SPA pushState/replaceState. Only processes top frame (`frameId === 0`). |

**Flow:**
```
User navigates to linkedin.com/jobs/search/...
  → tabs.onUpdated fires (status: "loading" or "complete")
    → notifyIfSearchPage(tabId, url)
      → url includes "linkedin.com" AND "/jobs/search/"
        → browser.tabs.sendMessage(tabId, { type: "SOS_SITE_DETECTED", presetId: "linkedin" })

User clicks SPA navigation on LinkedIn
  → webNavigation.onHistoryStateUpdated fires
    → notifyIfSearchPage(tabId, url) [same logic as above]
```

### 1.2 Content Script (`src/entrypoints/content.ts`)

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `defineContentScript({ main })` | WXT runtime | `runLegacyPipelineCycle()`, `createWidget()`, `handleUrlChange()` | Entry point. Three paths: (1) legacy pipeline resume via URL param, (2) direct site detection, (3) background message listener |
| `main()` | Browser on page match | See above | Matches `*://*.linkedin.com/*` and `*://*.indeed.com/*` |
| `handleUrlChange()` | `popstate` event, `eventBus.on("url-changed")` | `createWidget()` | SPA navigation detection. Compares `lastUrl` to current URL. Resets `widgetInitializedUrl` to force widget re-creation. |
| `createWidget(presetId)` | `main()`, `handleUrlChange()`, background message | `FloatingWidget` constructor, `settingsManager.load()`, `runLinkedInPipeline()`, `discardApplication()` | **Central orchestrator.** Creates the floating widget UI. Sets initial state based on search page detection and settings completeness. Registers event bus listeners. |

**Flow:**
```
Content script loads on *.linkedin.com/*
  → Check URL for "sos_running" param → if yes, runLegacyPipelineCycle() [Indeed only]
  → Find matching site preset (linkedin.com)
    → createWidget("linkedin")
      → Find preset config
      → SPA guard: skip if same URL already initialized
      → Check if widget DOM already exists
      → Determine initial state:
        - Not on search page → "nav"
        - On search page + missing settings → "idle"
        - On search page + all settings filled → "ready"
      → Destroy old widget if exists
      → Load settings
      → Create new FloatingWidget with callbacks:
        - onNavigate → navigateToSearchPage()
        - onToggle → runLinkedInPipeline() [the main pipeline]
      → Register event bus listeners:
        - "stop-requested" → abortController.abort() + discardApplication()
        - "resume-requested" → widget.setState("running")
        - "pause-requested" → widget.setState("paused") + show progress
        - "pause-for-help" → widget.setState("paused") + show help message
        - "daily-limit-reached" → widget.setDone() + show message

  → Also listen for background message "SOS_SITE_DETECTED"
  → Also intercept pushState/replaceState for SPA nav detection
```

---

## 2. WIDGET LAYER (UI State Machine)

### 2.1 FloatingWidget (`src/utils/ui.ts`)

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `constructor(options)` | `createWidget()` | `buildUI()`, `setState()`, `loadAndSync()` | Creates shadow DOM container, builds UI, sets initial state, loads settings |
| `buildUI(opts)` | constructor | `SettingsForm.build()` | Builds expanded/collapsed views, toggle button, progress line, pause controls, settings form |
| `setState(state)` | Various | `transitionTo()` | Public state setter with validation |
| `transitionTo(state)` | `setState()` | `canTransition()`, `saveSiteState()`, `eventBus.emit("state-changed")` | Validates transition, updates UI classes, emits event, persists state |
| `handleToggle()` | Toggle button click | `persist()`, `startPipeline()`, `eventBus.emit("stop-requested")`, `setStopped()` | Routes based on current state: idle/needsInfo → validate → start; running → stop; ready/error → start |
| `startPipeline()` | `handleToggle()` | `eventBus.emit("start-requested")`, `setState("starting")`, `options.onToggle(true)` | Emits start event, transitions to starting state, calls the pipeline callback |
| `handleResume()` | Resume button click | `eventBus.emit("resume-requested")`, `options.onResume()` | Emits resume event |
| `handleFromPauseStop()` | Stop button (paused) | `eventBus.emit("stop-requested")`, `setState("stopped")` | Emits stop event, transitions to stopped → ready after 1.5s |
| `setProgress(msg)` | Pipeline callback | — | Updates progress line text |
| `setDone()` | Pipeline completion | `setState("done")` | Transitions to done → ready after 2s |
| `setStopped()` | User stop | `setState("stopped")` | Transitions to stopped → ready after 1.5s |
| `setError(msg)` | Pipeline error | `setState("error")`, `form.showErrorBanner()` | Transitions to error state |
| `loadAndSync()` | constructor | `loadSettings()`, `form.setCtx()`, `loadSiteState()`, `refreshState()` | Loads settings from storage, syncs form, restores persisted state |
| `persist()` | Form change, save button | `saveSettings()`, `settingsManager.setData()`, `eventBus.emit("settings-changed")`, `refreshState()` | Saves settings to storage |
| `refreshState()` | `loadAndSync()`, `persist()` | `settingsManager.getMissingMandatoryFields()` | Re-evaluates widget state based on settings completeness |
| `destroy()` | `createWidget()` | — | Removes DOM, resets form |
| `handleResumeFile(file)` | File input | `persist()` | Reads resume file as data URL, stores in settings |
| `handleClickOutside(e)` | Document click | `collapse()` | Collapses widget if click outside (not during active pipeline) |
| `collapse()` / `expand()` | Click handlers | — | Toggles expanded/collapsed views |

### 2.2 State Machine (`src/utils/widget-state.ts`)

| Function | Called By | Logic |
|---|---|---|
| `canTransition(from, to)` | `FloatingWidget.transitionTo()` | Checks `ALLOWED_TRANSITIONS` table |
| `reachableStates(state)` | — | Returns all states reachable from given state |
| `isTerminal(state)` | — | Returns true for error, done, stopped |
| `allowsFormEdit(state)` | — | Returns true for idle, needsInfo, ready, terminal, nav |
| `isActive(state)` | — | Returns true for starting, running, paused |

**State Transition Diagram:**
```
idle ──→ nav (on search page)
idle ──→ ready (all settings filled)
idle ──→ needsInfo (missing settings, user tried to start)
idle ──→ starting (direct start with all settings)

needsInfo ──→ ready (settings completed)
needsInfo ──→ idle (settings cleared)
needsInfo ──→ nav (navigated away)

nav ──→ idle/ready (navigated to search page)

ready ──→ starting (user clicks Start)
ready ──→ needsInfo (settings become incomplete)
ready ──→ idle (settings cleared)

starting ──→ running (pipeline begins)
starting ──→ error (pipeline init fails)
starting ──→ stopped (user stops during init)

running ──→ paused (pipeline pauses for help/question)
running ──→ done (pipeline completes)
running ──→ error (pipeline error)
running ──→ stopped (user stops)

paused ──→ running (user clicks Resume)
paused ──→ stopped (user clicks Stop)

stopped ──→ ready (auto after 1.5s timeout)
stopped ──→ nav (if navigated away)

done ──→ ready (auto after 2s timeout)
done ──→ nav (if navigated away)

error ──→ ready (user clicks Start to retry)
error ──→ starting (user clicks Start)
error ──→ nav (if navigated away)
```

---

## 3. LINKEDIN PIPELINE (`src/pipeline/linkedin.ts`)

### 3.1 Pipeline Orchestrator

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `runLinkedInPipeline(site, signal, onProgress)` | `createWidget()` → `onToggle` callback | `isLinkedInLoggedIn()`, `detectAntiBotInterstitial()`, `loadPipelineState()`, `navigateToSearchTerm()`, `applyFiltersViaPushState()`, `applyDomFilters()`, `readAllJobPreviews()`, `filterJobPreviews()`, `readJobDescription()`, `retryApply()`, `applyToJob()`, `closeEasyApplyModal()`, `savePipelineState()`, `clearPipelineState()`, `randomDelay()` | **Main pipeline entry point.** Full flow: login check → anti-bot check → prepare search terms (optional shuffle) → restore persisted state → for each term: navigate → apply URL filters → apply DOM filters → read previews → filter by company → for each job: read description → apply (validate + Easy Apply) → modal double-close check → save state → random delay between jobs → cycle date/sort → clear state on completion |

**Pipeline Flow (detailed):**
```
runLinkedInPipeline(site, signal, onProgress)
│
├── 1. LOGIN CHECK
│   └── isLinkedInLoggedIn() → throw if not logged in
│
├── 2. ANTI-BOT CHECK
│   └── detectAntiBotInterstitial() → throw if detected
│
├── 3. PREPARE SEARCH TERMS
│   └── If randomizeSearchOrder → shuffle terms
│
├── 4. RESTORE PERSISTED STATE (crash recovery)
│   └── loadPipelineState() → restore termIndex, jobIndex, totalProcessed, sortToggle, dateCycleIndex
│
├── 5. DATE/SORT CYCLING SETUP
│   └── Read cycleDatePosted, alternateSortby, stopDateCycleAt24hr from settings
│
└── 6. FOR EACH SEARCH TERM [termIdx from restored or 0]:
    │
    ├── 6a. NAVIGATE TO SEARCH TERM
    │   └── navigateToSearchTerm(term, signal)
    │       └── On failure → skip term (continue)
    │
    ├── 6b. APPLY URL-BASED FILTERS
    │   └── applyFiltersViaPushState(site, signal, { datePosted, sortBy }, term)
    │       └── On failure → skip term (continue)
    │
    ├── 6c. APPLY DOM-BASED FILTERS
    │   └── applyDomFilters(site, clickDelayMs, signal)
    │       └── Log errors but continue
    │
    ├── 6d. READ ALL JOB PREVIEWS
    │   └── readAllJobPreviews(maxCards, signal)
    │       └── If no jobs → cycle date/sort, skip term
    │
    ├── 6e. FILTER BY COMPANY LIST
    │   └── filterJobPreviews(previews, companies)
    │
    └── 6f. FOR EACH JOB [jobIdx from restored or 0]:
        │
        ├── READ JOB DESCRIPTION
        │   └── readJobDescription(job, signal)
        │       └── If empty → skip job
        │
        ├── FIND DETAIL PANEL
        │   └── document.querySelector(DETAIL_PANEL_SELECTOR)
        │       └── If not found → skip job
        │
        ├── APPLY TO JOB (with retry)
        │   └── retryApply(() => applyToJob(...), 2, signal)
        │       └── applyToJob(job, description, filters, detailPanel, signal, site, onProgress)
        │
        ├── MODAL DOUBLE-CLOSE CHECK
        │   └── If modal still open → closeEasyApplyModal()
        │
        ├── SAVE PIPELINE STATE
        │   └── savePipelineState({ termIndex, jobIndex+1, totalProcessed, ... })
        │
        └── RANDOM DELAY (between jobs)
            └── randomDelay(1000, 2000, signal)
    
    └── After all jobs:
        ├── Reset startJobIndex = 0 (for next term)
        ├── Cycle datePosted index (if enabled)
        │   └── If stopAt24hr → clamp to index 0 after first cycle
        └── Toggle sort (if enabled)

└── 7. CLEAR PERSISTED STATE
    └── clearPipelineState()
```

### 3.2 Navigation Functions

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `navigateToSearchPage()` | Widget `onNavigate` callback | `pushStateNavigate()`, `window.location.href` | Navigates to LinkedIn jobs search page. Tries pushState first, falls back to full redirect. Skips if already on search page. |
| `navigateToSearchTerm(term, signal)` | `runLinkedInPipeline()` | `waitForElement()`, `setReactInputValue()`, `waitForCondition()`, `dispatchEnterKey()`, `waitForResults()` | DOM-based search term entry. Finds search input → focus → clear → set new value → dispatch Enter → wait for results. Falls back to text-based input detection if primary selectors fail. |
| `applyFiltersViaPushState(site, signal, overrides, currentSearchTerm)` | `runLinkedInPipeline()` | `buildFilterUrl()`, `pushStateNavigate()`, `waitForResults()` | Applies URL-based filters via history.pushState + PopStateEvent. Builds filter URL from settings, navigates via pushState, waits for results. |
| `buildFilterUrl(site, overrides, explicitKeywords)` | `applyFiltersViaPushState()` | — | Builds LinkedIn search URL with all filter params. Preserves keywords/location/geoId from current URL. Always sets `f_AL=true` (Easy Apply). Maps sort, date, experience, job type, on-site settings to URL params. |
| `applyDomFilters(site, clickDelayMs, signal)` | `runLinkedInPipeline()` | `waitForElement()`, `scrollAndClick()`, `toggleCheckboxItems()`, `findButtonByText()`, `waitForResults()` | Opens "All filters" modal, toggles DOM-only filters (under 10 applicants, in your network, fair chance employer), clicks "Show results". Uses MutationObserver-based waits. |

### 3.3 Job Reading Functions

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `readAllJobPreviews(maxCards, signal)` | `runLinkedInPipeline()` | `waitForElement()`, `waitForNewElements()`, `waitForJobCards()`, `extractCardTitle()`, `extractCardCompany()`, `extractCardLocation()` | Scrolls the job list sidebar to load all cards (max 5 scroll attempts). Reads up to 100 cards. Extracts title, company, location, jobId, URL from each card. |
| `waitForJobCards(timeoutMs, signal)` | `readAllJobPreviews()` | `MutationObserver` | Waits for at least one job card to appear in DOM. Uses MutationObserver on document.body. Returns null on timeout or abort. |
| `extractCardTitle(card)` | `readAllJobPreviews()` | — | Extracts job title from card element using multiple CSS selectors. Falls back to textContent regex. |
| `extractCardCompany(card)` | `readAllJobPreviews()` | — | Extracts company name from card or parent element. Falls back to "unknown". |
| `extractCardLocation(card)` | `readAllJobPreviews()` | — | Extracts location from card or parent element. Falls back to empty string. |
| `readJobDescription(job, signal)` | `runLinkedInPipeline()` | `scrollAndClick()`, `waitForDetailPanel()`, `waitForElement()`, `waitForCondition()`, `getVisibleText()` | Clicks job card → waits for detail panel with matching title → waits for description content → clicks "Show more" → waits for expansion → checks for iframes → returns visible text. |
| `waitForDetailPanel(expectedTitle, timeoutMs, signal)` | `readJobDescription()` | `waitForCondition()` | Waits for detail panel to appear with text content > 50 chars AND containing the expected job title (prevents stale content). |
| `filterJobPreviews(previews, companies)` | `runLinkedInPipeline()` | `checkCompanyList()` | Filters job previews by company allow/block list. |

### 3.4 Easy Apply Functions

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `applyToJob(job, description, filters, detailPanel, signal, site, onProgress)` | `retryApply()` wrapper | `validateJobForApplication()`, `extractSalary()`, `detectExternalApply()`, `clickEasyApplyButton()`, `fillEasyApplyModal()` | **Main apply function.** Step 1: Validate job against ALL filter criteria (company bad words, title bad words, description bad words, security clearance, experience requirement). Step 2: Check salary filter. Step 3: Check for external apply. Step 4: Click Easy Apply button. Step 5: Fill and submit modal. Returns `ApplyToJobResult`. |
| `clickEasyApplyButton(detailPanel, signal)` | `applyToJob()` | `waitForElement()`, `scrollAndClick()`, `waitForEasyApplyModal()` | Checks for already-applied status → checks for external apply → waits for Easy Apply button → clicks it (with text-based fallback) → waits for modal to appear. |
| `closeEasyApplyModal()` | `runLinkedInPipeline()` (double-close check), `discardApplication()` | `scrollAndClick()`, `dispatchEscapeKey()`, `waitForModalClose()` | Three strategies: (1) Click X/dismiss button, (2) Dispatch Escape key, (3) DOM-level removal + restore body overflow. |
| `waitForEasyApplyModal(timeoutMs, signal)` | `clickEasyApplyButton()` | `waitForElement()`, `waitForCondition()` | Waits for modal element + form content (input, select, textarea). |
| `waitForModalClose(timeoutMs, signal)` | `closeEasyApplyModal()` | `waitForCondition()` | Waits for modal to disappear from DOM. |
| `waitForResults(timeoutMs, signal)` | `navigateToSearchTerm()`, `applyFiltersViaPushState()`, `applyDomFilters()` | `waitForCondition()` | Waits for job cards OR empty state to appear. |

### 3.5 Pipeline State Persistence

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `loadPipelineState()` | `runLinkedInPipeline()` | `browser.storage.local.get()` | Loads `sos_linkedin_pipeline_state` from storage. Returns null if not found. |
| `savePipelineState(state)` | `runLinkedInPipeline()` | `browser.storage.local.set()` | Saves current termIndex, jobIndex, totalProcessed, sortToggle, dateCycleIndex with timestamp. |
| `clearPipelineState()` | `runLinkedInPipeline()` | `browser.storage.local.remove()` | Removes persisted state on successful completion. |

### 3.6 Retry Wrapper

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `retryApply(fn, maxRetries, signal)` | `runLinkedInPipeline()` | `waitForCondition()` | Retries a function up to `maxRetries` times with exponential backoff. Waits for DOM mutations (job cards) between retries instead of fixed delays. |

---

## 4. EASY APPLY MODAL ENGINE (`src/pipeline/easy-apply-modal.ts`)

### 4.1 Main Orchestrator

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `fillEasyApplyModal(modal, settings, signal, onProgress)` | `applyToJob()` | `checkDailyLimit()`, `findFormElements()`, `answerQuestion()`, `uploadResume()`, `findNavigationButton()`, `handleNavigation()`, `handleStuck()`, `trySubmit()`, `toggleFollowCompany()` | **Main modal interaction loop.** Step 1: Check daily limit → emit event. Step 2: Build answer context (personal, answers, eeo, custom). Step 3: Question-answering loop (max 15 iterations): find unanswered elements → answer each → upload resume → find nav button → handle nav. Step 4: Handle review screen → toggle follow company → submit. Step 5: Handle stuck questions → pause-for-help or random answers. |

**Modal Flow:**
```
fillEasyApplyModal(modal, settings, signal, onProgress)
│
├── 1. CHECK DAILY LIMIT
│   └── checkDailyLimit(modal) → if true, emit "daily-limit-reached", return
│
├── 2. BUILD ANSWER CONTEXT
│   └── ctx = { personal, answers, eeo, customAnswers }
│
└── 3. QUESTION-ANSWERING LOOP (max 15 iterations):
    │
    ├── Find unanswered form elements
    │   └── findFormElements(modal)
    │
    ├── If elements found:
    │   ├── Answer each question
    │   │   └── answerQuestion(q, ctx) → dispatches to type-specific handler
    │   └── Upload resume if available
    │       └── uploadResume(modal, resumeData, resumeFileName, signal)
    │
    ├── Find navigation button
    │   └── findNavigationButton(modal)
    │
    ├── If NO nav button:
    │   ├── If unanswered questions exist → handleStuck()
    │   │   ├── "continue" → loop again
    │   │   └── "exit" → return failed
    │   └── If no questions → trySubmit()
    │       └── If success → return success
    │
    └── If nav button found:
        └── handleNavigation(navBtn, modal, followCompanies, signal)
            ├── "next" → delay, continue loop
            ├── "review" → toggleFollowCompany → trySubmit → return
            ├── "submit" → return success
            ├── "done" → return success
            └── "stuck" → handleStuck()
```

### 4.2 Question Answering Functions

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `answerQuestion(q, ctx)` | `fillEasyApplyModal()` | `answerSelectQuestion()`, `answerRadioQuestion()`, `answerTextQuestion()`, `answerTextareaQuestion()`, `answerCheckboxQuestion()` | Dispatches to type-specific answer function |
| `answerSelectQuestion(question, ctx)` | `answerQuestion()` | `matchQuestionToAnswer()`, `findBestOption()` | Matches label to answer, finds best option in dropdown, sets selectedIndex |
| `answerRadioQuestion(question, ctx)` | `answerQuestion()` | `matchQuestionToAnswer()`, `findBestOption()`, `getRadioLabel()`, `scrollAndClick()` | Matches label to answer, finds matching radio button by label text, clicks it |
| `answerTextQuestion(question, ctx)` | `answerQuestion()` | `matchQuestionToAnswer()`, `setReactInputValue()` | Fills text input with matched answer |
| `answerTextareaQuestion(question, ctx)` | `answerQuestion()` | `matchQuestionToAnswer()`, `setReactInputValue()` | Fills textarea with matched answer |
| `answerCheckboxQuestion(question)` | `answerQuestion()` | `scrollAndClick()` | Clicks checkbox if unchecked |
| `getRadioLabel(radio)` | `answerRadioQuestion()` | — | 7 strategies to find radio label: (1) `<label for>`, (2) parent `<label>`, (3) aria-label, (4) next sibling, (5) aria-labelledby, (6) previous sibling, (7) value attribute |

### 4.3 Form Element Discovery

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `findFormElements(modal)` | `fillEasyApplyModal()`, `handleStuck()` | `classifyQuestion()`, `isElementAnswered()`, `extractLabel()` | Finds all interactive form elements (select, textarea, input) in modal. Skips hidden, file, submit, button, disabled inputs. Skips already-answered elements. Skips elements with no identifiable label. |
| `isElementAnswered(el, type)` | `findFormElements()` | — | Checks if element already has value: select → selectedIndex > 0; radio → checked exists; checkbox → always process; text/textarea → value not empty |

### 4.4 Navigation & Submission

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `findNavigationButton(modal)` | `fillEasyApplyModal()` | — | Finds primary nav button in modal footer. Checks aria-label and text content for Next, Review, Submit, Continue. Falls back to scanning all buttons. |
| `handleNavigation(navBtn, modal, followCompanies, signal)` | `fillEasyApplyModal()` | `scrollAndClick()`, `clickSubmitApplication()` | Routes based on button text: next/continue → click; review → click; submit → clickSubmitApplication(); otherwise → stuck |
| `clickSubmitApplication(modal, signal)` | `handleNavigation()`, `trySubmit()` | `findButtonByText()`, `scrollAndClick()`, `delay()` | Finds Submit button → clicks → waits for confirmation modal (Promise.race with MutationObserver) → clicks "Done" or dispatches Escape |
| `trySubmit(modal, followCompanies, signal)` | `fillEasyApplyModal()` | `toggleFollowCompany()`, `findButtonByText()`, `clickSubmitApplication()` | Toggles follow company → looks for Submit button → clicks it |
| `toggleFollowCompany(modal, follow)` | `fillEasyApplyModal()`, `trySubmit()` | `scrollAndClick()` | Checks "Follow company" checkbox if setting enabled |

### 4.5 Stuck Handling

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `handleStuck(modal, formElements, pauseAtFailed, signal)` | `fillEasyApplyModal()` | `eventBus.emit("pause-for-help")`, `waitForResume()`, `findFormElements()` | If `pauseAtFailed` → emit pause-for-help event → wait for user resume → check if still stuck. Otherwise → try random answers for select/radio questions. |
| `waitForResume(signal)` | `handleStuck()` | `eventBus.on("resume-requested")`, `eventBus.on("stop-requested")` | Waits for user to click Resume or Stop. Timeout after 5 minutes. Returns true if resumed, false if stopped/timed out. |

### 4.6 Utility Functions

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `checkDailyLimit(modal)` | `fillEasyApplyModal()` | — | Checks modal text for daily limit phrases (12 variants). |
| `detectExternalApply(detailPanel)` | `applyToJob()` | — | Checks detail panel for external apply links (non-LinkedIn URLs). |
| `uploadResume(modal, resumeData, resumeFileName, signal)` | `fillEasyApplyModal()` | `delay()` | Finds file input → converts base64 data URL to Blob → creates File → sets on input → dispatches change event. |
| `discardApplication()` | `createWidget()` (finally block), event bus "stop-requested" | `dispatchEscapeKey()`, `findButtonByText()`, `scrollAndClick()` | Handles save-draft modal on discard. Tries Escape key first → checks for save draft modal → clicks Discard. Used in finally block to ensure cleanup. |

---

## 5. JOB VALIDATOR (`src/pipeline/job-validator.ts`)

### 5.1 Composer

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `validateJobForApplication(company, title, description, filters)` | `applyToJob()` | `checkCompanyBadWords()`, `checkTitleBadWords()`, `checkDescriptionBadWords()`, `checkSecurityClearance()`, `checkExperienceRequirement()` | **Composes all filter checks with `&&`.** Returns true only if ALL pass. |

### 5.2 Individual Checks

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `checkCompanyBadWords(company, badWords, goodWords)` | `validateJobForApplication()` | `hasAnyWordBoundary()` | Checks company name for bad words with word-boundary matching. Good words act as exceptions. Empty company name passes (permissive). |
| `checkTitleBadWords(title, badWords)` | `validateJobForApplication()` | `hasAnyWordBoundary()` | Checks job title for bad words with word-boundary matching. |
| `checkDescriptionBadWords(description, badWords)` | `validateJobForApplication()` | `hasAnyWordBoundary()` | Checks job description for bad words with word-boundary matching. |
| `checkSecurityClearance(description, hasClearance)` | `validateJobForApplication()` | `hasWordBoundary()`, `hasAnyWordBoundary()` | If user has clearance → all pass. Otherwise checks for clearance keywords with context (e.g., "secret" near "clearance"/"security"). |
| `checkExperienceRequirement(description, currentExperience, didMasters)` | `validateJobForApplication()` | `extractYearsOfExperience()` | If experience is -1 (unset) → all pass. Extracts required years from description. Master's degree adds 2 years boost. |
| `checkCompanyList(company, companies)` | `filterJobPreviews()` | — | If companies list is empty → all pass. Otherwise checks if company name is in the list (substring match both ways). |

### 5.3 Helpers

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `hasWordBoundary(text, word)` | All check functions | — | Regex word-boundary matching to prevent false positives |
| `hasAnyWordBoundary(text, words)` | All check functions | `hasWordBoundary()` | Checks if any word from list matches |
| `extractYearsOfExperience(description)` | `checkExperienceRequirement()` | — | Regex extraction of experience requirements. Handles ranges ("3-5 years" → max), single values ("5+ years"), capped at 12 years. |
| `extractSalary(description)` | `applyToJob()` | — | Regex extraction of salary. Handles ranges ($XX-YY per year, $Xk-$Yk) and single values. Returns max (upper bound) salary found. |

---

## 6. QUESTION MATCHER (`src/pipeline/question-matcher.ts`)

### 6.1 Main Matching

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `matchQuestionToAnswer(label, ctx)` | `answerSelectQuestion()`, `answerRadioQuestion()`, `answerTextQuestion()`, `answerTextareaQuestion()` | — | Two-step matching: (1) Check custom answers (user-defined overrides) first, (2) Check keyword matchers (ordered list, first match wins). Returns answer string or empty string. |
| `findBestOption(options, answer)` | `answerSelectQuestion()`, `answerRadioQuestion()` | — | Fuzzy matching: exact match first → substring match → Yes/No variants. Returns best option or null. |
| `classifyQuestion(element)` | `findFormElements()` | — | Classifies element as select, radio, text, textarea, checkbox, or unknown based on tag and type. |
| `extractLabel(element)` | `findFormElements()` | — | 7 strategies to extract label: (1) aria-label, (2) aria-labelledby, (3) `<label for>`, (4) parent `<label>`, (5) placeholder, (6) previous sibling text, (7) fieldset legend. |

### 6.2 Keyword Matchers

The `KEYWORD_MATCHERS` array contains 30+ entries organized by category:

| Category | Keywords | Resolves From |
|---|---|---|
| Personal Info | first name, last name, phone, email, city, street, state, zip, country | `ctx.personal.*` |
| Experience | years of experience, experience | `ctx.answers.yearsOfExperience` |
| Visa/Sponsorship | visa, sponsorship, work authorization, right to work | `ctx.answers.requireVisa` |
| Citizenship | citizen, citizenship, employment eligibility, us person | `ctx.answers.usCitizenship` |
| Salary | salary, compensation, ctc, expected salary, current ctc, notice period | `ctx.answers.*` |
| LinkedIn/Online | linkedin, website, portfolio | `ctx.answers.*` |
| Headline/Summary | headline, summary, about, bio | `ctx.answers.*` |
| Cover Letter | cover letter | `ctx.answers.coverLetter` |
| Recent Employer | recent employer, current employer | `ctx.answers.recentEmployer` |
| EEO/Diversity | ethnicity, race, gender, disability, veteran | `ctx.eeo.*` |
| Security Clearance | security clearance, clearance | `ctx.answers.confidenceLevel` |
| Education | masters, bachelor | Hardcoded defaults ("No", "Yes") |

---

## 7. SETTINGS LAYER

### 7.1 Settings Sections (`src/settings/sections.ts`)

| Section | Interface | Key Fields |
|---|---|---|
| `PersonalSection` | `PersonalSettings` | firstName, lastName, phoneNumber, currentCity, street, state, zipcode, country |
| `EeoSection` | `EeoSettings` | ethnicity, gender, disabilityStatus, veteranStatus |
| `GlobalBehaviorSection` | `GlobalBehaviorSettings` | clickGap, smoothScroll, keepScreenAwake |
| `SearchSection` | `SearchSettings` | searchTerms[], searchLocation, switchNumber, randomizeSearchOrder |
| `FilterSection` | `FilterSettings` | sortBy, datePosted, salary, experienceLevel[], jobType[], onSite[], under10Applicants, inYourNetwork, fairChanceEmployer, companies[], aboutCompanyBadWords[], aboutCompanyGoodWords[], badWords[], securityClearance, didMasters, currentExperience |
| `AnswerSection` | `AnswerSettings` | yearsOfExperience, requireVisa, website, linkedIn, usCitizenship, desiredSalary, currentCtc, noticePeriod, linkedinHeadline, linkedinSummary, coverLetter, recentEmployer, confidenceLevel |
| `PipelineSection` | `PipelineSettings` | pauseBeforeSubmit, pauseAtFailedQuestion, overwritePreviousAnswers, closeTabs, followCompanies, runNonStop, runInBackground, alternateSortby, cycleDatePosted, stopDateCycleAt24hr, clickDelayMs |
| `AdditionalSection` | `AdditionalSettings` | autoFillScreeningQuestions, customAnswers{}, resumeData, resumeFileName |

### 7.2 Settings Manager (`src/settings/manager.ts`)

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `load()` | `createWidget()`, `FloatingWidget.loadAndSync()` | `loadSettings()`, `ensureShape()` | Loads settings from storage into manager cache |
| `setData(data)` | `FloatingWidget.persist()` | `ensureShape()` | Direct-syncs manager cache without storage round-trip |
| `save()` | — | `saveSettings()` | Persists manager cache to storage |
| `getGlobal()` | Various | — | Returns global settings |
| `getSite(siteId)` | Various | — | Returns per-site settings (creates default if missing) |
| `validateAll()` | — | Section validators | Validates all sections across all sites |
| `isSiteReady(siteId)` | — | `getMissingMandatoryFields()` | Returns true if no missing mandatory fields |
| `getMissingMandatoryFields(siteId)` | `FloatingWidget.refreshState()`, `createWidget()`, `FloatingWidget.handleToggle()` | — | Returns list of missing mandatory fields with section/field/label. Checks: personal info (8 fields), search terms/location/switch#, sortBy/datePosted/currentExperience, requireVisa/yearsOfExperience/linkedIn/usCitizenship/desiredSalary, clickGap, resumeFileName |
| `ensureShape()` | `load()`, `setData()` | — | Ensures all sections exist with defaults |

### 7.3 Storage (`src/utils/storage.ts`)

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `loadSettings()` | Various | `browser.storage.local.get()`, `deepFreeze()`, `mergeWithDefaults()` | Loads from `sos_settings` key. Returns frozen (immutable) object. Uses cache on subsequent calls. |
| `saveSettings(settings)` | Various | `structuredClone()`, `deepFreeze()`, `browser.storage.local.set()` | Clones settings, freezes cache, writes to storage |
| `invalidateSettingsCache()` | — | — | Clears frozen cache to force re-read |
| `onSettingsChanged(cb)` | — | `browser.storage.local.onChanged` | Registers listener for storage changes |

---

## 8. DOM UTILITY LAYER (`src/utils/dom.ts`)

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `waitForElement(selector, timeout, signal)` | Multiple pipeline functions | `MutationObserver` | Waits for element matching selector to appear in DOM. Checks existing first. Returns null on timeout/abort. |
| `waitForCondition(predicate, options)` | Multiple pipeline functions | `MutationObserver`, optional polling interval | Core wait primitive. Checks predicate on every DOM mutation. Optional polling for React state changes. Throws on timeout. |
| `waitForNewElements(container, existingCount, options)` | `readAllJobPreviews()` | `MutationObserver` | Waits for new child elements matching selector. Used for scroll-based lazy loading. |
| `waitForTextContent(selector, minLength, options)` | — | `MutationObserver` | Waits for element's text content to reach minimum length. |
| `scrollAndClick(el)` | Multiple | `scrollIntoView()`, `clickElement()` | Scrolls element into view then clicks |
| `clickElement(el)` | `scrollAndClick()` | `HTMLElement.click()` | Clicks an element |
| `fillInput(selector, value)` | — | — | Sets value on input/textarea and dispatches input + change events |
| `findElementByText(text, tag, container)` | — | — | Finds element by exact text content match |
| `findButtonByText(container, ...texts)` | `applyDomFilters()`, `clickSubmitApplication()`, `discardApplication()`, `applyIndeedExtraFilters()` | — | Finds button by text content. Skips buttons with "applied", "submitted", "withdrawn". |
| `toggleCheckboxItems(modalContainer, items, clickDelayMs, signal)` | `applyDomFilters()`, `applyIndeedExtraFilters()` | `scrollAndClick()`, `delay()` | Toggles checkbox/label items by text content with word-boundary matching |
| `scrollToBottom(el, maxAttempts, intervalMs, signal)` | — | `delay()` | Scrolls element to bottom repeatedly until content stops growing |
| `setReactInputValue(input, value)` | `navigateToSearchTerm()`, `answerTextQuestion()`, `answerTextareaQuestion()` | Native property setter | Sets input value in React-compatible way. Dispatches focus, input, change, blur events. |
| `dispatchEnterKey(element)` | `navigateToSearchTerm()` | KeyboardEvent (keydown, keypress, keyup) | Dispatches Enter key events with maximum compatibility |
| `dispatchEscapeKey()` | `closeEasyApplyModal()`, `discardApplication()` | KeyboardEvent (keydown) | Dispatches Escape key event with composed:true for shadow DOM |
| `delay(ms, signal)` | Multiple | `setTimeout` | Promise-based delay with abort support |
| `randomDelay(minMs, maxMs, signal)` | `runLinkedInPipeline()` | `delay()` | Random delay within range for human-like behavior |
| `getVisibleText(el)` | `readJobDescription()` | — | Gets visible text, strips hidden elements |
| `hasUrlParam(name)` | — | — | Checks if URL has a search param |
| `removeUrlParam(name)` | — | — | Removes a URL search param |
| `pushStateNavigate(url)` | `navigateToSearchPage()`, `applyFiltersViaPushState()` | `history.pushState()`, PopStateEvent, HashChangeEvent | SPA navigation via pushState. Saves/restores scroll position. |
| `detectAntiBotInterstitial()` | `runLinkedInPipeline()` | — | Checks body text for anti-bot/CAPTCHA indicators |
| `isLinkedInLoggedIn()` | `runLinkedInPipeline()` | — | Checks for profile avatar or sign-in button |

---

## 9. EVENT BUS (`src/utils/event-bus.ts`)

| Function | Called By | Calls | Logic |
|---|---|---|---|
| `eventBus.on(event, cb, signal?)` | `createWidget()`, `handleStuck()` | — | Subscribes to event. Returns unsubscribe function. Optional AbortSignal for auto-cleanup. |
| `eventBus.off(event, cb)` | Internal | — | Unsubscribes from event. Cleans up empty listener sets. |
| `eventBus.emit(event, data)` | Multiple | — | Emits event to all subscribers. Catches and logs errors per listener. |
| `eventBus.clear(event?)` | — | — | Removes all listeners for event (or all events) |
| `eventBus.listenerCount(event)` | — | — | Returns number of listeners (leak detection) |

**Event Map:**

| Event | Emitted By | Consumed By | Data |
|---|---|---|---|
| `state-changed` | `FloatingWidget.transitionTo()` | — | `{ from, to, siteId }` |
| `settings-changed` | `FloatingWidget.persist()` | — | `{ settings }` |
| `pipeline-progress` | — | — | `{ message, siteId }` |
| `stop-requested` | `FloatingWidget.handleFromPauseStop()`, `FloatingWidget.handleToggle()` | `createWidget()` listener, `waitForResume()` | `{ siteId }` |
| `pause-requested` | — | `createWidget()` listener | `{ siteId, jobTitle, company }` |
| `resume-requested` | `FloatingWidget.handleResume()` | `createWidget()` listener, `waitForResume()` | `{ siteId }` |
| `start-requested` | `FloatingWidget.startPipeline()` | — | `{ siteId }` |
| `pipeline-error` | — | — | `{ message, siteId }` |
| `pipeline-done` | — | — | `{ siteId }` |
| `url-changed` | pushState/replaceState interception | `handleUrlChange()` | `{ url }` |
| `pause-for-help` | `handleStuck()` | `createWidget()` listener | `{ siteId, questionLabel, questionType }` |
| `daily-limit-reached` | `fillEasyApplyModal()` | `createWidget()` listener | `{ siteId }` |

---

## 10. COMPLETE EXECUTION FLOW (LinkedIn)

### 10.1 User lands on LinkedIn jobs search page

```
1. Background script detects URL change
   → tabs.onUpdated fires
   → notifyIfSearchPage(tabId, url)
   → url includes "linkedin.com" AND "/jobs/search/"
   → browser.tabs.sendMessage(tabId, { type: "SOS_SITE_DETECTED", presetId: "linkedin" })

2. Content script receives message
   → browser.runtime.onMessage listener fires
   → createWidget("linkedin")

3. Widget is created
   → FloatingWidget constructor
   → buildUI() creates shadow DOM with toggle button, progress, settings form
   → setState("idle" or "ready" or "nav") based on URL + settings completeness
   → loadAndSync() loads settings from storage
   → Event bus listeners registered:
      - "stop-requested" → abortController.abort() + discardApplication()
      - "resume-requested" → widget.setState("running")
      - "pause-requested" → widget.setState("paused")
      - "pause-for-help" → widget.setState("paused")
      - "daily-limit-reached" → widget.setDone()
```

### 10.2 User configures settings and clicks Start

```
1. User fills settings form → onChange → persist()
   → saveSettings() to storage
   → settingsManager.setData()
   → eventBus.emit("settings-changed")
   → refreshState() → if all fields filled → setState("ready")

2. User clicks Start button
   → FloatingWidget.handleToggle()
   → State is "ready" → startPipeline()
   → eventBus.emit("start-requested")
   → setState("starting")
   → options.onToggle(true) → createWidget's onToggle callback

3. Pipeline begins
   → settingsManager.load()
   → loadSettings() → get per-site settings
   → Check search terms exist
   → abortController = new AbortController()
   → widget.setState("running")
   → runLinkedInPipeline(site, abortController.signal, onProgress)
```

### 10.3 Pipeline execution

```
runLinkedInPipeline(site, signal, onProgress)
│
├── isLinkedInLoggedIn() → check for profile avatar
├── detectAntiBotInterstitial() → check for CAPTCHA
├── Prepare search terms (optional shuffle)
├── loadPipelineState() → restore from crash recovery
│
├── FOR EACH SEARCH TERM:
│   ├── navigateToSearchTerm(term, signal)
│   │   → waitForElement(SEARCH_INPUT_SELECTOR)
│   │   → setReactInputValue(input, term)
│   │   → dispatchEnterKey(input)
│   │   → waitForResults() → wait for cards or empty state
│   │
│   ├── applyFiltersViaPushState(site, signal, overrides, term)
│   │   → buildFilterUrl(site, overrides, term)
│   │     → Preserve keywords/location/geoId from current URL
│   │     → Map sortBy → f_SB2
│   │     → Map datePosted → f_TPR
│   │     → Map experienceLevel → f_E
│   │     → Map jobType → f_JT
│   │     → Map onSite → f_WT
│   │     → Always set f_AL=true (Easy Apply)
│   │   → pushStateNavigate(url) → history.pushState + PopStateEvent
│   │   → waitForResults()
│   │
│   ├── applyDomFilters(site, clickDelayMs, signal)
│   │   → Open "All filters" modal
│   │   → toggleCheckboxItems() for under10Applicants, inYourNetwork, fairChanceEmployer
│   │   → Click "Show results"
│   │   → waitForResults()
│   │
│   ├── readAllJobPreviews(maxCards, signal)
│   │   → Find list scroller → scroll → waitForNewElements (max 5 attempts)
│   │   → waitForJobCards() → MutationObserver
│   │   → Extract title, company, location, jobId from each card
│   │
│   ├── filterJobPreviews(previews, companies)
│   │   → checkCompanyList() → substring match
│   │
│   └── FOR EACH JOB:
│       ├── readJobDescription(job, signal)
│       │   → scrollAndClick(job.element)
│       │   → waitForDetailPanel(job.title) → wait for matching content
│       │   → waitForElement(DESCRIPTION_CONTENT_SELECTOR)
│       │   → Click "Show more" → waitForCondition() for text growth
│       │   → Check for iframes
│       │   → getVisibleText() → return description
│       │
│       ├── Find detail panel → document.querySelector(DETAIL_PANEL_SELECTOR)
│       │
│       ├── retryApply(() => applyToJob(...), 2, signal)
│       │   └── applyToJob(job, description, filters, detailPanel, signal, site, onProgress)
│       │       ├── validateJobForApplication(company, title, description, filters)
│       │       │   → checkCompanyBadWords() → word-boundary match
│       │       │   → checkTitleBadWords() → word-boundary match
│       │       │   → checkDescriptionBadWords() → word-boundary match
│       │       │   → checkSecurityClearance() → context-aware keyword match
│       │       │   → checkExperienceRequirement() → regex extraction + comparison
│       │       ├── extractSalary(description) → regex extraction
│       │       ├── detectExternalApply(detailPanel) → check for external links
│       │       ├── clickEasyApplyButton(detailPanel, signal)
│       │       │   → Check for already-applied status
│       │       │   → Check for external apply
│       │       │   → waitForElement(EASY_APPLY_BUTTON_SELECTOR)
│       │       │   → scrollAndClick() (with text-based fallback)
│       │       │   → waitForEasyApplyModal() → wait for modal + form content
│       │       └── fillEasyApplyModal(modal, site, signal, onProgress)
│       │           ├── checkDailyLimit() → 12 phrase variants
│       │           ├── Build AnswerContext { personal, answers, eeo, customAnswers }
│       │           └── LOOP (max 15 iterations):
│       │               ├── findFormElements() → classify + extract label + check answered
│       │               ├── answerQuestion(q, ctx) → type-specific handler
│       │               │   → matchQuestionToAnswer(label, ctx)
│       │               │     → Check customAnswers first
│       │               │     → Check KEYWORD_MATCHERS (30+ entries)
│       │               │   → findBestOption(options, answer) for select/radio
│       │               ├── uploadResume() if available
│       │               ├── findNavigationButton() → Next/Review/Submit
│       │               └── handleNavigation() → route based on button text
│       │                   ├── "next" → continue loop
│       │                   ├── "review" → toggleFollowCompany → trySubmit
│       │                   ├── "submit" → clickSubmitApplication()
│       │                   │   → find Submit button → click
│       │                   │   → Promise.race: wait for confirmation modal or timeout
│       │                   │   → Click "Done" or dispatch Escape
│       │                   └── "stuck" → handleStuck()
│       │                       → If pauseAtFailed: emit "pause-for-help", waitForResume()
│       │                       → Else: random answers for select/radio
│       │
│       ├── Modal double-close check
│       │   → If modal still open → closeEasyApplyModal()
│       │     → Strategy 1: Click X button
│       │     → Strategy 2: Dispatch Escape key
│       │     → Strategy 3: DOM removal + restore body overflow
│       │
│       ├── savePipelineState({ termIndex, jobIndex+1, ... })
│       │
│       └── randomDelay(1000, 2000) between jobs
│
├── Cycle datePosted index (if enabled)
├── Toggle sort (if enabled)
│
└── clearPipelineState() on completion
```

### 10.4 Pipeline completion

```
Pipeline completes successfully:
  → clearPipelineState()
  → onProgress("Pipeline complete — processed N jobs")
  → widget.setDone()
    → setState("done")
    → After 2s timeout → setState("ready")

Pipeline stopped by user:
  → abortController.abort()
  → discardApplication() in finally block
    → dispatch Escape key
    → Check for save draft modal → click Discard
  → widget.setStopped()
    → setState("stopped")
    → After 1.5s timeout → setState("ready")

Pipeline error:
  → widget.setError(errorMessage)
    → setState("error")
    → form.showErrorBanner(msg)
  → User can click Start to retry

Daily limit reached:
  → fillEasyApplyModal() → checkDailyLimit() → true
  → eventBus.emit("daily-limit-reached")
  → widget.setDone() → show "Daily limit reached" message
```

---

## 11. FILE DEPENDENCY MAP

```
src/entrypoints/background.ts
  → src/config/sites.ts
  → src/types/site.ts

src/entrypoints/content.ts
  → src/config/sites.ts
  → src/utils/ui.ts (FloatingWidget)
  → src/settings/manager.ts
  → src/utils/event-bus.ts
  → src/types/ui.ts
  → src/settings/sections.ts
  → src/utils/storage.ts
  → src/pipeline/index.ts
  → src/pipeline/linkedin.ts
  → src/pipeline/easy-apply-modal.ts

src/pipeline/index.ts
  → src/settings/sections.ts
  → src/utils/storage.ts
  → src/pipeline/linkedin.ts
  → src/pipeline/indeed.ts
  → src/pipeline/types.ts

src/pipeline/linkedin.ts
  → src/settings/sections.ts
  → src/pipeline/types.ts
  → src/pipeline/modal-result.ts
  → src/pipeline/job-validator.ts
  → src/pipeline/linkedin-constants.ts
  → src/pipeline/easy-apply-modal.ts
  → src/utils/dom.ts
  → src/utils/event-bus.ts
  → wxt/browser

src/pipeline/easy-apply-modal.ts
  → src/settings/sections.ts
  → src/pipeline/modal-result.ts
  → src/pipeline/question-matcher.ts
  → src/pipeline/linkedin-constants.ts
  → src/utils/event-bus.ts
  → src/settings/manager.ts
  → src/utils/dom.ts

src/pipeline/job-validator.ts
  → src/settings/sections.ts

src/pipeline/question-matcher.ts
  → src/settings/sections.ts

src/utils/ui.ts (FloatingWidget)
  → src/types/ui.ts
  → src/settings/sections.ts
  → src/settings/manager.ts
  → src/utils/storage.ts
  → src/utils/event-bus.ts
  → src/utils/widget-state.ts
  → src/utils/settings-form.ts
  → src/styles/ui.css

src/utils/dom.ts
  → (standalone, no internal deps)

src/utils/event-bus.ts
  → src/types/ui.ts
  → src/settings/sections.ts

src/utils/storage.ts
  → src/settings/sections.ts
  → wxt/browser

src/settings/manager.ts
  → src/settings/sections.ts
  → src/utils/storage.ts
```

---

## 12. TYPE FLOW

```
User Action → Widget State → Pipeline → DOM Interaction → Result
                                                             ↓
Site Detection ──→ createWidget() ──→ FloatingWidget ──→ User clicks Start
     │                                                       │
     ↓                                                       ↓
  eventBus ←──── Widget State Machine ←──── handleToggle()
                                               │
                                               ↓
                                        runLinkedInPipeline()
                                               │
                                    ┌──────────┼──────────┐
                                    ↓          ↓          ↓
                              navigate    filter     read jobs
                                    │          │          │
                                    ↓          ↓          ↓
                              applyToJob() ← validateJobForApplication()
                                    │
                                    ↓
                            fillEasyApplyModal()
                                    │
                            ┌───────┼───────┐
                            ↓       ↓       ↓
                      answer    navigate  submit
                      questions  pages    application
                            │       │       │
                            ↓       ↓       ↓
                        ModalResult → eventBus → Widget update
```

