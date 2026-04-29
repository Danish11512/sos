/**
 * DEPRECATED: This file was replaced by URL-param-based filter application
 * in src/pipeline/linkedin.ts and src/pipeline/indeed.ts.
 *
 * The generic DOM-based approach was too fragile across site versions.
 * Filter config is now built into each site's pipeline via URL parameters
 * (e.g. f_E=2,3 for LinkedIn experience levels) with minimal DOM
 * interaction only for toggles that have no URL equivalent.
 *
 * See applyLinkedInExtraFilters() and applyIndeedExtraFilters() instead.
 */
export {}
