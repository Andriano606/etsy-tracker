import { describe, expect, it } from 'vitest'
import { shopConfigFeature } from '../../../src/main/features/shopConfig'
import { SHOP_CONFIG_TOOL_SUMMARY } from '../../../src/shared/features/shopConfig'

import { ALL_SCOPES, OWN_SHOP, OWN_USER, callTool, featureCtx, mcpDeps, runAction, signedIn, signedOut } from '../../helpers/features'

const SHOP = `/v3/application/shops/${OWN_SHOP}`
const PROFILE_PATH = `${SHOP}/shipping-profiles/21`

const money = (amount: number, divisor = 100, currency_code = 'USD') => ({ amount, divisor, currency_code })

const SECTION = { shop_section_id: 11, title: 'Planners &amp; More', rank: 1, user_id: OWN_USER, active_listing_count: 4 }

const DEST = {
  shipping_profile_destination_id: 31,
  shipping_profile_id: 21,
  origin_country_iso: 'UA',
  destination_country_iso: 'US',
  destination_region: 'none',
  primary_cost: money(500),
  secondary_cost: money(150),
  shipping_carrier_id: 0,
  mail_class: null,
  min_delivery_days: 5,
  max_delivery_days: 10
}

const UPGRADE = {
  shipping_profile_id: 21,
  upgrade_id: 41,
  upgrade_name: 'Express',
  type: 1,
  rank: 0,
  language: 'en',
  price: money(1000),
  secondary_price: money(200),
  shipping_carrier_id: 2,
  mail_class: 'priority',
  min_delivery_days: null,
  max_delivery_days: null
}

const PROFILE = {
  shipping_profile_id: 21,
  title: 'Standard',
  user_id: OWN_USER,
  origin_country_iso: 'UA',
  is_deleted: false,
  shipping_profile_destinations: [DEST],
  shipping_profile_upgrades: [UPGRADE],
  origin_postal_code: '79000',
  profile_type: 'manual',
  domestic_handling_fee: 0,
  international_handling_fee: 1.5
}

const CARRIER = {
  shipping_carrier_id: 2,
  name: 'Ukrposhta',
  domestic_classes: [{ mail_class_key: 'standard', name: 'Standard' }],
  international_classes: [{ mail_class_key: 'priority', name: 'Priority' }]
}

const READY = {
  shop_id: OWN_SHOP,
  readiness_state_id: 51,
  readiness_state: 'made_to_order',
  min_processing_days: 1,
  max_processing_days: 3,
  processing_days_display_label: '1-3 days'
}

const RETURN = { return_policy_id: 61, shop_id: OWN_SHOP, accepts_returns: true, accepts_exchanges: false, return_deadline: 30 }

const HOLIDAY = { shop_id: OWN_SHOP, holiday_id: 7, country_iso: 'US', is_working: false, holiday_name: 'Thanksgiving' }

const PARTNER = { production_partner_id: 71, partner_name: 'Print House', location: 'Lviv' }

const LISTING = {
  listing_id: 900,
  shop_id: OWN_SHOP,
  title: 'Budget planner',
  description: 'A planner',
  state: 'active',
  url: 'https://www.etsy.com/listing/900/budget-planner',
  shop_section_id: 11,
  price: money(499),
  tags: [],
  materials: []
}

const paged = (results: unknown[]) => ({ body: { count: results.length, results } })
const empty = { status: 200 }

/** Every endpoint of the feature, answering the fixtures. */
const ROUTES = {
  [`GET ${SHOP}/sections`]: paged([SECTION]),
  [`GET ${SHOP}/sections/{id}`]: { body: SECTION },
  [`POST ${SHOP}/sections`]: { body: SECTION },
  [`PUT ${SHOP}/sections/{id}`]: { body: { ...SECTION, title: 'Renamed' } },
  [`DELETE ${SHOP}/sections/{id}`]: empty,
  'GET /v3/application/listings/{id}': { body: LISTING },
  [`PATCH ${SHOP}/listings/{id}`]: { body: { ...LISTING, shop_section_id: 12 } },
  [`GET ${SHOP}/shipping-profiles`]: paged([PROFILE]),
  [`POST ${SHOP}/shipping-profiles`]: { body: PROFILE },
  [`GET ${SHOP}/shipping-profiles/{id}`]: { body: PROFILE },
  [`PUT ${SHOP}/shipping-profiles/{id}`]: { body: { ...PROFILE, title: 'Renamed' } },
  [`DELETE ${SHOP}/shipping-profiles/{id}`]: empty,
  [`GET ${SHOP}/shipping-profiles/{id}/destinations`]: paged([DEST]),
  [`POST ${SHOP}/shipping-profiles/{id}/destinations`]: { status: 201, body: DEST },
  [`PUT ${SHOP}/shipping-profiles/{id}/destinations/{d}`]: { body: DEST },
  [`DELETE ${SHOP}/shipping-profiles/{id}/destinations/{d}`]: empty,
  [`GET ${SHOP}/shipping-profiles/{id}/upgrades`]: paged([UPGRADE]),
  [`POST ${SHOP}/shipping-profiles/{id}/upgrades`]: { body: UPGRADE },
  [`PUT ${SHOP}/shipping-profiles/{id}/upgrades/{u}`]: { body: UPGRADE },
  [`DELETE ${SHOP}/shipping-profiles/{id}/upgrades/{u}`]: empty,
  'GET /v3/application/shipping-carriers': paged([CARRIER]),
  [`GET ${SHOP}/readiness-state-definitions`]: paged([READY]),
  [`GET ${SHOP}/readiness-state-definitions/{id}`]: { body: READY },
  [`POST ${SHOP}/readiness-state-definitions`]: { status: 201, body: READY },
  [`PUT ${SHOP}/readiness-state-definitions/{id}`]: { body: READY },
  [`DELETE ${SHOP}/readiness-state-definitions/{id}`]: empty,
  [`GET ${SHOP}/policies/return`]: paged([RETURN]),
  [`GET ${SHOP}/policies/return/{id}`]: { body: RETURN },
  [`POST ${SHOP}/policies/return`]: { body: RETURN },
  [`PUT ${SHOP}/policies/return/{id}`]: { body: RETURN },
  [`DELETE ${SHOP}/policies/return/{id}`]: empty,
  [`POST ${SHOP}/policies/return/consolidate`]: { body: { ...RETURN, return_policy_id: 62 } },
  [`GET ${SHOP}/policies/return/{id}/listings`]: paged([LISTING]),
  [`GET ${SHOP}/holiday-preferences`]: { body: [HOLIDAY] },
  [`PUT ${SHOP}/holiday-preferences/{id}`]: { body: { ...HOLIDAY, is_working: true } },
  [`GET ${SHOP}/production-partners`]: paged([PARTNER])
}

