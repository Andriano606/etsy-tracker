// The app's glossary: plain-Ukrainian explanations of every Etsy / app concept,
// shown by the design-system tooltips (InfoTip, Term, Field, Stat, Toggle…).
// core = shared concepts; one file per UI area for its own terms (keys "<area>.x").
// See docs/design.md → "Glossary".

import type { GlossaryEntries, GlossaryEntry } from './glossary/types'
import { CORE } from './glossary/core'
import { SHELL } from './glossary/shell'
import { SHOP } from './glossary/shop'
import { LISTING } from './glossary/listing'
import { STATS } from './glossary/stats'
import { SETTINGS } from './glossary/settings'
import { MYSHOP } from './glossary/myshop'
import { FEATURES } from './glossary/features'

export type { GlossaryEntries, GlossaryEntry } from './glossary/types'

/** Every glossary file by its name (the tests check that keys don't collide). */
export const GLOSSARY_SOURCES = {
  core: CORE,
  shell: SHELL,
  shop: SHOP,
  listing: LISTING,
  stats: STATS,
  settings: SETTINGS,
  myshop: MYSHOP,
  features: FEATURES
} as const

export const GLOSSARY = {
  ...CORE,
  ...SHELL,
  ...SHOP,
  ...LISTING,
  ...STATS,
  ...SETTINGS,
  ...MYSHOP,
  ...FEATURES
}

/** A known glossary key — a typo is a type error. */
export type GlossaryKey = keyof typeof GLOSSARY

/** The longest `short` text allowed (a tooltip line or two). */
export const GLOSSARY_SHORT_MAX = 140

/** The entry of a key, or undefined (for keys that come from data at runtime). */
export function glossaryEntry(key: string): GlossaryEntry | undefined {
  return Object.prototype.hasOwnProperty.call(GLOSSARY, key) ? (GLOSSARY as GlossaryEntries)[key] : undefined
}
