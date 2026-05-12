# Per-Site State Machine

Each job board site (LinkedIn, Indeed, etc.) has its own independent state.
The widget reflects the current site's state at any moment.

## States (Visual Legend)

```
 ┌────────────────────────────────────────────┐
 │  🟤 idle        ⚪ needsInfo               │
 │  🟢 ready        🔵 starting               │
 │  🟠 running      🟡 paused                 │
 │  🔴 stopped      🟢 done                   │
 │  🔴 error        🟢 ready-again            │
 └────────────────────────────────────────────┘
```

| State | Color | Widget Display | Description |
|-------|-------|---------------|-------------|
| `idle` | Grey | Start (disabled) | Widget detected on search page, but required settings missing |
| `needsInfo` | Grey+warning | Start (disabled, banner) | User clicked Start but mandatory fields are empty — validation banner shown |
| `ready` | Green | Start (clickable) | All required fields filled, waiting for user action |
| `starting` | Blue | Starting... | Pipeline initializing, search terms loading |
| `running` | Orange | Running (click to stop) | Pipeline actively processing jobs |
| `paused` | Yellow | Paused (click to resume) | Pipeline hit a pause point (after filters, unknown question, pauseBeforeSubmit) |
| `stopped` | Red | Stopped | User manually stopped the pipeline via Stop button |
| `done` | Green | Done ✓ | Pipeline completed all search terms successfully |
| `error` | Red | Error (click to retry) | Pipeline encountered an unrecoverable error |
| `ready-again` | Green | Start (clickable) | After stopped/done/error — settings ready for another run |

## State Transition Diagram

```
                         ┌──────────────┐
                         │    idle       │ ◄── Widget first appears
                         └──────┬───────┘
                                │ All required fields filled
                                ▼
                         ┌──────────────┐
                    ┌───►│    ready      │ ◄── ready-again, needsInfo -> ready
                    │    └──────┬───────┘
                    │           │ User clicks Start
                    │           ▼
                    │    ┌──────────────┐
                    │    │  needsInfo   │ ◄── User clicked Start but missing fields
                    │    └──────┬───────┘
                    │           │ User fills missing fields
                    │           ▼
                    │    ┌──────────────┐
                    │    │   starting   │ ◄── Pipeline initializing
                    │    └──────┬───────┘
                    │           │ Pipeline init OK
                    │           ▼
                    │    ┌──────────────┐
                    │    │   running    │ ◄── Actively processing
                    │    └──┬────┬──┬──┘
                    │       │    │  │
                    │       │    │  │ Pipeline completes all terms
                    │       │    │  ▼
                    │       │    │ ┌──────────────┐
                    │       │    │ │     done      │
                    │       │    │ └──────┬───────┘
                    │       │    │        │
                    │       │    │        ▼
                    │       │    │ ┌──────────────┐
                    │       │    │ │ ready-again   │──► back to ready
                    │       │    │ └──────────────┘
                    │       │    │
                    │       │    │ User clicks Stop
                    │       │    ▼
                    │       │ ┌──────────────┐
                    │       │ │   stopped     │
                    │       │ └──────┬───────┘
                    │       │        │
                    │       │        ▼
                    │       │ ┌──────────────┐
                    │       │ │ ready-again   │──► back to ready
                    │       │ └──────────────┘
                    │       │
                    │       │ Pipeline error
                    │       ▼
                    │ ┌──────────────┐
                    │ │    error     │
                    │ └──────┬───────┘
                    │        │
                    │        ▼
                    │ ┌──────────────┐
                    │ │ ready-again   │──► back to ready
                    │ └──────────────┘
                    │
                    │         Pipeline hits pause point
                    │         (filter pause, unknown question, pauseBeforeSubmit)
                    │
                    │    ┌──────────────┐
                    │    │   paused     │ ◄── Pipeline paused, waits for user
                    │    └──┬───────┬───┘
                    │       │       │
                    │       │       │ User clicks Stop
                    │       │       ▼
                    │       │ ┌──────────────┐
                    │       │ │   stopped     │──► ready-again
                    │       │ └──────────────┘
                    │       │
                    │       │ User clicks Resume
                    │       ▼
                    │    ┌──────────────┐
                    └────│   running    │ (resume processing)
                         └──────────────┘
```

## Per-Site State Persistence