/** A recorded form body as an object. */
const formOf = (body: string | null): Record<string, string> => Object.fromEntries(new URLSearchParams(body ?? ''))

const ctxWith = (over: Parameters<typeof featureCtx>[1] = {}, routes: Record<string, unknown> = {}) =>
  featureCtx({ ...ROUTES, ...routes } as typeof ROUTES, over)

const act = (action: string, args: Record<string, unknown> = {}, over: Parameters<typeof featureCtx>[1] = {}, routes = {}) => {
  const { ctx, fetch } = ctxWith(over, routes)
  return { fetch, run: () => runAction(shopConfigFeature, action, args, ctx) }
}

/** Run an action and return its answer + the one request it made. */
async function one(action: string, args: Record<string, unknown> = {}, routes = {}) {
  const { fetch, run } = act(action, args, {}, routes)
  const value = await run()
  expect(fetch.calls).toHaveLength(1)
  const c = fetch.calls[0]
  return { value, call: c, body: c.body, path: c.url.pathname, query: Object.fromEntries(c.url.searchParams), form: formOf(c.body), auth: c.headers.authorization }
}

describe('shopConfig actions: sections', () => {
  it('sections: public getShopSections (API key, no token), entities decoded', async () => {
    const r = await one('sections')
    expect(r.call.method).toBe('GET')
    expect(r.path).toBe(`${SHOP}/sections`)
    expect(r.auth).toBeUndefined()
    expect(r.call.headers['x-api-key']).toBe('keystring:secret')
    expect(r.value).toEqual([{ id: 11, title: 'Planners & More', rank: 1, activeListingCount: 4 }])
  })

  it('section: getShopSection', async () => {
    const r = await one('section', { sectionId: 11 })
    expect(r.path).toBe(`${SHOP}/sections/11`)
    expect(r.auth).toBeUndefined()
    expect(r.value).toMatchObject({ id: 11, title: 'Planners & More' })
  })

  it('createSection: POST form title (OAuth)', async () => {
    const r = await one('createSection', { input: { title: ' New shelf ' } })
    expect(r.call.method).toBe('POST')
    expect(r.path).toBe(`${SHOP}/sections`)
    expect(r.call.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(r.form).toEqual({ title: 'New shelf' })
    expect(r.auth).toBe('Bearer tok')
  })

  it('updateSection: PUT form title; deleteSection: DELETE → null', async () => {
    const u = await one('updateSection', { sectionId: 11, input: { title: 'Renamed' } })
    expect([u.call.method, u.path, u.form]).toEqual(['PUT', `${SHOP}/sections/11`, { title: 'Renamed' }])
    expect(u.value).toMatchObject({ title: 'Renamed' })
    const d = await one('deleteSection', { sectionId: 11 })
    expect([d.call.method, d.path, d.call.body, d.auth]).toEqual(['DELETE', `${SHOP}/sections/11`, null, 'Bearer tok'])
    expect(d.value).toBeNull()
  })

  it('refuses before any request: empty title, bad id, signed out, no shops_w', async () => {
    let a = act('createSection', { input: { title: '  ' } })
    await expect(a.run()).rejects.toThrow('Заповніть «назва розділу».')
    expect(a.fetch.calls).toHaveLength(0)
    a = act('deleteSection', { sectionId: 'x' })
    await expect(a.run()).rejects.toThrow('Некоректний sectionId.')
    a = act('sections', {}, { status: signedOut })
    await expect(a.run()).rejects.toThrow('Увійдіть в Etsy')
    a = act('createSection', { input: { title: 'A' } }, { status: signedIn({ scopes: ['shops_r', 'listings_w'] }) })
    await expect(a.run()).rejects.toThrow('зміну налаштувань магазину')
    expect(a.fetch.calls).toHaveLength(0)
  })

  it('Etsy errors come through in Ukrainian (400 with its detail, 500)', async () => {
    let a = act('createSection', { input: { title: 'A' } }, {}, { [`POST ${SHOP}/sections`]: { status: 400, body: { error: 'Title taken' } } })
    await expect(a.run()).rejects.toThrow('Etsy відхилив запит як некоректний (HTTP 400). (Title taken)')
    a = act('sections', {}, {}, { [`GET ${SHOP}/sections`]: { status: 503 } })
    await expect(a.run()).rejects.toThrow('Сервер Etsy повернув помилку (HTTP 503)')
  })

  it("listingSection: the sections + the listing's section from the public getListing", async () => {
    const { fetch, run } = act('listingSection', { listingId: 900 })
    expect(await run()).toEqual({ sections: [{ id: 11, title: 'Planners & More', rank: 1, activeListingCount: 4 }], sectionId: 11, known: true })
    expect(fetch.calls.map((c) => c.url.pathname)).toEqual([`${SHOP}/sections`, '/v3/application/listings/900'])
    expect(fetch.calls[1].headers.authorization).toBeUndefined()
  })

  it('listingSection: unknown when the listing is not readable (404) or not in this shop; other errors throw', async () => {
    let a = act('listingSection', { listingId: 900 }, {}, { 'GET /v3/application/listings/{id}': { status: 404 } })
    expect(await a.run()).toMatchObject({ sectionId: null, known: false })
    a = act('listingSection', { listingId: 900 }, {}, { 'GET /v3/application/listings/{id}': { body: { ...LISTING, shop_id: 1 } } })
    expect(await a.run()).toMatchObject({ sectionId: null, known: false })
    a = act('listingSection', { listingId: 900 }, {}, { 'GET /v3/application/listings/{id}': { status: 500 } })
    await expect(a.run()).rejects.toThrow('HTTP 500')
  })

  it('setListingSection: PATCH updateListing shop_section_id (0 = no section) → the listing', async () => {
    const r = await one('setListingSection', { listingId: 900, sectionId: 12 })
    expect([r.call.method, r.path, r.form, r.auth]).toEqual(['PATCH', `${SHOP}/listings/900`, { shop_section_id: '12' }, 'Bearer tok'])
    expect(r.value).toMatchObject({ listingId: 900, title: 'Budget planner', state: 'active' })
    expect((await one('setListingSection', { listingId: 900, sectionId: 0 })).form).toEqual({ shop_section_id: '0' })
    expect((await one('setListingSection', { listingId: 900, sectionId: '12' })).form).toEqual({ shop_section_id: '12' })
    // A missing/empty choice is refused, never read as 0 ("no section").
    for (const sectionId of [-1, null, undefined, '', ' ', '1.5', 1.5, true]) {
      const bad = act('setListingSection', { listingId: 900, sectionId })
      await expect(bad.run()).rejects.toThrow('Некоректний sectionId.')
      expect(bad.fetch.calls).toHaveLength(0)
    }
    const a = act('setListingSection', { listingId: 900, sectionId: 1 }, { status: signedIn({ scopes: ['shops_w'] }) })
    await expect(a.run()).rejects.toThrow('редагування товарів')
  })
})

const profileInput = {
  title: 'Standard',
  origin_country_iso: 'UA',
  origin_postal_code: '79000',
  primary_cost: '5',
  secondary_cost: '1,5',
  destination_region: 'eu',
  min_processing_time: 1,
  max_processing_time: 3,
  processing_time_unit: 'business_days',
  shipping_carrier_id: 2,
  mail_class: 'priority'
}

describe('shopConfig actions: shipping', () => {
  it('shippingProfiles: OAuth GET, every field mapped (money exact, destinations, upgrades)', async () => {
    const r = await one('shippingProfiles')
    expect([r.call.method, r.path, r.auth]).toEqual(['GET', `${SHOP}/shipping-profiles`, 'Bearer tok'])
    expect(r.value).toEqual([
      {
        id: 21,
        title: 'Standard',
        originCountry: 'UA',
        originPostalCode: '79000',
        isDeleted: false,
        profileType: 'manual',
        domesticHandlingFee: 0,
        internationalHandlingFee: 1.5,
        destinations: [
          {
            id: 31,
            profileId: 21,
            originCountry: 'UA',
            destinationCountry: 'US',
            destinationRegion: 'none',
            primaryCost: { amount: 500, divisor: 100, currency: 'USD' },
            secondaryCost: { amount: 150, divisor: 100, currency: 'USD' },
            carrierId: null,
            mailClass: null,
            minDeliveryDays: 5,
            maxDeliveryDays: 10
          }
        ],
        upgrades: [
          {
            id: 41,
            profileId: 21,
            name: 'Express',
            international: true,
            rank: 0,
            language: 'en',
            price: { amount: 1000, divisor: 100, currency: 'USD' },
            secondaryPrice: { amount: 200, divisor: 100, currency: 'USD' },
            carrierId: 2,
            mailClass: 'priority',
            minDeliveryDays: null,
            maxDeliveryDays: null
          }
        ]
      }
    ])
  })

  it('shippingProfile: GET one', async () => {
    const r = await one('shippingProfile', { profileId: 21 })
    expect([r.path, r.auth]).toEqual([PROFILE_PATH, 'Bearer tok'])
    expect(r.value).toMatchObject({ id: 21 })
  })

  it('createShippingProfile: POST every OAS field as given (region instead of a country, carrier + mail class)', async () => {
    const r = await one('createShippingProfile', { input: profileInput })
    expect([r.call.method, r.path]).toEqual(['POST', `${SHOP}/shipping-profiles`])
    expect(r.form).toEqual({
      title: 'Standard',
      origin_country_iso: 'UA',
      origin_postal_code: '79000',
      primary_cost: '5',
      secondary_cost: '1.5',
      destination_region: 'eu',
      min_processing_time: '1',
      max_processing_time: '3',
      processing_time_unit: 'business_days',
      shipping_carrier_id: '2',
      mail_class: 'priority'
    })
  })

  it('createShippingProfile: the OAS rules are checked first', async () => {
    const a = act('createShippingProfile', { input: { ...profileInput, destination_country_iso: 'US' } })
    await expect(a.run()).rejects.toThrow('не обидва')
    expect(a.fetch.calls).toHaveLength(0)
    await expect(act('createShippingProfile', { input: { ...profileInput, mail_class: '' } }).run()).rejects.toThrow(
      'Перевізник і клас пошти вказуються разом.'
    )
    await expect(act('createShippingProfile', {}).run()).rejects.toThrow('Немає даних форми.')
  })

  it('updateShippingProfile: PUT only the given fields; nothing → refused', async () => {
    const r = await one('updateShippingProfile', { profileId: 21, input: { title: 'Renamed', min_processing_time: 2, max_processing_time: 4 } })
    expect([r.call.method, r.path, r.form]).toEqual(['PUT', PROFILE_PATH, { title: 'Renamed', min_processing_time: '2', max_processing_time: '4' }])
    await expect(act('updateShippingProfile', { profileId: 21, input: {} }).run()).rejects.toThrow('Нічого не змінено.')
  })

  it('updateShippingProfile: an explicit empty postal code is sent (clears it); a missing one is not', async () => {
    const r = await one('updateShippingProfile', { profileId: 21, input: { origin_postal_code: '' } })
    expect([r.call.method, r.path, r.body]).toEqual(['PUT', PROFILE_PATH, 'origin_postal_code='])
    const t = await one('updateShippingProfile', { profileId: 21, input: { title: 'Renamed', origin_postal_code: undefined } })
    expect(t.form).toEqual({ title: 'Renamed' })
  })

  it('deleteShippingProfile: DELETE; a 404 comes through', async () => {
    const d = await one('deleteShippingProfile', { profileId: 21 })
    expect([d.call.method, d.path, d.value]).toEqual(['DELETE', PROFILE_PATH, null])
    const a = act('deleteShippingProfile', { profileId: 21 }, {}, { [`DELETE ${SHOP}/shipping-profiles/{id}`]: { status: 404 } })
    await expect(a.run()).rejects.toThrow('HTTP 404')
  })

  it('destinations: every page (limit 100 + offset)', async () => {
    const page = (n: number, from: number) => Array.from({ length: n }, (_, i) => ({ ...DEST, shipping_profile_destination_id: from + i }))
    const { fetch, run } = act('destinations', { profileId: 21 }, {}, {
      [`GET ${SHOP}/shipping-profiles/{id}/destinations`]: (url: URL) => ({
        body: { count: 150, results: url.searchParams.get('offset') === '100' ? page(50, 101) : page(100, 1) }
      })
    })
    const all = (await run()) as unknown[]
    expect(all).toHaveLength(150)
    expect(fetch.calls.map((c) => Object.fromEntries(c.url.searchParams))).toEqual([{ limit: '100' }, { limit: '100', offset: '100' }])
    expect(fetch.calls[0].url.pathname).toBe(`${PROFILE_PATH}/destinations`)
  })

  it('createDestination: POST (neither country nor region = everywhere else); update PUT; delete DELETE', async () => {
    const c = await one('createDestination', { profileId: 21, input: { primary_cost: 7, secondary_cost: 2, min_delivery_days: 7, max_delivery_days: 21 } })
    expect([c.call.method, c.path, c.form]).toEqual([
      'POST',
      `${PROFILE_PATH}/destinations`,
      { primary_cost: '7', secondary_cost: '2', min_delivery_days: '7', max_delivery_days: '21' }
    ])
    expect(c.value).toMatchObject({ id: 31, destinationCountry: 'US' })
    const u = await one('updateDestination', { profileId: 21, destinationId: 31, input: { destination_country_iso: 'de', primary_cost: 9 } })
    expect([u.call.method, u.path, u.form]).toEqual(['PUT', `${PROFILE_PATH}/destinations/31`, { primary_cost: '9', destination_country_iso: 'DE' }])
    const d = await one('deleteDestination', { profileId: 21, destinationId: 31 })
    expect([d.call.method, d.path]).toEqual(['DELETE', `${PROFILE_PATH}/destinations/31`])
    await expect(act('createDestination', { profileId: 21, input: { primary_cost: 7, secondary_cost: 2 } }).run()).rejects.toThrow(
      'Вкажіть перевізника й клас пошти або строк доставки'
    )
    await expect(act('updateDestination', { profileId: 21, input: { primary_cost: 1 } }).run()).rejects.toThrow('Некоректний destinationId.')
  })

  it('destinations: a country with any region (even none) is refused — Etsy answers 400 to both', async () => {
    const input = { primary_cost: 7, secondary_cost: 2, min_delivery_days: 7, max_delivery_days: 21, destination_country_iso: 'DE', destination_region: 'none' }
    const c = act('createDestination', { profileId: 21, input })
    await expect(c.run()).rejects.toThrow('не обидва')
    expect(c.fetch.calls).toHaveLength(0)
    const u = act('updateDestination', { profileId: 21, destinationId: 31, input: { destination_country_iso: 'DE', destination_region: 'none' } })
    await expect(u.run()).rejects.toThrow('не обидва')
    const none = await one('createDestination', { profileId: 21, input: { ...input, destination_country_iso: undefined } })
    expect(none.form).toMatchObject({ destination_region: 'none' })
  })

  it('upgrades: list, create (type 1 = international), update, delete', async () => {
    const l = await one('upgrades', { profileId: 21 })
    expect([l.path, l.auth]).toEqual([`${PROFILE_PATH}/upgrades`, 'Bearer tok'])
    expect(l.value).toMatchObject([{ id: 41, international: true }])
    const c = await one('createUpgrade', {
      profileId: 21,
      input: { type: '1', upgrade_name: 'Express', price: '10', secondary_price: '2.5', shipping_carrier_id: 2, mail_class: 'priority' }
    })
    expect([c.call.method, c.path, c.form]).toEqual([
      'POST',
      `${PROFILE_PATH}/upgrades`,
      { type: '1', upgrade_name: 'Express', price: '10', secondary_price: '2.5', shipping_carrier_id: '2', mail_class: 'priority' }
    ])
    const u = await one('updateUpgrade', { profileId: 21, upgradeId: 41, input: { price: 12 } })
    expect([u.call.method, u.path, u.form]).toEqual(['PUT', `${PROFILE_PATH}/upgrades/41`, { price: '12' }])
    const d = await one('deleteUpgrade', { profileId: 21, upgradeId: 41 })
    expect([d.call.method, d.path]).toEqual(['DELETE', `${PROFILE_PATH}/upgrades/41`])
  })

  it('carriers: public getShippingCarriers with origin_country_iso, works signed out; a bad country is refused', async () => {
    const { fetch, run } = act('carriers', { country: 'ua' }, { status: signedOut })
    expect(await run()).toEqual([
      { id: 2, name: 'Ukrposhta', domesticClasses: [{ key: 'standard', name: 'Standard' }], internationalClasses: [{ key: 'priority', name: 'Priority' }] }
    ])
    expect(fetch.calls[0].url.pathname).toBe('/v3/application/shipping-carriers')
    expect(Object.fromEntries(fetch.calls[0].url.searchParams)).toEqual({ origin_country_iso: 'UA' })
    expect(fetch.calls[0].headers.authorization).toBeUndefined()
    await expect(act('carriers', { country: 'ZZ' }).run()).rejects.toThrow('Невідомий код країни відправлення.')
  })

  it('shipping reads need shops_r', async () => {
    const a = act('shippingProfiles', {}, { status: signedIn({ scopes: ['listings_r'] }) })
    await expect(a.run()).rejects.toThrow('читання налаштувань магазину')
    expect(a.fetch.calls).toHaveLength(0)
  })
})

describe('shopConfig actions: processing, returns, holidays, partners', () => {
  const RS = `${SHOP}/readiness-state-definitions`

  it('processing: list (limit 100), get, create, update, delete', async () => {
    const l = await one('processingProfiles')
    expect([l.path, l.query, l.auth]).toEqual([RS, { limit: '100' }, 'Bearer tok'])
    expect(l.value).toEqual([{ id: 51, readinessState: 'made_to_order', minDays: 1, maxDays: 3, label: '1-3 days' }])
    expect((await one('processingProfile', { id: 51 })).path).toBe(`${RS}/51`)
    const c = await one('createProcessingProfile', {
      input: { readiness_state: 'ready_to_ship', min_processing_time: 1, max_processing_time: 2, processing_time_unit: 'weeks' }
    })
    expect([c.call.method, c.path, c.form]).toEqual([
      'POST',
      RS,
      { readiness_state: 'ready_to_ship', min_processing_time: '1', max_processing_time: '2', processing_time_unit: 'weeks' }
    ])
    const u = await one('updateProcessingProfile', { id: 51, input: { max_processing_time: 5 } })
    expect([u.call.method, u.path, u.form]).toEqual(['PUT', `${RS}/51`, { max_processing_time: '5' }])
    const d = await one('deleteProcessingProfile', { id: 51 })
    expect([d.call.method, d.path]).toEqual(['DELETE', `${RS}/51`])
  })

  it('processing: a 409 (same values exist) reads as such; min > max refused', async () => {
    const input = { readiness_state: 'ready_to_ship', min_processing_time: 1, max_processing_time: 2 }
    const a = act('createProcessingProfile', { input }, {}, { [`POST ${RS}`]: { status: 409, body: { error: 'Conflict' } } })
    await expect(a.run()).rejects.toThrow('Профіль обробки з такими значеннями вже існує.')
    await expect(act('createProcessingProfile', { input: { ...input, min_processing_time: 3 } }).run()).rejects.toThrow('мінімум більший')
    const u = act('updateProcessingProfile', { id: 51, input: { max_processing_time: 5 } }, {}, { [`PUT ${RS}/{id}`]: { status: 409 } })
    await expect(u.run()).rejects.toThrow('Профіль обробки з такими значеннями вже існує.')
    expect(u.fetch.calls.map((c) => c.method)).toEqual(['PUT'])
  })

  const RP = `${SHOP}/policies/return`

  it('return policies: public list/get; create/update/delete with OAuth', async () => {
    const l = await one('returnPolicies')
    expect([l.path, l.auth]).toEqual([RP, undefined])
    expect(l.value).toEqual([{ id: 61, acceptsReturns: true, acceptsExchanges: false, returnDeadline: 30 }])
    const g = await one('returnPolicy', { id: 61 })
    expect([g.path, g.auth]).toEqual([`${RP}/61`, undefined])
    const c = await one('createReturnPolicy', { input: { accepts_returns: true, accepts_exchanges: true, return_deadline: '14' } })
    expect([c.call.method, c.path, c.form, c.auth]).toEqual([
      'POST',
      RP,
      { accepts_returns: 'true', accepts_exchanges: 'true', return_deadline: '14' },
      'Bearer tok'
    ])
    const u = await one('updateReturnPolicy', { id: 61, input: { accepts_returns: false, accepts_exchanges: false, return_deadline: 30 } })
    expect([u.call.method, u.path, u.form]).toEqual(['PUT', `${RP}/61`, { accepts_returns: 'false', accepts_exchanges: 'false' }])
    const d = await one('deleteReturnPolicy', { id: 61 })
    expect([d.call.method, d.path]).toEqual(['DELETE', `${RP}/61`])
    await expect(act('createReturnPolicy', { input: { accepts_returns: true, accepts_exchanges: false } }).run()).rejects.toThrow(
      'Вкажіть строк повернення.'
    )
  })

  it('return policies: an update duplicating another policy (409) says to consolidate; other errors come through', async () => {
    const input = { accepts_returns: true, accepts_exchanges: false, return_deadline: 14 }
    const a = act('updateReturnPolicy', { id: 61, input }, {}, { [`PUT ${RP}/{id}`]: { status: 409, body: { error: 'Conflict' } } })
    await expect(a.run()).rejects.toThrow('Політика з такими умовами вже існує — об’єднайте ці політики')
    expect(a.fetch.calls.map((c) => c.method)).toEqual(['PUT'])
    const e = act('updateReturnPolicy', { id: 61, input }, {}, { [`PUT ${RP}/{id}`]: { status: 404 } })
    await expect(e.run()).rejects.toThrow('HTTP 404')
  })

  it('consolidate: POST source → destination; the same policy twice is refused', async () => {
    const r = await one('consolidateReturnPolicies', { sourceId: 61, destinationId: 62 })
    expect([r.call.method, r.path, r.form]).toEqual([
      'POST',
      `${RP}/consolidate`,
      { source_return_policy_id: '61', destination_return_policy_id: '62' }
    ])
    expect(r.value).toMatchObject({ id: 62 })
    await expect(act('consolidateReturnPolicies', { sourceId: 61, destinationId: 61 }).run()).rejects.toThrow('дві різні')
  })

  it('returnPolicyListings: OAuth (listings_r) GET …/listings', async () => {
    const r = await one('returnPolicyListings', { id: 61 })
    expect([r.path, r.query, r.auth]).toEqual([`${RP}/61/listings`, {}, 'Bearer tok'])
    expect(r.value).toEqual([{ listingId: 900, title: 'Budget planner', state: 'active' }])
    const a = act('returnPolicyListings', { id: 61 }, { status: signedIn({ scopes: ['shops_r'] }) })
    await expect(a.run()).rejects.toThrow('читання товарів')
  })

  it('holidays: GET (a bare array) and PUT is_working', async () => {
    const l = await one('holidays')
    expect([l.path, l.auth]).toEqual([`${SHOP}/holiday-preferences`, 'Bearer tok'])
    expect(l.value).toEqual([{ holidayId: 7, countryIso: 'US', name: 'Thanksgiving', isWorking: false }])
    const s = await one('setHoliday', { holidayId: 7, isWorking: true })
    expect([s.call.method, s.path, s.form]).toEqual(['PUT', `${SHOP}/holiday-preferences/7`, { is_working: 'true' }])
    expect(s.value).toMatchObject({ isWorking: true })
    await expect(act('setHoliday', { holidayId: 106, isWorking: true }).run()).rejects.toThrow('Невідоме свято.')
    await expect(act('setHoliday', { holidayId: 7, isWorking: 'yes' }).run()).rejects.toThrow('чи магазин працює')
  })

  it('partners: GET production-partners (shops_r)', async () => {
    const r = await one('partners')
    expect([r.path, r.auth]).toEqual([`${SHOP}/production-partners`, 'Bearer tok'])
    expect(r.value).toEqual([{ id: 71, name: 'Print House', location: 'Lviv' }])
  })
})

// ---------------------------------------------------------------------- MCP

const RS = `${SHOP}/readiness-state-definitions`
const RP = `${SHOP}/policies/return`

/** Every tool: its arguments and the one request it must make (form = the body). */
const TOOL_CALLS: Array<{ name: string; args: Record<string, unknown>; method: string; path: string; form?: Record<string, string>; query?: Record<string, string> }> = [
  { name: 'list_my_sections', args: {}, method: 'GET', path: `${SHOP}/sections` },
  { name: 'create_my_section', args: { title: 'New' }, method: 'POST', path: `${SHOP}/sections`, form: { title: 'New' } },
  { name: 'update_my_section', args: { section_id: 11, title: 'Renamed' }, method: 'PUT', path: `${SHOP}/sections/11`, form: { title: 'Renamed' } },
  { name: 'delete_my_section', args: { section_id: 11 }, method: 'DELETE', path: `${SHOP}/sections/11` },
  { name: 'set_my_product_section', args: { product_id: 900, section_id: 12 }, method: 'PATCH', path: `${SHOP}/listings/900`, form: { shop_section_id: '12' } },
  { name: 'list_my_shipping_profiles', args: {}, method: 'GET', path: `${SHOP}/shipping-profiles` },
  { name: 'get_my_shipping_profile', args: { profile_id: 21 }, method: 'GET', path: PROFILE_PATH },
  {
    name: 'create_my_shipping_profile',
    args: { title: 'Std', origin_country_iso: 'UA', primary_cost: 5, secondary_cost: 1.5, destination_country_iso: 'US', min_delivery_days: 5, max_delivery_days: 10 },
    method: 'POST',
    path: `${SHOP}/shipping-profiles`,
    form: { title: 'Std', origin_country_iso: 'UA', primary_cost: '5', secondary_cost: '1.5', destination_country_iso: 'US', min_delivery_days: '5', max_delivery_days: '10' }
  },
  { name: 'update_my_shipping_profile', args: { profile_id: 21, origin_postal_code: '79001' }, method: 'PUT', path: PROFILE_PATH, form: { origin_postal_code: '79001' } },
  { name: 'delete_my_shipping_profile', args: { profile_id: 21 }, method: 'DELETE', path: PROFILE_PATH },
  { name: 'list_my_shipping_destinations', args: { profile_id: 21 }, method: 'GET', path: `${PROFILE_PATH}/destinations`, query: { limit: '100' } },
  {
    name: 'create_my_shipping_destination',
    args: { profile_id: 21, primary_cost: 3, secondary_cost: 1, destination_region: 'non_eu', shipping_carrier_id: 2, mail_class: 'priority' },
    method: 'POST',
    path: `${PROFILE_PATH}/destinations`,
    form: { primary_cost: '3', secondary_cost: '1', destination_region: 'non_eu', shipping_carrier_id: '2', mail_class: 'priority' }
  },
  {
    name: 'update_my_shipping_destination',
    args: { profile_id: 21, destination_id: 31, secondary_cost: 0 },
    method: 'PUT',
    path: `${PROFILE_PATH}/destinations/31`,
    form: { secondary_cost: '0' }
  },
  { name: 'delete_my_shipping_destination', args: { profile_id: 21, destination_id: 31 }, method: 'DELETE', path: `${PROFILE_PATH}/destinations/31` },
  { name: 'list_my_shipping_upgrades', args: { profile_id: 21 }, method: 'GET', path: `${PROFILE_PATH}/upgrades` },
  {
    name: 'create_my_shipping_upgrade',
    args: { profile_id: 21, type: 0, upgrade_name: 'Fast', price: 4, secondary_price: 1, min_delivery_days: 1, max_delivery_days: 2 },
    method: 'POST',
    path: `${PROFILE_PATH}/upgrades`,
    form: { type: '0', upgrade_name: 'Fast', price: '4', secondary_price: '1', min_delivery_days: '1', max_delivery_days: '2' }
  },
  { name: 'update_my_shipping_upgrade', args: { profile_id: 21, upgrade_id: 41, upgrade_name: 'Faster' }, method: 'PUT', path: `${PROFILE_PATH}/upgrades/41`, form: { upgrade_name: 'Faster' } },
  { name: 'delete_my_shipping_upgrade', args: { profile_id: 21, upgrade_id: 41 }, method: 'DELETE', path: `${PROFILE_PATH}/upgrades/41` },
  { name: 'list_my_processing_profiles', args: {}, method: 'GET', path: RS, query: { limit: '100' } },
  {
    name: 'create_my_processing_profile',
    args: { readiness_state: 'made_to_order', min_processing_time: 2, max_processing_time: 4 },
    method: 'POST',
    path: RS,
    form: { readiness_state: 'made_to_order', min_processing_time: '2', max_processing_time: '4' }
  },
  { name: 'update_my_processing_profile', args: { processing_profile_id: 51, processing_time_unit: 'weeks' }, method: 'PUT', path: `${RS}/51`, form: { processing_time_unit: 'weeks' } },
  { name: 'delete_my_processing_profile', args: { processing_profile_id: 51 }, method: 'DELETE', path: `${RS}/51` },
  { name: 'list_my_return_policies', args: {}, method: 'GET', path: RP },
  {
    name: 'create_my_return_policy',
    args: { accepts_returns: true, accepts_exchanges: false, return_deadline: 21 },
    method: 'POST',
    path: RP,
    form: { accepts_returns: 'true', accepts_exchanges: 'false', return_deadline: '21' }
  },
  {
    name: 'update_my_return_policy',
    args: { return_policy_id: 61, accepts_returns: false, accepts_exchanges: true, return_deadline: 90 },
    method: 'PUT',
    path: `${RP}/61`,
    form: { accepts_returns: 'false', accepts_exchanges: 'true', return_deadline: '90' }
  },
  { name: 'delete_my_return_policy', args: { return_policy_id: 61 }, method: 'DELETE', path: `${RP}/61` },
  {
    name: 'consolidate_my_return_policies',
    args: { source_return_policy_id: 61, destination_return_policy_id: 62 },
    method: 'POST',
    path: `${RP}/consolidate`,
    form: { source_return_policy_id: '61', destination_return_policy_id: '62' }
  },
  { name: 'list_products_by_return_policy', args: { return_policy_id: 61 }, method: 'GET', path: `${RP}/61/listings` },
  { name: 'get_my_holidays', args: {}, method: 'GET', path: `${SHOP}/holiday-preferences` },
  { name: 'set_my_holiday', args: { holiday_id: 7, is_working: false }, method: 'PUT', path: `${SHOP}/holiday-preferences/7`, form: { is_working: 'false' } },
  { name: 'list_my_production_partners', args: {}, method: 'GET', path: `${SHOP}/production-partners` }
]

const toolsOf = (deps = mcpDeps(ROUTES).deps) => shopConfigFeature.mcpTools!(deps)
const WRITE_TOOLS = toolsOf().filter((t) => t.readOnly === false).map((t) => t.name)

describe('shopConfig MCP tools', () => {
  it('the tool list: same names and order as SHOP_CONFIG_TOOL_SUMMARY, write flags match, closed schemas, every tool tested', () => {
    const tools = toolsOf()
    expect(tools.map((t) => t.name)).toEqual(SHOP_CONFIG_TOOL_SUMMARY.map((t) => t.name))
    expect(tools.map((t) => t.readOnly === false)).toEqual(SHOP_CONFIG_TOOL_SUMMARY.map((t) => !!t.write))
    expect(TOOL_CALLS.map((t) => t.name)).toEqual(tools.map((t) => t.name))
    for (const t of tools) {
      expect(t.inputSchema.additionalProperties).toBe(false)
      if (t.readOnly === false) {
        expect(t.destructive).toBe(true)
        expect(t.description).toContain("changes the user's live store")
      }
    }
  })

  for (const tc of TOOL_CALLS) {
    it(`${tc.name}: ${tc.method} ${tc.path.replace(SHOP, '…')}`, async () => {
      const { deps, fetch } = mcpDeps(ROUTES)
      const r = await callTool(shopConfigFeature, deps, tc.name, tc.args)
      expect(r.isError, r.text).toBe(false)
      expect(fetch.calls).toHaveLength(1)
      const c = fetch.calls[0]
      expect(c.method).toBe(tc.method)
      expect(c.url.pathname).toBe(tc.path)
      if (tc.form) expect(formOf(c.body)).toEqual(tc.form)
      else expect(c.body).toBeNull()
      expect(Object.fromEntries(c.url.searchParams)).toEqual(tc.query ?? {})
      expect(r.json).not.toBeNull()
    })
  }

  it('outputs: neutral shapes with decimal money', async () => {
    const { deps } = mcpDeps(ROUTES)
    const p = await callTool(shopConfigFeature, deps, 'list_my_shipping_profiles')
    expect(p.json.profiles[0]).toMatchObject({
      id: 21,
      origin_country: 'UA',
      destinations: [{ id: 31, destination_country: 'US', cost: { amount: 5, currency: 'USD' }, additional_item_cost: { amount: 1.5, currency: 'USD' } }],
      upgrades: [{ id: 41, type: 'international', price: { amount: 10, currency: 'USD' }, carrier_id: 2, mail_class: 'priority' }]
    })
    expect((await callTool(shopConfigFeature, deps, 'list_my_sections')).json).toEqual({
      sections: [{ id: 11, title: 'Planners & More', position: 1, active_products: 4 }]
    })
    expect((await callTool(shopConfigFeature, deps, 'delete_my_section', { section_id: 11 })).json).toEqual({ deleted: true })
    expect((await callTool(shopConfigFeature, deps, 'set_my_product_section', { product_id: 900, section_id: 0 })).json).toEqual({
      product_id: 900,
      title: 'Budget planner',
      state: 'active',
      section_id: null
    })
    expect((await callTool(shopConfigFeature, deps, 'list_products_by_return_policy', { return_policy_id: 61 })).json).toEqual({
      products: [{ product_id: 900, title: 'Budget planner', state: 'active' }]
    })
    expect((await callTool(shopConfigFeature, deps, 'get_my_holidays')).json).toEqual({
      holidays: [{ holiday_id: 7, country: 'US', name: 'Thanksgiving', is_working: false }]
    })
  })

  it('writes are refused while changes are off — no request made', async () => {
    for (const name of WRITE_TOOLS) {
      const { deps, fetch } = mcpDeps(ROUTES, { writes: false })
      const tc = TOOL_CALLS.find((t) => t.name === name)!
      const r = await callTool(shopConfigFeature, deps, name, tc.args)
      expect(r.isError).toBe(true)
      expect(r.text).toContain('Changes to the store are switched off')
      expect(fetch.calls).toHaveLength(0)
    }
  })

  it('not signed in: every tool says so, no request made', async () => {
    for (const tc of TOOL_CALLS) {
      const { deps, fetch } = mcpDeps(ROUTES, { status: signedOut })
      const r = await callTool(shopConfigFeature, deps, tc.name, tc.args)
      expect(r.isError).toBe(true)
      expect(r.text).toContain('has not connected their own store')
      expect(fetch.calls).toHaveLength(0)
    }
    const noClient = await callTool(shopConfigFeature, mcpDeps(ROUTES, { client: null }).deps, 'list_my_sections')
    expect(noClient.text).toContain('has not connected their own store')
  })

  it('a missing permission is named; bad input comes back in English; schema checks', async () => {
    const { deps } = mcpDeps(ROUTES, { status: signedIn({ scopes: ALL_SCOPES.filter((s) => s !== 'shops_w') }) })
    const r = await callTool(shopConfigFeature, deps, 'create_my_section', { title: 'x' })
    expect(r.text).toContain('lacks a permission this needs (shops_w)')
    const w = mcpDeps(ROUTES).deps
    const both = await callTool(shopConfigFeature, w, 'create_my_shipping_destination', {
      profile_id: 21,
      primary_cost: 1,
      secondary_cost: 1,
      destination_country_iso: 'DE',
      destination_region: 'eu',
      min_delivery_days: 1,
      max_delivery_days: 2
    })
    expect(both.isError).toBe(true)
    expect(both.text).toBe('Give destination_country_iso or destination_region, not both.')
    const none = await callTool(shopConfigFeature, w, 'update_my_shipping_destination', {
      profile_id: 21,
      destination_id: 31,
      destination_country_iso: 'DE',
      destination_region: 'none'
    })
    expect([none.isError, none.text]).toEqual([true, 'Give destination_country_iso or destination_region, not both.'])
    const clear = mcpDeps(ROUTES)
    const cleared = await callTool(shopConfigFeature, clear.deps, 'update_my_shipping_profile', { profile_id: 21, origin_postal_code: '' })
    expect(cleared.isError).toBeFalsy()
    expect([clear.fetch.calls[0].method, clear.fetch.calls[0].body]).toEqual(['PUT', 'origin_postal_code='])
    const deadline = await callTool(shopConfigFeature, w, 'create_my_return_policy', { accepts_returns: true, accepts_exchanges: true })
    expect(deadline.text).toBe('return_deadline is required when returns or exchanges are accepted.')
    expect((await callTool(shopConfigFeature, w, 'update_my_shipping_upgrade', { profile_id: 21, upgrade_id: 41 })).text).toBe('Nothing to change.')
    expect((await callTool(shopConfigFeature, w, 'create_my_return_policy', { accepts_returns: true, accepts_exchanges: true, return_deadline: 10 })).text).toContain(
      'must be one of: 7, 14, 21, 30, 45, 60, 90'
    )
    expect((await callTool(shopConfigFeature, w, 'set_my_holiday', { holiday_id: 106, is_working: true })).text).toContain('must be ≤ 105')
    expect((await callTool(shopConfigFeature, w, 'list_my_sections', { extra: 1 })).text).toContain('Unknown argument "extra"')
    expect((await callTool(shopConfigFeature, w, 'create_my_shipping_profile', { ...TOOL_CALLS.find((t) => t.name === 'create_my_shipping_profile')!.args, origin_country_iso: 'ZZ' })).text).toBe(
      '"origin_country_iso" must be a 2-letter ISO country code.'
    )
    expect(
      (await callTool(shopConfigFeature, w, 'consolidate_my_return_policies', { source_return_policy_id: 61, destination_return_policy_id: 61 })).text
    ).toBe('The source and destination policies must differ.')
  })

  it('store errors are neutral (400 detail, 409, 500)', async () => {
    const { deps } = mcpDeps({
      ...ROUTES,
      [`POST ${SHOP}/sections`]: { status: 400, body: { error: 'Etsy says: title invalid, see https://www.etsy.com/help' } },
      [`POST ${RS}`]: { status: 409 },
      [`PUT ${RS}/{id}`]: { status: 409 },
      [`PUT ${SHOP}/policies/return/{id}`]: { status: 409 },
      [`GET ${SHOP}/production-partners`]: { status: 500 }
    })
    const bad = await callTool(shopConfigFeature, deps, 'create_my_section', { title: 'x' })
    expect(bad.text).toBe('The store rejected the request as invalid (HTTP 400): marketplace says: title invalid, see [link].')
    const conflict = await callTool(shopConfigFeature, deps, 'create_my_processing_profile', {
      readiness_state: 'made_to_order',
      min_processing_time: 1,
      max_processing_time: 2
    })
    expect(conflict.text).toBe('A processing profile with these values already exists.')
    const update = await callTool(shopConfigFeature, deps, 'update_my_processing_profile', { processing_profile_id: 51, max_processing_time: 4 })
    expect([update.isError, update.text]).toEqual([true, 'A processing profile with these values already exists.'])
    const policy = await callTool(shopConfigFeature, deps, 'update_my_return_policy', {
      return_policy_id: 61,
      accepts_returns: true,
      accepts_exchanges: false,
      return_deadline: 14
    })
    expect([policy.isError, policy.text]).toEqual([true, 'A return policy with these terms already exists; use consolidate_my_return_policies to merge them.'])
    const server = await callTool(shopConfigFeature, deps, 'list_my_production_partners')
    expect(server.isError).toBe(true)
    expect(server.text).not.toMatch(/etsy/i)
  })

  it('neutrality sweep: no marketplace name, no URL in anything a client gets', async () => {
    const leak = 'Etsy pick https://www.etsy.com/shop/x etsystatic.com/img'
    const routes = {
      ...ROUTES,
      [`GET ${SHOP}/sections`]: { body: { count: 1, results: [{ ...SECTION, title: leak }] } },
      [`GET ${SHOP}/shipping-profiles`]: {
        body: { count: 1, results: [{ ...PROFILE, title: leak, shipping_profile_upgrades: [{ ...UPGRADE, upgrade_name: leak }] }] }
      },
      [`GET ${SHOP}/readiness-state-definitions`]: { body: { count: 1, results: [{ ...READY, processing_days_display_label: leak }] } },
      [`GET ${SHOP}/policies/return/{id}/listings`]: { body: { count: 1, results: [{ ...LISTING, title: leak }] } },
      [`GET ${SHOP}/holiday-preferences`]: { body: [{ ...HOLIDAY, holiday_name: leak }] },
      [`GET ${SHOP}/production-partners`]: { body: { count: 1, results: [{ ...PARTNER, partner_name: leak, location: leak }] } }
    }
    const texts: string[] = []
    for (const tc of TOOL_CALLS) {
      for (const over of [{}, { writes: false }, { status: signedOut }]) {
        const r = await callTool(shopConfigFeature, mcpDeps(routes, over).deps, tc.name, tc.args)
        texts.push(r.text)
      }
    }
    texts.push(JSON.stringify(toolsOf().map(({ run: _run, ...t }) => t)))
    expect(texts.join('\n')).toContain('marketplace pick [link]')
    for (const t of texts) {
      expect(t).not.toMatch(/etsy/i)
      expect(t).not.toMatch(/https?:\/\//)
    }
  })
})
