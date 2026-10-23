import { describe, expect, it } from 'vitest'
import { COMPETE_TOOL_SUMMARY, LIVE_PARTS, TRANSLATION_CODES, TRANSLATION_LANGUAGES } from '../../../src/shared/features/compete'

describe('shared compete', () => {
  it('translation languages = the OAS ListingTranslations keys, each with a Ukrainian name', () => {
    expect(TRANSLATION_CODES).toEqual(['de', 'en-GB', 'en-IN', 'en-US', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt', 'ru', 'sv'])
    for (const l of TRANSLATION_LANGUAGES) expect(l.name).toMatch(/[а-яіїєґ]/i)
  })

  it('live parts of get_product_live_details', () => {
    expect(LIVE_PARTS).toEqual(['properties', 'photos', 'videos', 'personalization', 'variation_photos', 'shipping', 'reviews'])
  })

  it('the tool summary: unique names, Ukrainian texts, read-only', () => {
    const names = COMPETE_TOOL_SUMMARY.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of COMPETE_TOOL_SUMMARY) {
      expect(t.text).toMatch(/[а-яіїєґ]/i)
      expect(t.write).toBeUndefined()
    }
  })
})