Each site's state is stored in `browser.storage.local` under key `sos_state_<siteId>`.

```typescript
interface SitePipelineState {
  state: SiteWidgetState
  lastUpdated: number        // timestamp
  progress?: {
    currentTerm: string
    currentTermIndex: number
    totalTerms: number
    processedJobs: number
    approvedJobs: number
  }
  error?: string             // last error message if state = error
}
```

This allows:
- Recovering state after page refresh
- Showing correct widget state on navigation back to search page
- Multi-site independence (LinkedIn can be running while Indeed is idle)

### Wellfound Override

Wellfound has **no settings form** — the widget goes straight to `ready` state via `skipSettingsValidation: true` on the `FloatingWidgetOptions`. This means:

- `refreshState()` short-circuits: no mandatory-field check, always transitions to `ready`
- `handleToggle()` skips validation: clicking Start in `idle`/`needsInfo` immediately starts the pipeline
- The widget always appears with an active green Start button

Other sites (LinkedIn, Indeed) continue using the standard validation flow.

## State-Driven Logic Gates

| Operation | Allowed States | Blocked States |
|-----------|---------------|----------------|
| Widget show | idle, needsInfo, ready, ready-again, error | running, starting, paused |
| Start button click | ready, ready-again, error | idle, needsInfo, running, starting, paused |
| Pipeline execution | starting | idle, needsInfo, ready, paused, stopped, done, error |
| Stop button click | running, paused, starting | idle, ready, done, error |
| Resume from pause | paused | all others |
| Settings edit | idle, needsInfo, ready, ready-again, done, error | running, starting, paused |
| Auto-advance to next term | running | all others |

## Implementation

- Type: `src/types/ui.ts` — `SiteWidgetState` union + `SitePipelineState` interface
- Widget: `src/utils/ui.ts` — state transitions, per-site storage, visual rendering
- CSS: `src/styles/ui.css` — colors for `--starting`, `--paused`, `--stopped`, `--error`, `--needs-info`, `--ready-again`
- Orchestration: `src/entrypoints/content.ts` — per-site state manager, gate pipeline logic behind allowed states

## Visual Mockup

```
 ┌─────────────────────────────────┐
 │ LinkedIn           [● Start   ] │  ← idling (grey)
 ├─────────────────────────────────┤
 │ Settings form...                │
 └─────────────────────────────────┘

 ┌─────────────────────────────────┐
 │ LinkedIn           [● Start   ] │  ← ready (green)
 ├─────────────────────────────────┤
 │ Settings form...                │
 └─────────────────────────────────┘

 ┌─────────────────────────────────┐
 │ LinkedIn           [● Starting] │  ← starting (blue, spinning)
 ├─────────────────────────────────┤
 │ Searching "software engineer"...│
 └─────────────────────────────────┘

 ┌─────────────────────────────────┐
 │ LinkedIn           [● Running ] │  ← running (orange, pulsing)
 ├─────────────────────────────────┤
 │ ── Job Progress ──             │
 │ Processing 5/12: SWE @ Google  │
 └─────────────────────────────────┘

 ┌─────────────────────────────────┐
 │ LinkedIn           [▶ Paused  ] │  ← paused (yellow)
 ├─────────────────────────────────┤
 │ Paused after filters:           │
 │ "SWE @ Google" ready for review │
 │ [▶ Resume] [■ Stop]           │
 └─────────────────────────────────┘

 ┌─────────────────────────────────┐
 │ LinkedIn           [■ Stopped ] │  ← stopped (red, brief)
 ├─────────────────────────────────┤
 │ Pipeline stopped by user        │
 └─────────────────────────────────┘

 ┌─────────────────────────────────┐
 │ LinkedIn           [✓ Done   ] │  ← done (green, solid)
 ├─────────────────────────────────┤
 │ Completed: 24 jobs processed    │
 └─────────────────────────────────┘

 ┌─────────────────────────────────┐
 │ LinkedIn           [! Error  ] │  ← error (red)
 ├─────────────────────────────────┤
 │ Error: Could not find search    │
 │ input for "software engineer"   │
 └─────────────────────────────────┘

 ┌─────────────────────────────────┐
 │ LinkedIn           [● Start   ] │  ← ready-again (green)
 ├─────────────────────────────────┤
 │ Last run: 24 jobs processed     │
 └─────────────────────────────────┘
```
