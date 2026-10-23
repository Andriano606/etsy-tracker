import { describe, expect, it } from 'vitest'
import {
  COMMON_COUNTRIES,
  DEFAULT_BUYER_COUNTRY,
  ISO_COUNTRIES,
  countryLabel,
  normalizeCountry
} from '../../src/shared/countries'

describe('countries', () => {
  it('knows all 249 ISO 3166-1 alpha-2 codes; the default and every common one are among them', () => {
    expect(ISO_COUNTRIES.size).toBe(249)
    expect(DEFAULT_BUYER_COUNTRY).toBe('UA')
    for (const c of [DEFAULT_BUYER_COUNTRY, ...COMMON_COUNTRIES.map((x) => x.code)]) expect(ISO_COUNTRIES.has(c)).toBe(true)
    expect(new Set(COMMON_COUNTRIES.map((c) => c.code)).size).toBe(COMMON_COUNTRIES.length)
  })

  it('normalizeCountry: trims, uppercases, UK → GB, rejects anything else', () => {
    expect(normalizeCountry(' ua ')).toBe('UA')
    expect(normalizeCountry('Gb')).toBe('GB')
    expect(normalizeCountry('uk')).toBe('GB')
    expect(normalizeCountry('jp')).toBe('JP')
    for (const bad of ['', 'U', 'UKR', 'XX', 'ZZ', 'EU', '1A', 'U A', null, undefined, 42, {}]) {
      expect(normalizeCountry(bad)).toBeNull()
    }
  })

  it('countryLabel: Ukrainian names for the common list, Intl for others, the code as a last resort', () => {
    expect(countryLabel('UA')).toBe('Україна (UA)')
    expect(countryLabel('GB')).toBe('Велика Британія (GB)')
    expect(countryLabel('JP')).toMatch(/\(JP\)$/)
    expect(countryLabel('QQ')).toBe('QQ')
  })
})
