# Wellfound (wellfound.com) — Implementation Architecture

> **Status:** Higher-order system plan. Each module gets its own detailed plan later.
> **Goal:** Add Wellfound as a first-class auto-apply site using the SOS framework.

---

## ⚠️ Key Design Decision: Simplified Wellfound Widget

Unlike LinkedIn and Indeed, the Wellfound widget will be **radically simplified**:

```
┌─────────────────────────────────┐
│ Wellfound         [▶ Start   ] │  ← Only Start | Stop | Pause
├─────────────────────────────────┤
│ [Progress line...]              │  ← Shows what's happening
└─────────────────────────────────┘
```

- **No settings form** — No search terms, no filters, no company lists, no EEO, no answers
- **No configuration needed** — User just clicks Start and it goes
- **Just Start / Stop / Pause** — The three-state button only
- **Heavy console logging** — Every action prints `[SOS] [Wellfound]` lines so the user can follow along in DevTools

---

## 1. How Wellfound Works (from DOM analysis)

```
User lands on wellfound.com/jobs
  → Shows a list of job results grouped by startup/company
  → Each job listing card shows: title, salary, location, posted date
  → Each card has [Save] and [Learn more] buttons
  → Jobs have "Apply on Wellfound" badge (vs external apply)

User clicks "Learn more"
  → Expands/slides open job details ON THE SAME PAGE (not a new page)
  → Shows a detail panel with full job description
  → An "Apply" button appears in the detail panel

User clicks "Apply"
  → Wellfound native apply modal/form opens
  → May have required fields (resume, cover letter, etc.)
  → If mandatory fields unfilled → pause pipeline → wait for user
```

**Key structural observations from the DOM:**

| Element | DOM Pattern |
|---------|-------------|
| Job listing | `div[data-test="StartupResult"]` — wraps startup section |
| Job card | `div[data-testid="job-listing-list"]` > nested cards |
| Job link | `a.styles_jobLink__US40J` with `href="/jobs/XXXXX-title"` |
| Job title | `span.styles_title__xpQDw` |
| Compensation | `span.styles_compensation__3JnvU` (e.g. "$175k – $200k") |
| Location | `span.styles_location__O9Z62` |
| "Learn more" button | `button[data-test="LearnMoreButton"]` |
| "Apply on Wellfound" badge | `div.styles_badge__44SWu` containing SVG + "Apply on Wellfound" |
| **Detail/Apply panel container** | `div[data-test="DiscoverModal"]` — slide-in panel (same page) |
| **Job detail side** | Left 3/5 of panel — job description, company info |
| **Apply form side** | Right 2/5 of panel (`lg:w-2/5`) — application form |
| **Apply button (detail panel)** | `button[data-test="JobDescriptionSlideIn--SubmitButton"]` |
| **Form textarea** | `textarea[name^="customQuestionAnswers["]` — question-specific textarea |
| **Apply button (mobile footer)** | Bottom fixed bar with `data-test="Button"` + text "Apply" |

---

## 2. Decision Flow (Mermaid)


```mermaid
flowchart TD
    START(["🟢 Start Pipeline"]) --> LOGIN{"👤 User logged in?"}
    LOGIN -->|No| ERR_LOGIN["🛑 Console: [SOS] [Wellfound] Login check FAILED\n→ Set widget error"]
    ERR_LOGIN --> DONE_LOGIN["🏁 Done (error state)"]

    LOGIN -->|Yes| CONSOLE_LOGIN["📋 Console: [SOS] [Wellfound] Login check: OK"]
    CONSOLE_LOGIN --> SCAN{"🔍 Scan page for job cards"}

    SCAN -->|0 jobs found| NO_JOBS["📋 Console: [SOS] [Wellfound] No jobs found on page\n→ Set widget done"]
    NO_JOBS --> DONE_SCAN["🏁 Done (complete)"]

    SCAN -->|N jobs found| LIST_JOBS["📋 Console: [SOS] [Wellfound] Found N jobs\nList each with title/company/salary"]
    LIST_JOBS --> LOOP_START{"🔄 For each job [i of N]:"}

    LOOP_START --> CLICK_LINK["🔗 Click job link\n📋 Console: [SOS] [Wellfound] [i/N] Clicked: Title @ Company"]
    CLICK_LINK --> LEARN_MORE["📖 Click 'Learn more' button\n📋 Console: [SOS] [Wellfound] [i/N] Detail panel opened"]
    LEARN_MORE --> CHECK_EXTERNAL{"🔍 Is 'Apply on Wellfound'\nnative badge present?"}

    CHECK_EXTERNAL -->|No (external)| SKIP_JOB["⏭️ Skip — external apply\n📋 Console: [SOS] [Wellfound] [i/N] Skipped (external)"]
    SKIP_JOB --> NEXT_JOB{" More jobs?"}

    CHECK_EXTERNAL -->|Yes (native)| CLICK_APPLY["🖱️ Click 'Apply' button\n📋 Console: [SOS] [Wellfound] [i/N] Apply modal opened"]
    CLICK_APPLY --> FILL_FORM["📝 Fill visible form fields\nauto-fill name, email, phone"]
    FILL_FORM --> CHECK_MANDATORY{"⚠️ Any mandatory fields\nstill empty?"}

    CHECK_MANDATORY -->|Yes| PAUSE_USER["⏸️ PAUSE pipeline\n📋 Console: [SOS] [Wellfound] [i/N] ⛔ Mandatory fields need attention!\nWidget: 'Fill fields, press Resume'"]
    PAUSE_USER --> WAIT_RESUME{"⏳ Waiting for user\nto click Resume…"}
    WAIT_RESUME -->|User clicks Resume| FILL_FORM

    CHECK_MANDATORY -->|No| SUBMIT["📤 Click Submit / Send\n📋 Console: [SOS] [Wellfound] [i/N] ✅ Submitted!"]
    SUBMIT --> CHECK_CONFIRM{"✅ Application confirmed\nby Wellfound?"}

    CHECK_CONFIRM -->|No| ERR_SUBMIT["🛑 Console: [SOS] [Wellfound] [i/N] ❌ Submit failed\n→ Log error, continue"]
    ERR_SUBMIT --> NEXT_JOB

    CHECK_CONFIRM -->|Yes| DELAY["⏱️ Random delay (2–5s)\n📋 Console: [SOS] [Wellfound] [i/N] Waiting N seconds…"]
    DELAY --> NEXT_JOB

    NEXT_JOB{" More jobs?"}
    NEXT_JOB -->|Yes| LOOP_START
    NEXT_JOB -->|No| COMPLETE["✅ Pipeline complete!\n📋 Console: [SOS] [Wellfound] Processed N jobs: X applied, Y skipped, Z errors"]
    COMPLETE --> DONE_FINAL["🏁 Done"]
```

