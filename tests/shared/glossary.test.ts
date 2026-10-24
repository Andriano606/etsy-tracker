import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { GLOSSARY, GLOSSARY_SHORT_MAX, GLOSSARY_SOURCES, glossaryEntry } from '../../src/shared/glossary'

// The glossary is what a first-time user reads in every tooltip: plain
// Ukrainian, short, no unexplained English / API jargon, one entry per key.

// Latin words a short text may use without explaining them.
const PLAIN_LATIN = new Set(['Etsy', 'Claude', 'Anthropic', 'USD', 'EUR', 'UAH', 'GBP', 'PDF'])
// Jargon: allowed in a short text only in the entry that explains that very word.
const JARGON = ['API', 'MinIO', 'MCP', 'SKU', 'Docker', 'OAuth', 'keystring', 'Keystring', 'shared secret', 'Shared secret', 'S3', 'token', 'scope', 'listing', 'inventory', 'x-api-key', 'featured_rank', 'taxonomy', 'JSON', 'HTTP', 'URL']
// Snake-case / code-looking identifiers are never OK in a tooltip.
const CODE_LIKE = /\b[a-z]+_[a-z_]+\b|[{}<>]|=>/

const entries = Object.entries(GLOSSARY)

describe('glossary', () => {
  it('has the core concepts a beginner needs (~60 entries)', () => {
    expect(Object.keys(GLOSSARY_SOURCES.core).length).toBeGreaterThanOrEqual(60)
    for (const k of ['etsy', 'shop', 'listing', 'scan', 'baseline', 'favorites', 'views', 'featuredRank', 'reviews', 'salesCount', 'buyerPrice', 'basePrice', 'vat', 'promotion', 'apiKey', 'quota', 'minio', 'mcp', 'statsPeriod'])
      expect(GLOSSARY).toHaveProperty(k)
  })

  it('every entry has a term and a short text ≤ 140 characters', () => {
    for (const [k, e] of entries) {
      expect(e.term.trim(), k).not.toBe('')
      expect(e.short.trim(), k).not.toBe('')
      expect(e.short.length, `${k}: ${e.short.length} chars`).toBeLessThanOrEqual(GLOSSARY_SHORT_MAX)
      if (e.long !== undefined) expect(e.long.trim(), k).not.toBe('')
    }
  })

  it('texts are sentences in Ukrainian (Cyrillic, end with punctuation)', () => {
    for (const [k, e] of entries) {
      expect(/[а-яіїєґ]/i.test(e.short), k).toBe(true)
      expect(/[.!?…)»]$/.test(e.short.trim()), `${k}: "${e.short}"`).toBe(true)
    }
  })

  it('short texts have no unexplained English or API jargon', () => {
    for (const [k, e] of entries) {
      expect(CODE_LIKE.test(e.short), `${k}: code-like text`).toBe(false)
      const own = `${k} ${e.term}`.toLowerCase()
      for (const j of JARGON) {
        if (!e.short.includes(j)) continue
        expect(own.includes(j.toLowerCase()), `${k}: "${j}" is jargon — explain it in its own entry`).toBe(true)
      }
      // Other Latin words: only well-known names (or a word quoted as Etsy calls it, «listing»).
      const latin = e.short.replace(/«[^»]*»/g, '').match(/[A-Za-z]+(?:-[A-Za-z]+)*/g) ?? []
      for (const w of latin) {
        if (PLAIN_LATIN.has(w) || JARGON.some((j) => j.split(' ').includes(w) && own.includes(j.toLowerCase()))) continue
        throw new Error(`${k}: unexplained Latin word "${w}" in "${e.short}"`)
      }
    }
  })

  it('keys are unique across files; area files prefix their keys with the area name', () => {
    const seen = new Map<string, string>()
    for (const [file, list] of Object.entries(GLOSSARY_SOURCES)) {
      for (const k of Object.keys(list)) {
        expect(seen.has(k), `"${k}" is in both ${seen.get(k)} and ${file}`).toBe(false)
        seen.set(k, file)
        if (file === 'core') expect(k, `core key "${k}"`).toMatch(/^[a-z][A-Za-z0-9]*$/)
        else expect(k, `${file} key "${k}"`).toMatch(new RegExp(`^${file}\\.[a-z][A-Za-z0-9.]*$`))
      }
    }
    expect(seen.size).toBe(Object.keys(GLOSSARY).length)
  })

  it('terms are unique (one explanation per concept)', () => {
    const terms = entries.map(([, e]) => e.term.toLowerCase())
    expect(new Set(terms).size).toBe(terms.length)
  })

  it('glossaryEntry: known keys, undefined for unknown or prototype keys', () => {
    expect(glossaryEntry('vat')?.term).toBe('ПДВ')
    expect(glossaryEntry('nope')).toBeUndefined()
    expect(glossaryEntry('toString')).toBeUndefined()
  })

  it('every glossary="…" key used in the renderer exists', () => {
    const root = resolve(__dirname, '../../src/renderer/src')
    const files: string[] = []
    const walk = (d: string): void => {
      for (const f of readdirSync(d)) {
        const p = join(d, f)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.tsx?$/.test(f)) files.push(p)
      }
    }
    walk(root)
    const missing: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(/glossary[=:]\s*\{?\s*["']([\w.]+)["']/g)) if (!glossaryEntry(m[1])) missing.push(`${f}: ${m[1]}`)
    }
    expect(missing).toEqual([])
  })
})
