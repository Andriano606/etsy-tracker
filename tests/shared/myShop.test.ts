import { describe, expect, it } from 'vitest'
import {
  EU_COUNTRIES,
  isMyListingState,
  listingPatch,
  listingPatchForm,
  listingPatchProblems,
  materialProblems,
  shopPatch,
  shopPatchForm,
  shopPatchProblems,
  splitList,
  tagProblems,
  titleProblems
} from '../../src/shared/myShop'
import type { MyListing, MyShopProfile } from '../../src/shared/types'

const listing = (over: Partial<MyListing> = {}): MyListing => ({
  listingId: 1,
  state: 'active',
  title: 'Budget Planner',
  description: 'Desc',
  tags: ['budget', 'planner'],
  materials: ['paper'],
  shouldAutoRenew: true,
  type: 'download',
  priceAmount: 500,
  priceDivisor: 100,
  currency: 'USD',
  quantity: 1,
  url: null,
  imageUrl: null,
  updatedAt: null,
  endingAt: null,
  ...over
})

const form = (l: MyListing, over: Partial<Parameters<typeof listingPatch>[1]> = {}) => ({
  title: l.title,
  description: l.description,
  tags: l.tags.join(', '),
  materials: l.materials.join(', '),
  shouldAutoRenew: l.shouldAutoRenew ?? false,
  state: l.state,
  ...over
})

describe('splitList', () => {
  it('trims, collapses spaces, drops empties and case-insensitive duplicates', () => {
    expect(splitList(' a ,b  c,, A, d ')).toEqual(['a', 'b c', 'd'])
    expect(splitList('')).toEqual([])
  })
})

describe('Etsy field rules', () => {
  it('title: required, ≤ 140, allowed characters, %:&+ once each', () => {
    expect(titleProblems('Budget Planner – Google Sheets™ (2026)')).toEqual([])
    expect(titleProblems('  ')).toContain('Назва не може бути порожньою.')
    expect(titleProblems('x'.repeat(141))[0]).toContain('довша за 140')
    expect(titleProblems('Planner & Tracker & more')).toContain('Символ «&» у назві можна використати лише один раз.')
    expect(titleProblems('Planner 😀')[0]).toContain('недозволений символ «😀»')
  })

  it('tags: ≤ 13, each ≤ 20, letters/digits/spaces/-\'™©®', () => {
    expect(tagProblems(["kid's planner", 'budget-2026'])).toEqual([])
    expect(tagProblems(Array.from({ length: 14 }, (_, i) => `t${i}`))[0]).toContain('не більше 13')
    expect(tagProblems(['a'.repeat(21)])[0]).toContain('довший за 20')
    expect(tagProblems(['budget/plan'])[0]).toContain('недозволений символ «/»')
  })

  it('materials: letters, digits and spaces only', () => {
    expect(materialProblems(['digital file', 'PDF 2'])).toEqual([])
    expect(materialProblems(['paper-cotton'])[0]).toContain('«-»')
    expect(materialProblems(Array.from({ length: 14 }, (_, i) => `m${i}`))[0]).toContain('не більше 13')
  })

  it('a patch: description not empty, state only active/inactive', () => {
    expect(listingPatchProblems({ description: '  ' })).toContain('Опис не може бути порожнім.')
    expect(listingPatchProblems({ state: 'draft' as 'active' })[0]).toContain('активний')
    expect(listingPatchProblems({})).toEqual([])
  })

  it('isMyListingState', () => {
    expect(['active', 'draft', 'inactive', 'expired', 'sold_out'].every(isMyListingState)).toBe(true)
    expect(isMyListingState('removed')).toBe(false)
    expect(isMyListingState(1)).toBe(false)
  })
})