## 3. Pipeline Flow (Prose)

```
runWellfoundPipeline(signal, onProgress)
│
├── [CONSOLE] "[SOS] [Wellfound] Starting Wellfound pipeline..."
│
├── 1. LOGIN CHECK
│   └── Check for user avatar / profile element
│   └── [CONSOLE] "[SOS] [Wellfound] Login check: OK"
│
├── 2. READ ALL JOB CARDS ON PAGE
│   ├── Find all job links with href="/jobs/XXXXX"
│   ├── Extract title, company, salary, location from each
│   ├── [CONSOLE] "[SOS] [Wellfound] Found N job listings on page"
│   └── [CONSOLE] "[SOS] [Wellfound]    1. Senior Software Engineer @ Meela ($175k-$200k)"
│       [CONSOLE] "[SOS] [Wellfound]    2. Senior Frontend Developer @ Sanctuary Computer ($150k-$200k)"
│       ...
│
├── 3. FOR EACH JOB [i of N]:
│   │
│   ├── 3a. CLICK JOB LINK
│   │   ├── Click the job card / link
│   │   ├── Wait for detail panel to appear (same page)
│   │   └── [CONSOLE] "[SOS] [Wellfound] [1/N] Clicked: Senior Software Engineer @ Meela"
│   │
│   ├── 3b. CLICK "Learn more" BUTTON
│   │   ├── Wait for `button[data-test="LearnMoreButton"]`
│   │   ├── Click it
│   │   ├── Wait for the detail content/panel to render
│   │   └── [CONSOLE] "[SOS] [Wellfound] [1/N] Clicked 'Learn more' — detail panel opened"
│   │
│   ├── 3c. CHECK FOR EXTERNAL APPLY
│   │   ├── Look for "Apply on Wellfound" badge vs external redirect
│   │   ├── If external → skip, mark as skipped
│   │   └── [CONSOLE] "[SOS] [Wellfound] [1/N] ✓ Apply on Wellfound (native)"
│   │
│   ├── 3d. CLICK "Apply" BUTTON
│   │   ├── Wait for apply button in detail panel
│   │   ├── Click it
│   │   ├── Wait for apply modal/form to appear
│   │   └── [CONSOLE] "[SOS] [Wellfound] [1/N] Clicked 'Apply' — modal opened"
│   │
│   ├── 3e. FILL THE APPLICATION FORM
│   │   ├── Find all visible form fields
│   │   ├── Auto-fill what we can (name, email, phone)
│   │   ├── If mandatory fields are empty:
│   │   │   ├── PAUSE pipeline
│   │   │   ├── [CONSOLE] "[SOS] [Wellfound] [1/N] ⛔ Mandatory fields need attention!"
│   │   │   ├── Show on widget: "Fill in required fields, then press Resume"
│   │   │   └── Wait for user to click Resume → continue
│   │   └── [CONSOLE] "[SOS] [Wellfound] [1/N] Application form filled"
│   │
│   ├── 3f. SUBMIT APPLICATION
│   │   ├── Click Submit / Send Application button
│   │   ├── Wait for success confirmation
│   │   └── [CONSOLE] "[SOS] [Wellfound] [1/N] ✅ Application submitted!"
│   │
│   └── 3g. RANDOM DELAY
│       └── [CONSOLE] "[SOS] [Wellfound] [1/N] Waiting N seconds before next job..."
│
├── 4. COMPLETION
│   ├── [CONSOLE] "[SOS] [Wellfound] ✅ Pipeline complete! Processed N of N jobs"
│   └── widget.setDone()
```

