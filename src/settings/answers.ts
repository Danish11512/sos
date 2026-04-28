/**
 * Application Answers section.
 * Per-site.
 * UI only — logic NOT IMPLEMENTED.
 */
import { SettingsSection } from "./base"

export interface AnswerSettings {
  yearsOfExperience: string
  requireVisa: string
  website: string
  linkedIn: string
  usCitizenship: string
  desiredSalary: number
  currentCtc: number
  noticePeriod: number
  linkedinHeadline: string
  linkedinSummary: string
  coverLetter: string
  recentEmployer: string
  confidenceLevel: string
}

export const DEFAULT_ANSWERS: AnswerSettings = {
  yearsOfExperience: "",
  requireVisa: "No",
  website: "",
  linkedIn: "",
  usCitizenship: "",
  desiredSalary: 0,
  currentCtc: 0,
  noticePeriod: 0,
  linkedinHeadline: "",
  linkedinSummary: "",
  coverLetter: "",
  recentEmployer: "",
  confidenceLevel: "",
}

export class AnswerSection extends SettingsSection<AnswerSettings> {
  readonly defaults = DEFAULT_ANSWERS
}
