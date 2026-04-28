/**
 * Personal Info section.
 * Shared across all sites (global).
 * UI only — logic NOT IMPLEMENTED.
 */
import { SettingsSection } from "./base"

export interface PersonalSettings {
  firstName: string
  lastName: string
  phoneNumber: string
  currentCity: string
  street: string
  state: string
  zipcode: string
  country: string
}

export const DEFAULT_PERSONAL: PersonalSettings = {
  firstName: "",
  lastName: "",
  phoneNumber: "",
  currentCity: "",
  street: "",
  state: "",
  zipcode: "",
  country: "",
}

export class PersonalSection extends SettingsSection<PersonalSettings> {
  readonly defaults = DEFAULT_PERSONAL

  /** Check if required personal fields are filled */
  override validate(data: PersonalSettings): string[] {
    const errors: string[] = []
    if (!data.firstName.trim()) errors.push("First name is required")
    if (!data.lastName.trim()) errors.push("Last name is required")
    if (!data.phoneNumber.trim()) errors.push("Phone number is required")
    return errors
  }
}