describe('listingPatch (only what changed)', () => {
  it('nothing changed → empty patch', () => {
    const l = listing()
    expect(listingPatch(l, form(l))).toEqual({})
  })

  it('each field on its own; tags/materials compared as normalized lists', () => {
    const l = listing()
    expect(listingPatch(l, form(l, { title: ' New title ' }))).toEqual({ title: 'New title' })
    expect(listingPatch(l, form(l, { tags: 'budget,planner , ' }))).toEqual({})
    expect(listingPatch(l, form(l, { tags: 'planner, budget' }))).toEqual({ tags: ['planner', 'budget'] })
    expect(listingPatch(l, form(l, { tags: '' }))).toEqual({ tags: [] })
    expect(listingPatch(l, form(l, { materials: 'paper, ink' }))).toEqual({ materials: ['paper', 'ink'] })
    expect(listingPatch(l, form(l, { description: 'Desc\n' }))).toEqual({ description: 'Desc\n' })
    expect(listingPatch(l, form(l, { shouldAutoRenew: false }))).toEqual({ shouldAutoRenew: false })
    expect(listingPatch(l, form(l, { state: 'inactive' }))).toEqual({ state: 'inactive' })
  })

  it('an unknown auto-renew counts as off; only active/inactive are states to send', () => {
    const l = listing({ shouldAutoRenew: null, state: 'draft' })
    expect(listingPatch(l, form(l, { shouldAutoRenew: false }))).toEqual({})
    expect(listingPatch(l, form(l, { shouldAutoRenew: true }))).toEqual({ shouldAutoRenew: true })
    expect(listingPatch(l, form(l, { state: 'active' }))).toEqual({ state: 'active' })
    expect(listingPatch(l, form(l, { state: 'expired' }))).toEqual({})
  })

  it('listingPatchForm: Etsy’s field names', () => {
    expect(
      listingPatchForm({ title: 'T', description: 'D', tags: ['a'], materials: [], shouldAutoRenew: true, state: 'active' })
    ).toEqual({ title: 'T', description: 'D', tags: ['a'], materials: [], should_auto_renew: true, state: 'active' })
    expect(listingPatchForm({})).toEqual({})
  })
})

describe('shop texts', () => {
  const shop = (over: Partial<MyShopProfile> = {}): MyShopProfile => ({
    shopId: 1,
    shopName: 'S',
    title: 'Title',
    announcement: 'A',
    saleMessage: 'S',
    digitalSaleMessage: 'D',
    policyAdditional: '',
    inEu: false,
    countryIso: 'UA',
    ...over
  })
  const f = (p: MyShopProfile, over = {}) => ({
    title: p.title,
    announcement: p.announcement,
    saleMessage: p.saleMessage,
    digitalSaleMessage: p.digitalSaleMessage,
    policyAdditional: p.policyAdditional,
    ...over
  })

  it('only changed texts; the title trimmed', () => {
    const p = shop()
    expect(shopPatch(p, f(p))).toEqual({})
    expect(shopPatch(p, f(p, { title: ' Title ', announcement: 'New' }))).toEqual({ announcement: 'New' })
    expect(shopPatchForm({ announcement: 'New', digitalSaleMessage: 'X' })).toEqual({
      announcement: 'New',
      digital_sale_message: 'X'
    })
  })

  it('additional policies only for EU shops (Etsy errors otherwise)', () => {
    expect(shopPatch(shop(), f(shop(), { policyAdditional: 'x' }))).toEqual({})
    const eu = shop({ inEu: true, countryIso: 'PL' })
    expect(shopPatch(eu, f(eu, { policyAdditional: 'x' }))).toEqual({ policyAdditional: 'x' })
    expect(shopPatchProblems({ policyAdditional: 'x' }, false)[0]).toContain('ЄС')
    expect(shopPatchProblems({ policyAdditional: 'x' }, true)).toEqual([])
    expect(EU_COUNTRIES.has('PL')).toBe(true)
    expect(EU_COUNTRIES.has('UA')).toBe(false)
    expect(EU_COUNTRIES.size).toBe(27)
  })
})

import { newListingForm, newListingProblems, parsePrice } from '../../src/shared/myShop'
import type { NewListingInput } from '../../src/shared/types'

const draft = (over: Partial<NewListingInput> = {}): NewListingInput => ({
  type: 'download',
  title: 'Budget Planner',
  description: 'A planner',
  price: '5.99',
  quantity: 999,
  taxonomyId: 2,
  whoMade: 'i_did',
  whenMade: 'made_to_order',
  isSupply: false,
  tags: ['budget'],
  materials: [],
  shouldAutoRenew: true,
  shippingProfileId: null,
  readinessStateId: null,
  images: [],
  files: [],
  publish: false,
  ...over
})

