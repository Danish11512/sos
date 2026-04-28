/**
 * Pipeline Controls section.
 * Per-site.
 * UI only — logic NOT IMPLEMENTED.
 */
import { SettingsSection } from "./base"

export interface PipelineSettings {
  pauseBeforeSubmit: boolean
  pauseAtFailedQuestion: boolean
  overwritePreviousAnswers: boolean
  closeTabs: boolean
  followCompanies: boolean
  runNonStop: boolean
  runInBackground: boolean
  alternateSortby: boolean
  cycleDatePosted: boolean
  stopDateCycleAt24hr: boolean
}

export const DEFAULT_PIPELINE: PipelineSettings = {
  pauseBeforeSubmit: true,
  pauseAtFailedQuestion: true,
  overwritePreviousAnswers: false,
  closeTabs: false,
  followCompanies: false,
  runNonStop: false,
  runInBackground: false,
  alternateSortby: true,
  cycleDatePosted: true,
  stopDateCycleAt24hr: true,
}

export class PipelineSection extends SettingsSection<PipelineSettings> {
  readonly defaults = DEFAULT_PIPELINE
}