---

## 4. Widget: Minimal "Start/Stop/Pause" only


```
┌─────────────────────────────────┐
│ Wellfound         [▶ Start   ] │  ← Default state
├─────────────────────────────────┤
│ Ready — click Start             │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Wellfound         [■ Pause   ] │  ← Running, user can pause
├─────────────────────────────────┤
│ Processing 3/12: SWE @ Meela    │  ← Progress line
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Wellfound         [▶ Resume  ] │  ← Paused (waiting for user)
├─────────────────────────────────┤
│ ⚠️ Fill in required fields     │
│ then press Resume               │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Wellfound         [✓ Done   ] │  ← Complete
├─────────────────────────────────┤
│ Processed 12 jobs: 8 applied    │
│ 3 skipped (external), 1 error   │
└─────────────────────────────────┘
```

**State transitions (same as SOS state machine):**
```
ready → starting → running → paused → running → done
                                   ↓
                                stopped → ready
                                  ↓
                                error → ready
```

---

## 5. File Map (Proposed)


```
src/
├── config/
│   └── sites.ts                     ← Add wellfound preset
│
├── entrypoints/
│   ├── wxt.config.ts                ← Add wellfound.com to matches
│   ├── background.ts                ← Add wellfound URL detection
│   └── content.ts                   ← Add WF branch in createWidget
│
├── pipeline/
│   ├── wellfound.ts                 ← NEW: Main pipeline (simplified)
│   ├── wellfound-constants.ts       ← NEW: Selectors for WF DOM
│   └── index.ts                     ← Add wellfound to switch cases
│
└── utils/
    └── (no new files — reuse dom.ts, event-bus.ts, storage.ts)
```

---

## 6. Implementation Phases


| Phase | What | Details | Deliverable |
|-------|------|---------|-------------|
| **1** | Site preset + URL detection | Add WF to sites.ts, background detection, content script URL match. **Override:** `skipSettingsValidation=true` so the Start button is immediately clickable without any settings | Widget appears on `wellfound.com/jobs` with a ready-to-click Start button |
| **2** | Read job listings | Parse cards, extract title/company/salary, console log everything | `[SOS] [Wellfound] Found 12 jobs` |
| **3** | Click + details | Click job → "Learn more" → verify detail panel | Can navigate through jobs |
| **4** | Apply flow | Detect Apply button → click → fill modal → submit | First working application |
| **5** | Pause-for-input | Detect mandatory fields → pause → wait for user → resume | User fills missing fields |
| **6** | Polish | Error handling, external apply detection, done/error states | Shipped |

---

## 7. Key Technical Open Questions (with answers from DOM sample)

| # | Question | Answer (from `wellfound_apply_page.html`) |
|---|----------|---------------------------------------------|
| 1 | What does the apply panel look like? | **Right-side slide-in** on the same page (`div[data-test="DiscoverModal"]`). Left 3/5 = job details, right 2/5 = application form. Not an iframe, not a new page. |
| 2 | What form fields does it have? | At minimum: a **textarea for a custom question** (`textarea[name^="customQuestionAnswers["]`). The sample shows: "What interests you about working for this company?". |
| 3 | How to submit? | `button[data-test="JobDescriptionSlideIn--SubmitButton"]` with text "Apply". |
| 4 | How does "Learn more" work? | Confirmed: **slide-in SPA panel** on the same page (not a navigation). The panel contains job details AND the apply form side-by-side. |
| 5 | Is there an "already applied" state? | ❓ Not visible in this sample (job hasn't been applied to). |
| 6 | How to detect success after submit? | ❓ Unknown — need to see the post-submit DOM. Possible: button text change, toast notification, modal close. |
| 7 | How do mandatory fields work? | ⚠️ **Important**: The apply form opens **alongside** the job details in the same slide-in. This means our pipeline has to scroll to the right side to interact with the form. |
| 8 | Any daily apply limits? | ❓ Unknown — not visible from this DOM snapshot. |
| 9 | Any CAPTCHAs or anti-bot? | ❓ Unknown — not visible in this sample. |
| 10 | External apply detection? | The "Apply on Wellfound" badge appears in the job card header (`styles_badge__44SWu styles_large__L6bzD` containing an SVG path). If badge is absent → external apply. |
| 11 | Pagination / "Load more"? | ❓ Unknown — not visible in this sample. |


---

## 8. Development Approach


> **Each phase is self-contained and testable.** We build incrementally, verifying each step in DevTools before moving to the next.

1. Load the extension in dev mode (`wxt`)
2. Navigate to `wellfound.com/jobs`
3. Open DevTools console → filter by `[SOS] [Wellfound]`
4. Click the SOS widget Start button
5. Watch the console log each step in real-time
6. Verify DOM interactions with Elements panel
7. Fix → iterate → next phase

No filters. No settings. No complexity. Just click → apply → log → repeat.
