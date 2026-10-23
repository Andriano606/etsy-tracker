import { describe, expect, it } from 'vitest'
import { competeFeature } from '../../../src/main/features/compete'
import { upsertListing } from '../../../src/main/db'
import { PROPERTY_NOT_IMPLEMENTED } from '../../../src/main/features/compete/api'
import { NOT_AVAILABLE, SECTION_PRODUCTS_MAX, TRANSLATION_NOT_FOUND } from '../../../src/main/features/compete/mcp'
import { COMPETE_TOOL_SUMMARY } from '../../../src/shared/features/compete'
import { callTool, featureCtx, mcpDeps, runAction, signedIn, signedOut } from '../../helpers/features'
import { mkInput, seedShop } from '../../helpers/db'
import type { FakeCall } from '../../helpers/fakeFetch'

const SHOP = 1001
const LISTING = 2002
const A = '/v3/application'

const usd = (amount: number) => ({ amount, divisor: 100, currency_code: 'USD' })

// ---- OAS-shaped answers
const sections = {
  count: 2,
  results: [
    { shop_section_id: 11, title: 'Planners &amp; Calendars', rank: 2, user_id: 9, active_listing_count: 5 },
    { shop_section_id: 10, title: 'Budget', rank: 1, user_id: 9, active_listing_count: 3 }
  ]
}
const listingA = {
  listing_id: LISTING,
  user_id: 9,
  shop_id: SHOP,
  title: 'Budget Planner &amp; Tracker',
  description: 'A planner',
  state: 'active',
  quantity: 999,
  shop_section_id: 10,
  featured_rank: 1,
  url: 'https://www.etsy.com/listing/2002/budget',
  num_favorers: 42,
  price: usd(1250),
  tags: ['budget']
}
const listingB = {
  ...listingA,
  listing_id: 2003,
  title: 'Wall calendar — see etsy.com/shop/Other',
  shop_section_id: 11,
  featured_rank: -1,
  url: 'https://evil.example.com/listing/2003',
  price: usd(500)
}
const policy = { return_policy_id: 77, shop_id: SHOP, accepts_returns: true, accepts_exchanges: false, return_deadline: 30 }
const properties = {
  count: 2,
  results: [
    { property_id: 200, property_name: 'Primary color', scale_id: null, scale_name: null, value_ids: [1], values: ['Black &amp; white'] },
    { property_id: 47626759834, property_name: 'Width', scale_id: 5, scale_name: 'Inches', value_ids: [], values: ['8.5'] }
  ]
}
const image = (id: number, rank: number, url = `https://i.etsystatic.com/1/r/il/${id}`) => ({
  listing_id: LISTING,
  listing_image_id: id,
  hex_code: 'E1D5C9',
  red: 225,
  green: 213,
  blue: 201,
  hue: 30,
  saturation: 10,
  brightness: 88,
  is_black_and_white: false,
  creation_tsz: 1_700_000_000,
  created_timestamp: 1_700_000_000,
  rank,
  url_75x75: `${url}/75.jpg`,
  url_170x135: `${url}/170.jpg`,
  url_570xN: `${url}/570.jpg`,
  url_fullxfull: `${url}/full.jpg`,
  full_height: 2000,
  full_width: 3000,
  alt_text: 'Planner on desk &amp; pen'
})
const video = {
  video_id: 601,
  height: 1080,
  width: 1920,
  thumbnail_url: 'https://v.etsystatic.com/video/thumb.jpg',
  video_url: 'https://v.etsystatic.com/video/v.mp4',
  video_state: 'active'
}
const review = {
  shop_id: SHOP,
  listing_id: LISTING,
  rating: 5,
  review: 'Great &amp; useful! Found it on etsy.com/shop/Other',
  language: 'en',
  image_url_fullxfull: 'https://i.etsystatic.com/r/review.jpg',
  create_timestamp: 1_700_000_100,
  created_timestamp: 1_700_000_100,
  update_timestamp: 1_700_000_200,
  updated_timestamp: 1_700_000_200
}
const personalization = {
  personalization_questions: [
    {
      question_id: 3,
      question_text: 'Your name &amp; date',
      instructions: 'Max 20',
      question_type: 'text_input',
      required: true,
      max_allowed_characters: 20,
      max_allowed_files: null,
      add_on_price: usd(200),
      options: null
    },
    { question_id: 4, question_text: 'Color', instructions: null, question_type: 'dropdown', required: false, options: [{ option_id: 1, label: 'Red' }] }
  ]
}
const translation = { listing_id: LISTING, language: 'de', title: 'Budgetplaner', description: 'Ein Planer &amp; mehr', tags: ['budget', 'planer'] }
const variationImages = { count: 1, results: [{ property_id: 200, value_id: 1, value: 'Black', image_id: 501 }] }
const profile = {
  shipping_profile_id: 88,
  title: 'Standard',
  user_id: 9,
  origin_country_iso: 'US',
  is_deleted: false,
  shipping_profile_destinations: [
    {
      shipping_profile_destination_id: 1,
      shipping_profile_id: 88,
      origin_country_iso: 'US',
      destination_country_iso: 'UA',
      destination_region: 'none',
      primary_cost: usd(1500),
      secondary_cost: usd(500),
      shipping_carrier_id: 1,
      mail_class: 'usps_first_class',
      min_delivery_days: 5,
      max_delivery_days: 10
    }
  ],
  shipping_profile_upgrades: [
    {
      shipping_profile_id: 88,
      upgrade_id: 5,
      upgrade_name: 'Express',
      type: 1,
      rank: 1,
      language: 'en',
      price: usd(1000),
      secondary_price: usd(300),
      shipping_carrier_id: 1,
      mail_class: 'usps_priority',
      min_delivery_days: 2,
      max_delivery_days: 4
    }
  ],
  origin_postal_code: '10001',
  profile_type: 'manual',
  domestic_handling_fee: 0,
  international_handling_fee: 1.5
}
const carriers = {
  count: 1,
  results: [
    {
      shipping_carrier_id: 1,
      name: 'USPS',
      domestic_classes: [{ mail_class_key: 'usps_first_class', name: 'First Class' }],
      international_classes: [{ mail_class_key: 'usps_priority_intl', name: 'Priority Mail International' }]
    }
  ]
}

