/** One glossary entry: what a beginner sees in a tooltip (InfoTip, Term, Field, Stat…). */
export interface GlossaryEntry {
  /** The name of the thing as the UI says it, in Ukrainian ("Обране"). */
  term: string
  /** One or two plain-Ukrainian sentences for a tooltip, ≤ 140 characters. */
  short: string
  /** Optional longer explanation shown under `short` when the tooltip is opened by a click. */
  long?: string
}

/**
 * A file of entries. Declare a file with `satisfies GlossaryEntries` (not a type
 * annotation) so its keys stay literal and `GlossaryKey` catches typos.
 */
export type GlossaryEntries = Record<string, GlossaryEntry>
