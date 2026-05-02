/**
 * Result types for the Easy Apply modal interaction flow.
 */

/** Final outcome of filling an Easy Apply modal. */
export type ModalResult =
  | { status: "success"; reason: string }
  | { status: "failed"; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "dailyLimitReached"; reason: string }

/** Result of answering a single question step. */
export interface QuestionStepResult {
  answered: number
  errors: string[]
}

/** Result of a single navigation step (clicking Next / Review / Submit). */
export interface NavigationStepResult {
  action: "next" | "review" | "submit" | "stuck" | "done"
  /** If stuck, the label of the question that caused the block. */
  stuckOnLabel?: string
}