const routes = {
  [`GET ${A}/shops/{s}/sections`]: { body: sections },
  [`GET ${A}/shops/{s}/sections/{id}`]: { body: sections.results[1] },
  [`GET ${A}/shops/{s}/shop-sections/listings`]: { body: { count: 2, results: [listingA, listingB] } },
  [`GET ${A}/shops/{s}/listings/featured`]: { body: { count: 1, results: [listingA] } },
  [`GET ${A}/shops/{s}/policies/return`]: { body: { count: 1, results: [policy] } },
  [`GET ${A}/shops/{s}/policies/return/{id}`]: { body: policy },
  [`GET ${A}/shops/{s}/listings/{l}/properties`]: { body: properties },
  [`GET ${A}/listings/{l}/properties/{p}`]: { body: properties.results[0] },
  [`GET ${A}/listings/{l}/images`]: { body: { count: 2, results: [image(501, 2), image(500, 1, 'http://i.etsystatic.com/x')] } },
  [`GET ${A}/listings/{l}/images/{i}`]: { body: image(501, 2) },
  [`GET ${A}/listings/{l}/videos`]: { body: { count: 1, results: [video] } },
  [`GET ${A}/listings/{l}/videos/{v}`]: { body: { ...video, thumbnail_url: 'https://evil.example.com/t.jpg' } },
  [`GET ${A}/listings/{l}/reviews`]: { body: { count: 41, results: [review] } },
  [`GET ${A}/listings/{l}/personalization`]: { body: personalization },
  [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: { body: translation },
  [`GET ${A}/shops/{s}/listings/{l}/variation-images`]: { body: variationImages },
  [`GET ${A}/listings/batch/shipping`]: { body: { count: 1, results: [{ ...listingA, shipping_profile: profile }] } },
  [`GET ${A}/shipping-carriers`]: { body: carriers },
  [`GET ${A}/listings/{l}`]: { body: listingA }
}

const lastCall = (calls: FakeCall[]): FakeCall => calls[calls.length - 1]
/** The request was a plain API-key GET of `path` with exactly `query`. */
function expectGet(c: FakeCall, path: string, query: Record<string, string> = {}, oauth = false) {
  expect(c.method).toBe('GET')
  expect(c.url.pathname).toBe(path)
  expect(Object.fromEntries(c.url.searchParams)).toEqual(query)
  expect(c.headers['x-api-key']).toBe('keystring:secret')
  expect(c.headers.authorization).toBe(oauth ? 'Bearer tok' : undefined)
  expect(c.body).toBeNull()
}

async function act(action: string, args: Record<string, unknown>, r: Record<string, unknown> = routes, status = signedIn()) {
  const { ctx, fetch } = featureCtx(r as typeof routes, { status })
  const value = await runAction(competeFeature, action, args, ctx)
  return { value: value as any, calls: fetch.calls }
}

describe('compete feature — actions', () => {
  it('sections: getShopSections, entities decoded, display order', async () => {
    const { value, calls } = await act('sections', { shopId: SHOP })
    expectGet(lastCall(calls), `${A}/shops/${SHOP}/sections`)
    expect(value).toEqual([
      { id: 10, title: 'Budget', rank: 1, activeListingCount: 3 },
      { id: 11, title: 'Planners & Calendars', rank: 2, activeListingCount: 5 }
    ])
  })

  it('section: getShopSection', async () => {
    const { value, calls } = await act('section', { shopId: SHOP, sectionId: 10 })
    expectGet(lastCall(calls), `${A}/shops/${SHOP}/sections/10`)
    expect(value).toEqual({ id: 10, title: 'Budget', rank: 1, activeListingCount: 3 })
  })

  it('sectionListings: getListingsByShopSectionId with comma-joined ids, limit 100 and offset; URLs validated', async () => {
    const { value, calls } = await act('sectionListings', { shopId: SHOP, sectionIds: [10, 11, 10], offset: 100 })
    expectGet(lastCall(calls), `${A}/shops/${SHOP}/shop-sections/listings`, { shop_section_ids: '10,11', limit: '100', offset: '100' })
    expect(value.count).toBe(2)
    expect(value.offset).toBe(100)
    expect(value.listings[0]).toEqual({
      listingId: LISTING,
      title: 'Budget Planner & Tracker',
      price: { amount: 1250, divisor: 100, currency: 'USD' },
      state: 'active',
      quantity: 999,
      featuredRank: 1,
      numFavorers: 42,
      shopSectionId: 10,
      url: 'https://www.etsy.com/listing/2002/budget'
    })
    expect(value.listings[1]).toMatchObject({ listingId: 2003, url: null, featuredRank: null })
    const one = await act('sectionListings', { shopId: SHOP, sectionId: 11 })
    expect(lastCall(one.calls).url.searchParams.get('shop_section_ids')).toBe('11')
    expect(lastCall(one.calls).url.searchParams.get('offset')).toBe('0')
  })

  it('featured: getFeaturedListingsByShop', async () => {
    const { value, calls } = await act('featured', { shopId: SHOP })
    expectGet(lastCall(calls), `${A}/shops/${SHOP}/listings/featured`, { limit: '100', offset: '0' })
    expect(value).toMatchObject({ count: 1, offset: 0, listings: [{ listingId: LISTING, featuredRank: 1 }] })
  })

  it('returnPolicies / returnPolicy', async () => {
    const all = await act('returnPolicies', { shopId: SHOP })
    expectGet(lastCall(all.calls), `${A}/shops/${SHOP}/policies/return`)
    expect(all.value).toEqual([{ id: 77, acceptsReturns: true, acceptsExchanges: false, returnDeadline: 30 }])
    const one = await act('returnPolicy', { shopId: SHOP, policyId: 77 })
    expectGet(lastCall(one.calls), `${A}/shops/${SHOP}/policies/return/77`)
    expect(one.value).toEqual({ id: 77, acceptsReturns: true, acceptsExchanges: false, returnDeadline: 30 })
  })

  it('properties / property', async () => {
    const all = await act('properties', { shopId: SHOP, listingId: LISTING })
    expectGet(lastCall(all.calls), `${A}/shops/${SHOP}/listings/${LISTING}/properties`)
    expect(all.value).toEqual([
      { propertyId: 200, name: 'Primary color', scaleId: null, scaleName: null, valueIds: [1], values: ['Black & white'] },
      { propertyId: 47626759834, name: 'Width', scaleId: 5, scaleName: 'Inches', valueIds: [], values: ['8.5'] }
    ])
    const one = await act('property', { listingId: LISTING, propertyId: 200 })
    expectGet(lastCall(one.calls), `${A}/listings/${LISTING}/properties/200`)
    expect(one.value.name).toBe('Primary color')
  })

  it('property: the OAS 501 ("in development") → a clear message; that client never asks again', async () => {
    const { ctx, fetch } = featureCtx({ [`GET ${A}/listings/{l}/properties/{p}`]: { status: 501, body: { error: 'Not implemented' } } })
    await expect(runAction(competeFeature, 'property', { listingId: LISTING, propertyId: 200 }, ctx)).rejects.toThrow(PROPERTY_NOT_IMPLEMENTED)
    const asked = fetch.calls.length
    expect(asked).toBeGreaterThan(0)
    expect(fetch.calls.every((c) => c.url.pathname === `${A}/listings/${LISTING}/properties/200`)).toBe(true)
    await expect(runAction(competeFeature, 'property', { listingId: LISTING, propertyId: 300 }, ctx)).rejects.toThrow('HTTP 501')
    expect(fetch.calls).toHaveLength(asked)
    // Another failure is Etsy's own message, and doesn't stop later reads.
    const other = featureCtx({ [`GET ${A}/listings/{l}/properties/{p}`]: { status: 404 } })
    await expect(runAction(competeFeature, 'property', { listingId: LISTING, propertyId: 1 }, other.ctx)).rejects.toThrow('HTTP 404')
    await expect(runAction(competeFeature, 'property', { listingId: LISTING, propertyId: 1 }, other.ctx)).rejects.toThrow('HTTP 404')
    expect(other.fetch.calls).toHaveLength(2)
  })

  it('images: getListingImages in rank order, non-CDN URLs dropped; image: getListingImage', async () => {
    const all = await act('images', { listingId: LISTING })
    expectGet(lastCall(all.calls), `${A}/listings/${LISTING}/images`)
    expect(all.value.map((i: { id: number }) => i.id)).toEqual([500, 501])
    expect(all.value[0]).toMatchObject({ url570: '', urlFull: '' })
    expect(all.value[1]).toEqual({
      id: 501,
      rank: 2,
      url570: 'https://i.etsystatic.com/1/r/il/501/570.jpg',
      urlFull: 'https://i.etsystatic.com/1/r/il/501/full.jpg',
      width: 3000,
      height: 2000,
      altText: 'Planner on desk & pen',
      hexCode: 'E1D5C9',
      red: 225,
      green: 213,
      blue: 201,
      hue: 30,
      saturation: 10,
      brightness: 88,
      isBlackAndWhite: false,
      createdAt: 1_700_000_000
    })
    const one = await act('image', { listingId: LISTING, imageId: 501 })
    expectGet(lastCall(one.calls), `${A}/listings/${LISTING}/images/501`)
    expect(one.value.id).toBe(501)
  })

  it('videos / video: thumbnail only when on the CDN', async () => {
    const all = await act('videos', { listingId: LISTING })
    expectGet(lastCall(all.calls), `${A}/listings/${LISTING}/videos`)
    expect(all.value).toEqual([
      { id: 601, width: 1920, height: 1080, state: 'active', thumbnailUrl: 'https://v.etsystatic.com/video/thumb.jpg' }
    ])
    const one = await act('video', { listingId: LISTING, videoId: 601 })
    expectGet(lastCall(one.calls), `${A}/listings/${LISTING}/videos/601`)
    expect(one.value.thumbnailUrl).toBeNull()
  })

  it('reviews: getReviewsByListing paged (default 20)', async () => {
    const { value, calls } = await act('reviews', { listingId: LISTING, offset: 20 })
    expectGet(lastCall(calls), `${A}/listings/${LISTING}/reviews`, { limit: '20', offset: '20' })
    expect(value).toEqual({
      count: 41,
      offset: 20,
      reviews: [
        {
          shopId: SHOP,
          listingId: LISTING,
          rating: 5,
          text: 'Great & useful! Found it on etsy.com/shop/Other',
          language: 'en',
          imageUrl: 'https://i.etsystatic.com/r/review.jpg',
          createdAt: 1_700_000_100,
          updatedAt: 1_700_000_200
        }
      ]
    })
    const big = await act('reviews', { listingId: LISTING, limit: 100 })
    expect(lastCall(big.calls).url.searchParams.get('limit')).toBe('100')
  })

  it('personalization: the questions, add-on price, options', async () => {
    const { value, calls } = await act('personalization', { listingId: LISTING })
    expectGet(lastCall(calls), `${A}/listings/${LISTING}/personalization`)
    expect(value).toEqual([
      {
        id: 3,
        text: 'Your name & date',
        instructions: 'Max 20',
        type: 'text_input',
        required: true,
        maxChars: 20,
        maxFiles: null,
        addOnPrice: { amount: 200, divisor: 100, currency: 'USD' },
        options: []
      },
      { id: 4, text: 'Color', instructions: null, type: 'dropdown', required: false, maxChars: null, maxFiles: null, addOnPrice: null, options: [{ id: 1, label: 'Red' }] }
    ])
    const none = await act('personalization', { listingId: LISTING }, { [`GET ${A}/listings/{l}/personalization`]: { body: { personalization_questions: [] } } })
    expect(none.value).toEqual([])
  })

  it('translation: getListingTranslation; 404 = no translation; unknown language refused', async () => {
    const { value, calls } = await act('translation', { shopId: SHOP, listingId: LISTING, language: 'en-GB' })
    expectGet(lastCall(calls), `${A}/shops/${SHOP}/listings/${LISTING}/translations/en-GB`)
    expect(value).toEqual({ listingId: LISTING, language: 'de', title: 'Budgetplaner', description: 'Ein Planer & mehr', tags: ['budget', 'planer'] })
    const missing = await act('translation', { shopId: SHOP, listingId: LISTING, language: 'de' }, {
      [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: { status: 404, body: { error: 'Translation not found' } }
    })
    expect(missing.value).toBeNull()
    await expect(act('translation', { shopId: SHOP, listingId: LISTING, language: 'uk' })).rejects.toThrow('Невідома мова перекладу.')
    await expect(
      act('translation', { shopId: SHOP, listingId: LISTING, language: 'de' }, { [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: { status: 500 } })
    ).rejects.toThrow('HTTP 500')
  })

  it('variationImages: getListingVariationImages', async () => {
    const { value, calls } = await act('variationImages', { shopId: SHOP, listingId: LISTING })
    expectGet(lastCall(calls), `${A}/shops/${SHOP}/listings/${LISTING}/variation-images`)
    expect(value).toEqual([{ propertyId: 200, valueId: 1, value: 'Black', imageId: 501 }])
  })

  it('shipping: getListingsShippingByListingIds with the OAuth token, the whole profile', async () => {
    const { value, calls } = await act('shipping', { listingId: LISTING })
    expectGet(lastCall(calls), `${A}/listings/batch/shipping`, { listing_ids: String(LISTING) }, true)
    expect(value).toEqual([
      {
        listingId: LISTING,
        profile: {
          id: 88,
          title: 'Standard',
          originCountry: 'US',
          originPostalCode: '10001',
          profileType: 'manual',
          isDeleted: false,
          domesticHandlingFee: 0,
          internationalHandlingFee: 1.5,
          destinations: [
            {
              id: 1,
              originCountry: 'US',
              destinationCountry: 'UA',
              destinationRegion: 'none',
              primaryCost: { amount: 1500, divisor: 100, currency: 'USD' },
              secondaryCost: { amount: 500, divisor: 100, currency: 'USD' },
              carrierId: 1,
              mailClass: 'usps_first_class',
              minDeliveryDays: 5,
              maxDeliveryDays: 10
            }
          ],
          upgrades: [
            {
              id: 5,
              name: 'Express',
              type: 1,
              price: { amount: 1000, divisor: 100, currency: 'USD' },
              secondaryPrice: { amount: 300, divisor: 100, currency: 'USD' },
              carrierId: 1,
              mailClass: 'usps_priority',
              minDeliveryDays: 2,
              maxDeliveryDays: 4
            }
          ]
        }
      }
    ])
    const many = await act('shipping', { listingIds: [1, 2, 3] })
    expect(lastCall(many.calls).url.searchParams.get('listing_ids')).toBe('1,2,3')
  })

  it('shipping: another seller’s listing has a null profile', async () => {
    const { value } = await act('shipping', { listingId: LISTING }, {
      [`GET ${A}/listings/batch/shipping`]: { body: { count: 1, results: [{ ...listingA, shipping_profile: null }] } }
    })
    expect(value).toEqual([{ listingId: LISTING, profile: null }])
  })

  it('shipping: signed out / without shops_r → no request; too many ids refused', async () => {
    const out = featureCtx(routes, { status: signedOut })
    await expect(runAction(competeFeature, 'shipping', { listingId: LISTING }, out.ctx)).rejects.toThrow('Увійдіть в Etsy')
    expect(out.fetch.calls).toHaveLength(0)
    const scope = featureCtx(routes, { status: signedIn({ scopes: ['listings_r'] }) })
    await expect(runAction(competeFeature, 'shipping', { listingId: LISTING }, scope.ctx)).rejects.toThrow('читання налаштувань магазину')
    expect(scope.fetch.calls).toHaveLength(0)
    const ids = Array.from({ length: 101 }, (_, i) => i + 1)
    await expect(act('shipping', { listingIds: ids })).rejects.toThrow('від 1 до 100')
    await expect(act('shipping', { listingIds: [] })).rejects.toThrow('від 1 до 100')
  })

  it('shipping: Etsy 404 (an unknown id fails the batch) → its message', async () => {
    await expect(
      act('shipping', { listingId: LISTING }, { [`GET ${A}/listings/batch/shipping`]: { status: 404, body: { error: 'Listing not found' } } })
    ).rejects.toThrow('HTTP 404')
  })

  it('carriers: getShippingCarriers with origin_country_iso; the country is normalized and validated', async () => {
    const { value, calls } = await act('carriers', { country: ' uk ' })
    expectGet(lastCall(calls), `${A}/shipping-carriers`, { origin_country_iso: 'GB' })
    expect(value).toEqual([
      {
        id: 1,
        name: 'USPS',
        domesticClasses: [{ key: 'usps_first_class', name: 'First Class' }],
        internationalClasses: [{ key: 'usps_priority_intl', name: 'Priority Mail International' }]
      }
    ])
    await expect(act('carriers', { country: 'XX' })).rejects.toThrow('двома латинськими літерами')
  })

  it('public reads need no sign-in and send no OAuth token', async () => {
    const reads: Array<[string, Record<string, unknown>]> = [
      ['sections', { shopId: SHOP }],
      ['featured', { shopId: SHOP }],
      ['images', { listingId: LISTING }],
      ['reviews', { listingId: LISTING }],
      ['carriers', { country: 'US' }]
    ]
    for (const [action, args] of reads) {
      const { calls } = await act(action, args, routes, signedOut)
      expect(lastCall(calls).headers.authorization).toBeUndefined()
    }
  })

  it('bad arguments are refused before any request', async () => {
    const { ctx, fetch } = featureCtx(routes)
    await expect(runAction(competeFeature, 'sections', {}, ctx)).rejects.toThrow('Некоректний shopId.')
    await expect(runAction(competeFeature, 'section', { shopId: SHOP, sectionId: -1 }, ctx)).rejects.toThrow('Некоректний sectionId.')
    await expect(runAction(competeFeature, 'featured', { shopId: SHOP, offset: -5 }, ctx)).rejects.toThrow('Некоректний offset.')
    await expect(runAction(competeFeature, 'reviews', { listingId: LISTING, limit: 101 }, ctx)).rejects.toThrow('Некоректний limit.')
    await expect(runAction(competeFeature, 'image', { listingId: 'x', imageId: 1 }, ctx)).rejects.toThrow('Некоректний listingId.')
    await expect(runAction(competeFeature, 'sectionListings', { shopId: SHOP, sectionIds: [1, 'x'] }, ctx)).rejects.toThrow('Некоректний id.')
    await expect(runAction(competeFeature, 'translation', { shopId: SHOP, listingId: LISTING }, ctx)).rejects.toThrow('має бути текстом')
    expect(fetch.calls).toHaveLength(0)
  })

  it('Etsy errors come through as their Ukrainian messages', async () => {
    await expect(act('sections', { shopId: SHOP }, { [`GET ${A}/shops/{s}/sections`]: { status: 404 } })).rejects.toThrow('HTTP 404')
    await expect(act('images', { listingId: LISTING }, { [`GET ${A}/listings/{l}/images`]: { status: 403 } })).rejects.toThrow('API-ключ')
    await expect(act('videos', { listingId: LISTING }, { [`GET ${A}/listings/{l}/videos`]: { status: 503 } })).rejects.toThrow('HTTP 503')
    await expect(act('properties', { shopId: SHOP, listingId: LISTING }, { [`GET ${A}/shops/{s}/listings/{l}/properties`]: { status: 400 } })).rejects.toThrow('HTTP 400')
    await expect(act('returnPolicies', { shopId: SHOP }, { [`GET ${A}/shops/{s}/policies/return`]: { body: { nope: 1 } } })).rejects.toThrow(
      'неочікувану відповідь'
    )
    await expect(act('image', { listingId: LISTING, imageId: 1 }, { [`GET ${A}/listings/{l}/images/{i}`]: { body: [] } })).rejects.toThrow(
      'неочікувану відповідь'
    )
  })
})

// ------------------------------------------------------------------- MCP

const NOT_NEUTRAL = [/etsy/i, /https?:\/\//]
const texts: string[] = []
async function tool(name: string, args: Record<string, unknown>, r: Record<string, unknown> = routes, over: Parameters<typeof mcpDeps>[1] = {}) {
  const { deps, fetch } = mcpDeps(r as typeof routes, over)
  const res = await callTool(competeFeature, deps, name, args)
  texts.push(res.text)
  return { ...res, calls: fetch.calls, deps }
}

describe('compete feature — MCP tools', () => {
  it('the tool list equals COMPETE_TOOL_SUMMARY (names, order), all read-only, closed schemas, neutral', () => {
    const tools = competeFeature.mcpTools!(mcpDeps(routes).deps)
    expect(tools.map((t) => t.name)).toEqual(COMPETE_TOOL_SUMMARY.map((t) => t.name))
    expect(COMPETE_TOOL_SUMMARY.every((t) => !t.write)).toBe(true)
    for (const t of tools) {
      expect(t.readOnly).not.toBe(false)
      expect(t.inputSchema.additionalProperties).toBe(false)
      for (const re of NOT_NEUTRAL) expect(JSON.stringify(t)).not.toMatch(re)
    }
  })

  it('get_store_sections: sections in order; include_products groups the products by section', async () => {
    const plain = await tool('get_store_sections', { store_id: SHOP })
    expect(plain.json).toEqual({
      store_id: SHOP,
      sections: [
        { section_id: 10, title: 'Budget', position: 1, active_product_count: 3 },
        { section_id: 11, title: 'Planners & Calendars', position: 2, active_product_count: 5 }
      ]
    })
    expect(plain.calls).toHaveLength(1)
    const full = await tool('get_store_sections', { store_id: SHOP, include_products: true })
    expectGet(lastCall(full.calls), `${A}/shops/${SHOP}/shop-sections/listings`, { shop_section_ids: '10,11', limit: '100', offset: '0' })
    expect(full.json.sections[0].products).toEqual([{ product_id: LISTING, title: 'Budget Planner & Tracker', price: { amount: 12.5, currency: 'USD' } }])
    expect(full.json.sections[1].products).toEqual([{ product_id: 2003, title: 'Wall calendar — see [link]', price: { amount: 5, currency: 'USD' } }])
    expect(full.json).toMatchObject({ products_total: 2, products_truncated: false })
  })

  it('get_store_sections: products are paged up to the cap', async () => {
    let n = 0
    const r = {
      ...routes,
      [`GET ${A}/shops/{s}/shop-sections/listings`]: (url: URL) => {
        const offset = Number(url.searchParams.get('offset'))
        const results = Array.from({ length: 100 }, (_, i) => ({ ...listingA, listing_id: 10_000 + offset + i }))
        n++
        return { body: { count: 900, results } }
      }
    }
    const res = await tool('get_store_sections', { store_id: SHOP, include_products: true }, r)
    expect(n).toBe(SECTION_PRODUCTS_MAX / 100)
    expect(res.json).toMatchObject({ products_total: 900, products_truncated: true })
    expect(res.json.sections[0].products).toHaveLength(SECTION_PRODUCTS_MAX)
  })

  it('get_store_featured: paged products without URLs', async () => {
    const res = await tool('get_store_featured', { store_id: SHOP, limit: 10, offset: 5 })
    expectGet(lastCall(res.calls), `${A}/shops/${SHOP}/listings/featured`, { limit: '10', offset: '5' })
    expect(res.json).toEqual({
      store_id: SHOP,
      total: 1,
      offset: 5,
      products: [
        {
          product_id: LISTING,
          title: 'Budget Planner & Tracker',
          price: { amount: 12.5, currency: 'USD' },
          status: 'active',
          quantity: 999,
          featured_position: 1,
          favorites: 42,
          section_id: 10
        }
      ]
    })
  })

  it('get_store_return_policies: no policy ids', async () => {
    const res = await tool('get_store_return_policies', { store_id: SHOP })
    expect(res.json).toEqual({ store_id: SHOP, policies: [{ accepts_returns: true, accepts_exchanges: false, return_window_days: 30 }] })
  })

  it('get_product_live_details: every part + a translation, store looked up live', async () => {
    const res = await tool('get_product_live_details', { product_id: LISTING, parts: ['properties', 'photos', 'videos', 'personalization', 'variation_photos', 'shipping', 'reviews'], language: 'de', reviews_limit: 5 })
    expect(res.isError).toBe(false)
    expect(res.calls.find((c) => c.url.pathname === `${A}/listings/${LISTING}`)).toBeTruthy()
    const j = res.json
    expect(j.store_id).toBe(SHOP)
    expect(j.properties).toEqual([
      { attribute_id: 200, name: 'Primary color', scale: null, values: ['Black & white'] },
      { attribute_id: 47626759834, name: 'Width', scale: 'Inches', values: ['8.5'] }
    ])
    expect(j.photos[1]).toEqual({
      photo_id: 501,
      position: 2,
      width: 3000,
      height: 2000,
      alt_text: 'Planner on desk & pen',
      color: { hex: 'E1D5C9', red: 225, green: 213, blue: 201, hue: 30, saturation: 10, brightness: 88 },
      black_and_white: false
    })
    expect(j.videos).toEqual([{ video_id: 601, width: 1920, height: 1080, status: 'active' }])
    expect(j.personalization[0]).toEqual({
      question: 'Your name & date',
      instructions: 'Max 20',
      type: 'text_input',
      required: true,
      max_characters: 20,
      max_files: null,
      add_on_price: { amount: 2, currency: 'USD' },
      options: []
    })
    expect(j.variation_photos).toEqual([{ attribute_id: 200, value_id: 1, value: 'Black', photo_id: 501 }])
    expect(j.shipping).toMatchObject({
      name: 'Standard',
      origin_country: 'US',
      destinations: [{ destination_country: 'UA', cost: { amount: 15, currency: 'USD' }, cost_with_another_item: { amount: 5, currency: 'USD' }, min_delivery_days: 5 }],
      upgrades: [{ name: 'Express', scope: 'international', price: { amount: 10, currency: 'USD' } }]
    })
    expect(j.shipping.id).toBeUndefined()
    expect(j.reviews).toEqual({
      total: 41,
      offset: 0,
      items: [
        {
          rating: 5,
          text: 'Great & useful! Found it on [link]',
          language: 'en',
          created_at: '2023-11-14T22:15:00.000Z',
          updated_at: '2023-11-14T22:16:40.000Z',
          has_photo: true
        }
      ]
    })
    expect(j.translation).toEqual({ language: 'de', title: 'Budgetplaner', description: 'Ein Planer & mehr', tags: ['budget', 'planer'] })
    expect(j.errors).toBeUndefined()
    expect(res.calls.find((c) => c.url.pathname.endsWith('/reviews'))!.url.searchParams.get('limit')).toBe('5')
    expect(res.calls.find((c) => c.url.pathname.endsWith('/batch/shipping'))!.headers.authorization).toBe('Bearer tok')
  })

  it('get_product_live_details: default parts skip shipping; the store comes from our data when tracked', async () => {
    const { deps, fetch } = mcpDeps(routes)
    seedShop(deps.db, { id: SHOP })
    upsertListing(deps.db, mkInput(LISTING, { shopId: SHOP }), 1)
    const res = await callTool(competeFeature, deps, 'get_product_live_details', { product_id: LISTING })
    texts.push(res.text)
    expect(Object.keys(res.json).sort()).toEqual(['personalization', 'photos', 'product_id', 'properties', 'reviews', 'store_id', 'variation_photos', 'videos'])
    expect(fetch.calls.some((c) => c.url.pathname === `${A}/listings/${LISTING}`)).toBe(false)
    expect(fetch.calls.some((c) => c.url.pathname.includes('shipping'))).toBe(false)
  })

  it('get_product_live_details: a given store_id is used for an untracked product; parts that need no store make no lookup', async () => {
    const res = await tool('get_product_live_details', { product_id: LISTING, store_id: 7, parts: ['properties'] })
    expect(res.calls.map((c) => c.url.pathname)).toEqual([`${A}/shops/7/listings/${LISTING}/properties`])
    expect(res.json.store_id).toBe(7)
    expect(res.json.store_id_note).toBeUndefined()
    const photos = await tool('get_product_live_details', { product_id: LISTING, parts: ['photos'] })
    expect(photos.calls.map((c) => c.url.pathname)).toEqual([`${A}/listings/${LISTING}/images`])
    expect(photos.json.store_id).toBeUndefined()
  })

  it('get_product_live_details: a tracked product uses its known store, not a mismatching store_id', async () => {
    const { deps, fetch } = mcpDeps(routes)
    seedShop(deps.db, { id: SHOP })
    upsertListing(deps.db, mkInput(LISTING, { shopId: SHOP }), 1)
    const res = await callTool(competeFeature, deps, 'get_product_live_details', { product_id: LISTING, store_id: 7, parts: ['variation_photos'], language: 'de' })
    texts.push(res.text)
    expect(fetch.calls.map((c) => c.url.pathname)).toEqual([
      `${A}/shops/${SHOP}/listings/${LISTING}/variation-images`,
      `${A}/shops/${SHOP}/listings/${LISTING}/translations/de`
    ])
    expect(res.json.store_id).toBe(SHOP)
    expect(res.json.store_id_note).toBe(`Product ${LISTING} belongs to store ${SHOP}; store_id 7 was ignored.`)
  })

  it('get_product_live_details: a 404 translation is null with a note naming both meanings', async () => {
    const res = await tool('get_product_live_details', { product_id: LISTING, store_id: SHOP, parts: [], language: 'ja' }, {
      [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: { status: 404, body: { error: 'Not found' } }
    })
    expect(res.isError).toBe(false)
    expect(res.json).toEqual({ product_id: LISTING, store_id: SHOP, translation: null, translation_note: TRANSLATION_NOT_FOUND })
  })

  it('get_product_live_details: shipping needs only the sign-in with shops_r — not owning a store', async () => {
    const res = await tool('get_product_live_details', { product_id: LISTING, store_id: SHOP, parts: ['shipping'] }, routes, {
      status: signedIn({ shopId: undefined, shopName: undefined, scopes: ['shops_r'] })
    })
    expect(res.json.errors).toBeUndefined()
    expect(res.json.shipping).toMatchObject({ name: 'Standard' })
    expect(lastCall(res.calls).headers.authorization).toBe('Bearer tok')
  })

  it('get_product_live_details: a failing part is reported in errors, the rest answers', async () => {
    const res = await tool('get_product_live_details', { product_id: LISTING, store_id: SHOP, parts: ['photos', 'videos', 'shipping'], language: 'fr' }, {
      ...routes,
      [`GET ${A}/listings/{l}/videos`]: { status: 404, body: { error: 'No videos on etsy' } },
      [`GET ${A}/shops/{s}/listings/{l}/translations/{lang}`]: { status: 404 }
    }, { status: signedOut })
    expect(res.isError).toBe(false)
    expect(res.json.photos).toHaveLength(2)
    expect(res.json.errors.videos).toBe('Not found (HTTP 404): No videos on marketplace.')
    expect(res.json.errors.shipping).toContain('has not connected their own store')
    expect(res.json.translation).toBeNull()
    expect(res.json.translation_note).toBe(TRANSLATION_NOT_FOUND)
    expect(res.calls.some((c) => c.url.pathname.includes('shipping'))).toBe(false)
  })

  it('get_product_live_details: another seller’s product → shipping null with a note; missing scope → error', async () => {
    const other = await tool('get_product_live_details', { product_id: LISTING, store_id: SHOP, parts: ['shipping'] }, {
      [`GET ${A}/listings/batch/shipping`]: { body: { count: 1, results: [{ ...listingA, shipping_profile: null }] } }
    })
    expect(other.json).toEqual({ product_id: LISTING, store_id: SHOP, shipping: null, shipping_note: 'Shipping details are only shared for products of the user’s own store.' })
    const scope = await tool('get_product_live_details', { product_id: LISTING, parts: ['shipping'] }, routes, { status: signedIn({ scopes: ['listings_r'] }) })
    expect(scope.json.errors.shipping).toContain('lacks a permission')
  })

  it('get_product_live_details: bad parts, nothing asked, unknown product', async () => {
    const bad = await tool('get_product_live_details', { product_id: LISTING, parts: ['photos', 'price'] })
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('Unknown part "price"')
    const none = await tool('get_product_live_details', { product_id: LISTING, parts: [] })
    expect(none.isError).toBe(true)
    expect(none.text).toBe('Ask for at least one part or a language.')
    const lang = await tool('get_product_live_details', { product_id: LISTING, language: 'xx' })
    expect(lang.isError).toBe(true)
    const unknown = await tool('get_product_live_details', { product_id: 9, parts: ['properties'] }, { [`GET ${A}/listings/{l}`]: { status: 404 } })
    expect(unknown.json.errors.properties).toBe('Not found (HTTP 404).')
    const extra = await tool('get_product_live_details', { product_id: LISTING, url: 'x' })
    expect(extra.isError).toBe(true)
  })

  it('list_shipping_carriers: normalized country, neutral names', async () => {
    const res = await tool('list_shipping_carriers', { origin_country: 'us' })
    expectGet(lastCall(res.calls), `${A}/shipping-carriers`, { origin_country_iso: 'US' })
    expect(res.json).toEqual({
      origin_country: 'US',
      carriers: [
        {
          id: 1,
          name: 'USPS',
          domestic_classes: [{ key: 'usps_first_class', name: 'First Class' }],
          international_classes: [{ key: 'usps_priority_intl', name: 'Priority Mail International' }]
        }
      ]
    })
    const bad = await tool('list_shipping_carriers', { origin_country: 'ZZ' })
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('ISO 3166-1')
  })

  it('every tool: no API key → "Not available"; store errors neutral', async () => {
    const calls: Array<[string, Record<string, unknown>]> = [
      ['get_store_sections', { store_id: SHOP }],
      ['get_store_featured', { store_id: SHOP }],
      ['get_store_return_policies', { store_id: SHOP }],
      ['get_product_live_details', { product_id: LISTING, parts: ['photos'] }],
      ['list_shipping_carriers', { origin_country: 'US' }]
    ]
    for (const [name, args] of calls) {
      const res = await tool(name, args, routes, { client: null })
      expect(res.isError).toBe(true)
      expect(res.text).toBe(NOT_AVAILABLE)
    }
    const failing = Object.fromEntries(Object.keys(routes).map((k) => [k, { status: 500, body: { error: 'Etsy is down, see https://status.etsy.com' } }]))
    for (const [name, args] of calls.filter(([n]) => n !== 'get_product_live_details')) {
      const res = await tool(name, args, failing)
      expect(res.isError).toBe(true)
    }
    const nf = await tool('get_store_featured', { store_id: SHOP }, { [`GET ${A}/shops/{s}/listings/featured`]: { status: 404, body: { error: 'Shop etsy 1 not found' } } })
    expect(nf.text).toBe('Not found (HTTP 404): Shop marketplace 1 not found.')
  })

  it('neutrality sweep: nothing any tool said names the marketplace or carries a URL', () => {
    expect(texts.length).toBeGreaterThan(20)
    for (const t of texts) for (const re of NOT_NEUTRAL) expect(t).not.toMatch(re)
  })
})