describe('new listings', () => {
  it('parsePrice: positive, ≤ 2 decimals, comma or dot', () => {
    expect(parsePrice(' 5,99 ')).toBe(5.99)
    expect(parsePrice('12')).toBe(12)
    for (const bad of ['', '0', '-1', '1.999', 'abc', '1e3']) expect(parsePrice(bad)).toBeNull()
  })

  it('a digital draft needs no photo or file; publishing needs both', () => {
    expect(newListingProblems(draft())).toEqual([])
    const p = newListingProblems(draft({ publish: true }))
    expect(p.join(' ')).toContain('хоча б одне фото')
    expect(p.join(' ')).toContain('хоча б один файл')
    expect(newListingProblems(draft({ publish: true, images: ['i'], files: ['f'] }))).toEqual([])
  })

  it('required fields and limits', () => {
    const all = newListingProblems(
      draft({ title: '', description: ' ', price: 'x', quantity: 0, taxonomyId: null, whoMade: '?', whenMade: '?' })
    ).join(' ')
    for (const m of ['Назва', 'Опис', 'Ціна', 'Кількість', 'категорію', 'хто виготовив', 'коли виготовлено']) {
      expect(all).toContain(m)
    }
    expect(newListingProblems(draft({ files: ['1', '2', '3', '4', '5', '6'] })).join(' ')).toContain('не більше 5')
    expect(newListingProblems(draft({ images: Array.from({ length: 11 }, String) })).join(' ')).toContain('не більше 10')
  })

  it('physical: a shipping profile is required and files are not allowed', () => {
    expect(newListingProblems(draft({ type: 'physical' })).join(' ')).toContain('профіль доставки')
    expect(newListingProblems(draft({ type: 'physical', shippingProfileId: 1, files: ['f'] })).join(' ')).toContain(
      'лише до цифрового'
    )
    expect(newListingProblems(draft({ type: 'physical', shippingProfileId: 1 }))).toEqual([])
  })

  it('newListingForm: Etsy’s createDraftListing fields', () => {
    expect(newListingForm(draft({ title: ' T ', price: '5,5' }))).toEqual({
      title: 'T',
      description: 'A planner',
      price: 5.5,
      quantity: 999,
      who_made: 'i_did',
      when_made: 'made_to_order',
      is_supply: false,
      taxonomy_id: 2,
      type: 'download',
      should_auto_renew: true,
      tags: ['budget']
    })
    expect(newListingForm(draft({ type: 'physical', shippingProfileId: 7, readinessStateId: 8, materials: ['wood'] }))).toMatchObject({
      type: 'physical',
      shipping_profile_id: 7,
      readiness_state_id: 8,
      materials: ['wood']
    })
    expect(newListingForm(draft({ shippingProfileId: 7 }))).not.toHaveProperty('shipping_profile_id')
  })
})

import { EMPTY_DRAFT_FIELDS, draftInput, normalizeDraftFields } from '../../src/shared/myShop'

describe('draft helpers', () => {
  it('draftInput: physical drops files, digital drops shipping', () => {
    const f = { ...EMPTY_DRAFT_FIELDS, shippingProfileId: 5, readinessStateId: 6 }
    expect(draftInput(f, ['p'], ['f'], true)).toMatchObject({ type: 'download', files: ['f'], shippingProfileId: null, readinessStateId: null, publish: true })
    expect(draftInput({ ...f, type: 'physical' }, ['p'], ['f'], false)).toMatchObject({ files: [], shippingProfileId: 5, readinessStateId: 6 })
  })

  it('normalizeDraftFields: anything → complete fields with defaults', () => {
    expect(normalizeDraftFields(null)).toEqual(EMPTY_DRAFT_FIELDS)
    expect(
      normalizeDraftFields({ type: 'physical', price: 5.5, tags: ['a', 3], isSupply: 'yes', shouldAutoRenew: false, quantity: 'x', extra: 1 })
    ).toEqual({ ...EMPTY_DRAFT_FIELDS, type: 'physical', price: '5.5', tags: ['a'], shouldAutoRenew: false })
  })
})

describe('Etsy listing links', () => {
  it('the public page and the seller editor', async () => {
    const { etsyListingUrl, etsyListingEditUrl } = await import('../../src/shared/myShop')
    const { isAllowedExternalUrl } = await import('../../src/shared/externalUrl')
    expect(etsyListingUrl(4242)).toBe('https://www.etsy.com/listing/4242')
    expect(etsyListingEditUrl(4242)).toBe('https://www.etsy.com/your/shops/me/listing-editor/edit/4242')
    expect(isAllowedExternalUrl(etsyListingUrl(1))).toBe(true)
    expect(isAllowedExternalUrl(etsyListingEditUrl(1))).toBe(true)
  })
})
