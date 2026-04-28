# SOS — Auto-Apply Browser Extension

## General Steps Plan

Each feature follows the same pipeline:

1. **Site Analysis** — Navigate to the target site, inspect the DOM, identify selectors for apply button, form fields, submit button, error/success indicators.
2. **Preset Config** — Add a new entry to `src/config/sites.ts` with the site's `SitePreset` (URL pattern, selectors, apply steps).
3. **Pipeline Logic** — Extend `runApplyPipeline` in `src/entrypoints/content.ts` to handle any site-specific quirks (multi-page apply flows, iframes, modals).
4. **Testing** — Load the extension in dev mode, navigate to a real job listing, and verify the pipeline runs end-to-end.
5. **Iterate** — Tune selectors and step timing based on real-world results.

## Feature Roadmap

- [x] Project scaffold (WXT + TS + directory structure)
- [ ] **LinkedIn** — Detect job detail pages, click Easy Apply, fill form fields, submit
- [ ] **Wellfound** — Detect job detail pages, click apply, navigate multi-step modal, submit
- [ ] **Config UI** — Popup or options page to view/manage presets, toggle auto-apply per site
- [ ] **Resume Manager** — Upload/store resumes, attach to applications automatically
- [ ] **Log / History** — Track which jobs were applied to, results (success / error)
- [ ] **Rate Limiting** — Throttle applications to avoid detection / bans
- [ ] **User Profile Store** — Pre-fill common fields (name, email, phone, location) from a saved profile
- [ ] **Additional Sites** — Add more job boards as needed (Indeed, Glassdoor, etc.)
