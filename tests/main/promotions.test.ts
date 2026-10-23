import { describe, expect, it } from 'vitest'
import type { BuyerPrice } from '../../src/shared/types'
import {
  type Db,
  getListing,
  getOpenPromotion,
  getShopSummary,
  listListingPromotions,
  listListingStats,
  listScanChanges,
  listScanPromotions
} from '../../src/main/db'
import { countsAsEnd, countsAsStart, promotionStep, samePromotion } from '../../src/main/promotions'
import { createScanner } from '../../src/main/scanner'
import type { ScanOutcome } from '../../src/shared/types'
import { FakeEtsy, SHOP_ID } from '../helpers/fakeEtsy'
import { memDb, seedShop } from '../helpers/db'

const bp = (over: Partial<BuyerPrice> = {}): BuyerPrice => ({
  country: 'UA',
  currency: 'USD',
  base: { amount: 300, divisor: 100 },
  original: { amount: 300, divisor: 100 },
  discounted: { amount: 120, divisor: 100 },
  discountAmount: { amount: 180, divisor: 100 },
  discountPercentage: 60,
  hasDiscount: true,
  discountStart: 1000,
  discountEnd: 2000,
  shipping: null,
  isFreeShipping: null,
  ...over
})
const none = (over: Partial<BuyerPrice> = {}): BuyerPrice =>
  bp({
    discounted: null,
    discountAmount: null,
    discountPercentage: null,
    hasDiscount: false,
    discountStart: null,
    discountEnd: null,
    ...over
  })
const open = (over: Partial<BuyerPrice> = {}) => {
  const b = bp(over)
  return { country: b.country, discountStart: b.discountStart, discountEnd: b.discountEnd, discountPercentage: b.discountPercentage }
}

describe('promotionStep (pure)', () => {
  it('an unknown buyer price this scan changes nothing (a running promotion stays open)', () => {
    expect(promotionStep(open(), bp(), null)).toEqual({})
    expect(promotionStep(open(), bp(), undefined)).toEqual({})
  })

  it('no promotion before or now: nothing', () => {
    expect(promotionStep(null, none(), none())).toEqual({})
    expect(promotionStep(null, null, none())).toEqual({})
  })

  it('a discount at the first observation (baseline, new listing, first v4 scan) was already running', () => {
    expect(promotionStep(null, null, bp())).toEqual({ start: 'running' })
    expect(promotionStep(null, none(), bp(), { isNew: true })).toEqual({ start: 'running' })
  })

  it('no discount last time, one now (same country): it started', () => {
    const s = promotionStep(null, none(), bp())
    expect(s).toEqual({ start: 'seen' })
    expect(countsAsStart(s)).toBe(true)
  })

  it('the same promotion again continues — also with a later end date (same start)', () => {
    expect(promotionStep(open(), bp(), bp())).toEqual({ continue: true })
    expect(promotionStep(open(), bp(), bp({ discountEnd: 9999 }))).toEqual({ continue: true })
  })

  it('without start epochs a promotion is identified by % and end', () => {
    const o = open({ discountStart: null })
    expect(samePromotion(o, bp({ discountStart: null }))).toBe(true)
    expect(samePromotion(o, bp({ discountStart: null, discountPercentage: 30 }))).toBe(false)
    expect(samePromotion(o, bp({ discountStart: null, discountEnd: 3000 }))).toBe(false)
  })

  it('a different promotion replaces the running one', () => {
    const s = promotionStep(open(), bp(), bp({ discountStart: 5000, discountPercentage: 30 }))
    expect(s).toEqual({ end: 'replaced', start: 'seen' })
    expect(countsAsEnd(s) && countsAsStart(s)).toBe(true)
  })

  it('no discount any more: it ended', () => {
    const s = promotionStep(open(), bp(), none())
    expect(s).toEqual({ end: 'ended' })
    expect(countsAsEnd(s)).toBe(true)
  })

  it('the same start with a new percentage is a new promotion (the history keeps each one’s terms)', () => {
    expect(samePromotion(open(), bp({ discountPercentage: 30 }))).toBe(false)
    expect(samePromotion(open({ discountPercentage: null }), bp({ discountPercentage: null, discountEnd: 5 }))).toBe(true)
    const s = promotionStep(open(), bp(), bp({ discountPercentage: 30 }))
    expect(s).toEqual({ end: 'replaced', start: 'seen' })
  })

  describe('a running promotion with no previous observation (the price was unknown meanwhile)', () => {
    it('the same terms simply continue', () => {
      expect(promotionStep(open(), null, bp())).toEqual({ continue: true })
    })

    it('gone now: ended at an unknown time — not reported', () => {
      const s = promotionStep(open(), null, none())
      expect(s).toEqual({ end: 'unknown' })
      expect(countsAsEnd(s)).toBe(false)
    })

    it('a different one now: unknown end + "running" start — neither reported', () => {
      const s = promotionStep(open(), null, bp({ discountStart: 5000, discountPercentage: 30 }))
      expect(s).toEqual({ end: 'unknown', start: 'running' })
      expect(countsAsEnd(s) || countsAsStart(s)).toBe(false)
    })

    it('a returned listing (isNew) is treated the same, whatever its stale stored price says', () => {
      expect(promotionStep(open(), bp(), none(), { isNew: true })).toEqual({ end: 'unknown' })
      expect(promotionStep(open(), none(), bp({ discountStart: 7 }), { isNew: true })).toEqual({
        end: 'unknown',
        start: 'running'
      })
      expect(promotionStep(open(), bp(), bp(), { isNew: true })).toEqual({ continue: true })
    })
  })

  describe('buyer country switch', () => {
    it('the same promotion continues under the new country (% and dates are country-independent)', () => {
      expect(promotionStep(open(), bp(), bp({ country: 'DE', discounted: { amount: 119, divisor: 100 } }))).toEqual({
        continue: true
      })
    })

    it('a discount appearing with the switch is "country", not a start', () => {
      const s = promotionStep(null, none({ country: 'UA' }), bp({ country: 'DE' }))
      expect(s).toEqual({ start: 'country' })
      expect(countsAsStart(s)).toBe(false)
    })

    it('a discount vanishing with the switch is "country", not an end', () => {
      const s = promotionStep(open(), bp(), none({ country: 'DE' }))
      expect(s).toEqual({ end: 'country' })
      expect(countsAsEnd(s)).toBe(false)
    })

    it('a different promotion with the switch: both sides "country"', () => {
      const s = promotionStep(open(), bp(), bp({ country: 'DE', discountStart: 7000 }))
      expect(s).toEqual({ end: 'country', start: 'country' })
      expect(countsAsEnd(s) || countsAsStart(s)).toBe(false)
    })

    it('with no previous observation there is no reference country: the end is "unknown"', () => {
      expect(promotionStep(open(), null, none({ country: 'DE' }))).toEqual({ end: 'unknown' })
      expect(promotionStep(null, null, bp({ country: 'DE' }))).toEqual({ start: 'running' })
    })
  })
})

// --------------------------------------------------------------- integration

function setup(count = 3, country: string | null = 'UA') {
  const db = memDb()
  seedShop(db, { id: SHOP_ID })
  const etsy = new FakeEtsy(count)
  if (etsy.listings[0]) etsy.listings[0].price = { amount: 250, divisor: 100, currency_code: 'USD' }
  let t = 1_000_000
  const settings = { country }
  const scanner = createScanner({
    db,
    client: etsy.client({ maxRetries: 1 }),
    now: () => (t += 1000),
    getBuyerCountry: () => settings.country
  })
  return { db, etsy, scanner, settings }
}

function ok(o: ScanOutcome) {
  if (!o.ok) throw new Error(`scan failed: ${o.error}`)
  return o.scan
}

const promosOf = (db: Db, id: number) =>
  listListingPromotions(db, id).map((p) => [p.discountPercentage, p.startKind, p.endReason, p.country])

describe('scans with buyer prices', () => {
  it('stores the buyer price of every listing and records the scan as served — the 2.50 vs 1.20 issue', async () => {
    const { db, etsy, scanner } = setup()
    etsy.promotions[1] = { percentage: 60, start: 1_759_276_800, end: 1_761_868_800 }
    const s1 = ok(await scanner.scanShop(SHOP_ID))
    expect(s1).toMatchObject({ buyerCountry: 'UA', buyerPrices: 'ok', promotionsStarted: 0, promotionsEnded: 0 })
    const l = getListing(db, 1)!
    // The seller's base price is unchanged: what the API's `price` says.
    expect(l).toMatchObject({ priceAmount: 250, priceDivisor: 100, currency: 'USD' })
    expect(l.buyerPrice).toMatchObject({
      country: 'UA',
      currency: 'USD',
      base: { amount: 300, divisor: 100 },
      original: { amount: 300, divisor: 100 },
      discounted: { amount: 120, divisor: 100 },
      discountAmount: { amount: 180, divisor: 100 },
      discountPercentage: 60,
      hasDiscount: true,
      discountStart: 1_759_276_800,
      discountEnd: 1_761_868_800
    })
    expect(l.buyerPrice!.fetchedAt).toEqual(expect.any(Number))
    expect(getListing(db, 2)!.buyerPrice).toMatchObject({ hasDiscount: false, discounted: null, original: { amount: 1202 } })
    // Per-scan price history.
    expect(listListingStats(db, 1)[0]).toMatchObject({
      price: { amount: 250, divisor: 100, currency: 'USD' },
      buyerPrice: { country: 'UA', discountPercentage: 60, discounted: { amount: 120, divisor: 100 } }
    })
    // Baseline: the promotion was already running — recorded, not reported as started.
    expect(promosOf(db, 1)).toEqual([[60, 'running', null, 'UA']])
    expect(listScanPromotions(db, s1.id)).toEqual({ started: [], ended: [] })
  })

  it('promotions start, continue and end across scans; buyer-price moves are never listing changes', async () => {
    const { db, etsy, scanner } = setup()
    ok(await scanner.scanShop(SHOP_ID))
    etsy.promotions[2] = { percentage: 25, start: 2_000_000_000, end: 2_000_900_000 }
    const s2 = ok(await scanner.scanShop(SHOP_ID))
    expect(s2).toMatchObject({ changed: 0, promotionsStarted: 1, promotionsEnded: 0 })
    expect(listScanChanges(db, s2.id)).toEqual([])
    const started = listScanPromotions(db, s2.id).started
    expect(started).toHaveLength(1)
    expect(started[0]).toMatchObject({
      listingId: 2,
      discountPercentage: 25,
      startKind: 'seen',
      startedScanId: s2.id,
      listingTitle: 'Listing 2',
      listingImageId: 21,
      discounted: { amount: Math.round(1202 * 0.75), divisor: 100 }
    })
    expect(getOpenPromotion(db, 2)).toMatchObject({ discountPercentage: 25 })

    // Still running: continues (one row), nothing started/ended.
    const s3 = ok(await scanner.scanShop(SHOP_ID))
    expect(s3).toMatchObject({ changed: 0, promotionsStarted: 0, promotionsEnded: 0 })
    expect(listListingPromotions(db, 2)).toHaveLength(1)
    expect(listListingPromotions(db, 2)[0].lastSeenAt).toBeGreaterThan(listListingPromotions(db, 2)[0].firstSeenAt)

    // Over.
    delete etsy.promotions[2]
    const s4 = ok(await scanner.scanShop(SHOP_ID))
    expect(s4).toMatchObject({ changed: 0, promotionsStarted: 0, promotionsEnded: 1 })
    expect(listScanPromotions(db, s4.id).ended.map((p) => [p.listingId, p.endReason])).toEqual([[2, 'ended']])
    expect(getOpenPromotion(db, 2)).toBeNull()
    expect(getListing(db, 2)!.buyerPrice).toMatchObject({ hasDiscount: false })
    expect(listListingStats(db, 2).map((p) => p.buyerPrice?.hasDiscount)).toEqual([false, true, true, false])

    // A new, different sale replaces nothing (none running) and starts again.
    etsy.promotions[2] = { percentage: 40, start: 2_100_000_000, end: 2_100_900_000 }
    const s5 = ok(await scanner.scanShop(SHOP_ID))
    expect(s5.promotionsStarted).toBe(1)
    expect(promosOf(db, 2)).toEqual([
      [40, 'seen', null, 'UA'],
      [25, 'seen', 'ended', 'UA']
    ])
    // A different promotion right after another: replaced + started.
    etsy.promotions[2] = { percentage: 10, start: 2_200_000_000, end: 2_200_900_000 }
    const s6 = ok(await scanner.scanShop(SHOP_ID))
    expect(s6).toMatchObject({ promotionsStarted: 1, promotionsEnded: 1, changed: 0 })
    expect(listScanPromotions(db, s6.id).ended[0]).toMatchObject({ discountPercentage: 40, endReason: 'replaced' })
  })

  it('the seller base price change is still a "ціна" change; the buyer price follows silently', async () => {
    const { db, etsy, scanner } = setup()
    ok(await scanner.scanShop(SHOP_ID))
    etsy.listings[0].price = { amount: 300, divisor: 100, currency_code: 'USD' }
    const s2 = ok(await scanner.scanShop(SHOP_ID))
    expect(s2.changed).toBe(1)
    expect(listScanChanges(db, s2.id)[0].newValue).toEqual({ priceAmount: 300, priceDivisor: 100, currency: 'USD' })
    expect(getListing(db, 1)!.buyerPrice!.original).toEqual({ amount: 360, divisor: 100 })
  })

  it('a new listing arriving with a sale is "running", not a started promotion', async () => {
    const { db, etsy, scanner } = setup(2)
    ok(await scanner.scanShop(SHOP_ID))
    const { mkEtsyListing } = await import('../helpers/fakeEtsy')
    etsy.listings.push(mkEtsyListing(9))
    etsy.promotions[9] = { percentage: 15, start: 1, end: 2 }
    const s2 = ok(await scanner.scanShop(SHOP_ID))
    expect(s2).toMatchObject({ added: 1, promotionsStarted: 0 })
    expect(promosOf(db, 9)).toEqual([[15, 'running', null, 'UA']])
  })

  it('a fixed-amount promotion (no percentage) is tracked too', async () => {
    const { db, etsy, scanner } = setup(1)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.promotions[1] = { percentage: null, amount: 50, start: 10, end: 20 }
    const s2 = ok(await scanner.scanShop(SHOP_ID))
    expect(s2.promotionsStarted).toBe(1)
    expect(listListingPromotions(db, 1)[0]).toMatchObject({
      discountPercentage: null,
      discountAmount: { amount: 50, divisor: 100 },
      discounted: { amount: 250, divisor: 100 }
    })
  })

  it('a percentage change with the same start ends one promotion and starts another, keeping each one’s terms', async () => {
    const { db, etsy, scanner } = setup(1)
    ok(await scanner.scanShop(SHOP_ID))
    etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
    const s2 = ok(await scanner.scanShop(SHOP_ID))
    expect(s2.promotionsStarted).toBe(1)
    etsy.promotions[1] = { percentage: 30, start: 100, end: 200 }
    const s3 = ok(await scanner.scanShop(SHOP_ID))
    expect(s3).toMatchObject({ promotionsStarted: 1, promotionsEnded: 1 })
    expect(listScanPromotions(db, s2.id).started.map((p) => p.discountPercentage)).toEqual([60])
    expect(promosOf(db, 1)).toEqual([
      [30, 'seen', null, 'UA'],
      [60, 'seen', 'replaced', 'UA']
    ])
  })

  describe('a listing that disappears while on sale', () => {
    async function removedOnSale() {
      const ctx = setup(2)
      ctx.etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
      ok(await ctx.scanner.scanShop(SHOP_ID))
      ctx.etsy.listings[0].state = 'inactive'
      const sR = ok(await ctx.scanner.scanShop(SHOP_ID))
      return { ...ctx, sR }
    }

    it('its running promotion ends as "removed" with that scan — not reported as ended', async () => {
      const { db, sR } = await removedOnSale()
      expect(sR).toMatchObject({ removed: 1, promotionsEnded: 0 })
      expect(getListing(db, 1)!.removedAt).not.toBeNull()
      expect(getOpenPromotion(db, 1)).toBeNull()
      expect(listListingPromotions(db, 1)[0]).toMatchObject({ endReason: 'removed', endedScanId: sR.id })
      expect(listScanPromotions(db, sR.id)).toEqual({ started: [], ended: [] })
    })

    it('coming back without the sale reports nothing', async () => {
      const { db, etsy, scanner } = await removedOnSale()
      ok(await scanner.scanShop(SHOP_ID))
      delete etsy.promotions[1]
      etsy.listings[0].state = 'active'
      const sBack = ok(await scanner.scanShop(SHOP_ID))
      expect(sBack).toMatchObject({ returned: 1, promotionsStarted: 0, promotionsEnded: 0 })
      expect(promosOf(db, 1)).toEqual([[60, 'running', 'removed', 'UA']])
      expect(getListing(db, 1)!.buyerPrice).toMatchObject({ hasDiscount: false })
    })

    it('coming back with a sale: it is "running" (unknown when it began), not a start', async () => {
      const { db, etsy, scanner } = await removedOnSale()
      etsy.listings[0].state = 'active'
      etsy.promotions[1] = { percentage: 20, start: 900, end: 950 }
      const sBack = ok(await scanner.scanShop(SHOP_ID))
      expect(sBack).toMatchObject({ returned: 1, promotionsStarted: 0, promotionsEnded: 0 })
      expect(promosOf(db, 1)).toEqual([
        [20, 'running', null, 'UA'],
        [60, 'running', 'removed', 'UA']
      ])
    })
  })

  describe('buyer country switch', () => {
    it('the same sale under a new country continues: no start/end, prices follow the new VAT', async () => {
      const { db, etsy, scanner, settings } = setup()
      etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
      ok(await scanner.scanShop(SHOP_ID))
      settings.country = 'DE'
      const s2 = ok(await scanner.scanShop(SHOP_ID))
      expect(s2).toMatchObject({ buyerCountry: 'DE', promotionsStarted: 0, promotionsEnded: 0, changed: 0 })
      expect(listListingPromotions(db, 1)).toHaveLength(1)
      expect(getOpenPromotion(db, 1)).toMatchObject({ country: 'DE', original: { amount: Math.round(250 * 1.19) } })
      expect(getListing(db, 1)!.buyerPrice).toMatchObject({ country: 'DE', original: { amount: 298 } })
    })

    it('a sale appearing or vanishing together with the switch is not reported', async () => {
      const { db, etsy, scanner, settings } = setup()
      ok(await scanner.scanShop(SHOP_ID))
      settings.country = 'US'
      etsy.promotions[2] = { percentage: 30, start: 1, end: 2 }
      const s2 = ok(await scanner.scanShop(SHOP_ID))
      expect(s2).toMatchObject({ promotionsStarted: 0, promotionsEnded: 0 })
      expect(listScanPromotions(db, s2.id)).toEqual({ started: [], ended: [] })
      expect(promosOf(db, 2)).toEqual([[30, 'country', null, 'US']])
      settings.country = 'UA'
      delete etsy.promotions[2]
      const s3 = ok(await scanner.scanShop(SHOP_ID))
      expect(s3).toMatchObject({ promotionsStarted: 0, promotionsEnded: 0 })
      expect(promosOf(db, 2)).toEqual([[30, 'country', 'country', 'US']])
      // Back to normal: the next real start is reported again.
      etsy.promotions[2] = { percentage: 30, start: 5, end: 6 }
      expect(ok(await scanner.scanShop(SHOP_ID)).promotionsStarted).toBe(1)
    })
  })

  describe('when buyer prices are unavailable', () => {
    it('Etsy refusing BuyerPrice never breaks the scan: recorded as unavailable, stored prices cleared, promotions left open', async () => {
      const { db, etsy, scanner } = setup()
      etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
      ok(await scanner.scanShop(SHOP_ID))
      etsy.refuseIncludes = ['BuyerPrice']
      // A fresh client (the app restarted) that finds BuyerPrice refused.
      const fresh = createScanner({ db, client: etsy.client(), now: () => 9_000_000, getBuyerCountry: () => 'UA' })
      const s2 = ok(await fresh.scanShop(SHOP_ID))
      expect(s2).toMatchObject({ buyerCountry: 'UA', buyerPrices: 'unavailable', changed: 0, promotionsEnded: 0 })
      expect(getListing(db, 1)!.buyerPrice).toBeNull()
      expect(getListing(db, 1)!.images).toHaveLength(2)
      expect(getOpenPromotion(db, 1)).not.toBeNull()
      expect(listListingStats(db, 1).at(-1)!.buyerPrice).toBeNull()
      expect(getShopSummary(db, SHOP_ID)!.lastOkScan!.buyerPrices).toBe('unavailable')
    })

    it('a listing the details call didn’t answer keeps its stored buyer price (and its promotion)', async () => {
      const { db, etsy, scanner } = setup(2)
      etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
      ok(await scanner.scanShop(SHOP_ID))
      etsy.intercept = (url) =>
        url.pathname.endsWith('/listings/batch') ? { body: { count: 0, results: [] } } : null
      delete etsy.promotions[1]
      const s2 = ok(await scanner.scanShop(SHOP_ID))
      expect(s2).toMatchObject({ promotionsEnded: 0, changed: 0 })
      expect(getListing(db, 1)!.buyerPrice).toMatchObject({ hasDiscount: true, discountPercentage: 60 })
      expect(getOpenPromotion(db, 1)).not.toBeNull()
      expect(listListingStats(db, 1).at(-1)!.buyerPrice).toBeNull()
    })

    it('a listing only GET /listings/{id} answered (no buyer_price there per the OAS) keeps its stored one', async () => {
      const db = memDb()
      seedShop(db, { id: SHOP_ID })
      const etsy = new FakeEtsy(3, { batchUnknown: '404' })
      const scanner = createScanner({ db, client: etsy.client(), getBuyerCountry: () => 'UA' })
      etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
      ok(await scanner.scanShop(SHOP_ID))
      // A listing vanishes between paging and details → the batch 404s → bisect → single GETs.
      etsy.intercept = (url) =>
        url.pathname.endsWith('/listings/batch') ? { status: 404, body: { error: 'Could not find listings' } } : null
      delete etsy.promotions[1]
      const s2 = ok(await scanner.scanShop(SHOP_ID))
      expect(etsy.count('/v3/application/listings/1')).toBe(1)
      expect(etsy.requests.find((u) => u.pathname === '/v3/application/listings/1')!.searchParams.get('buyer_country')).toBe('UA')
      // No details answer carried buyer_price: the scan learned none → unavailable.
      expect(s2).toMatchObject({ promotionsEnded: 0, buyerPrices: 'unavailable' })
      expect(getListing(db, 1)!.buyerPrice).toMatchObject({ hasDiscount: true })
      expect(getOpenPromotion(db, 1)).not.toBeNull()
    })

    it('Etsy accepting BuyerPrice but leaving buyer_price out: unavailable, stored prices kept', async () => {
      const { db, etsy, scanner } = setup(2)
      etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
      ok(await scanner.scanShop(SHOP_ID))
      etsy.batchBuyerPrice = false
      delete etsy.promotions[1]
      const s2 = ok(await scanner.scanShop(SHOP_ID))
      expect(etsy.requests.at(-1)!.searchParams.get('includes')).toContain('BuyerPrice')
      expect(s2).toMatchObject({ buyerCountry: 'UA', buyerPrices: 'unavailable', promotionsEnded: 0 })
      expect(getListing(db, 1)!.buyerPrice).toMatchObject({ hasDiscount: true })
      expect(getOpenPromotion(db, 1)).not.toBeNull()
      // Served again: ok.
      etsy.batchBuyerPrice = true
      expect(ok(await scanner.scanShop(SHOP_ID)).buyerPrices).toBe('ok')
    })

    it('a shop with no active listings is not "unavailable"', async () => {
      const { scanner } = setup(0)
      expect(ok(await scanner.scanShop(SHOP_ID))).toMatchObject({ buyerCountry: 'UA', buyerPrices: 'ok' })
    })

    it('a refused Videos include keeps buyer prices and promotions (Images+BuyerPrice fallback)', async () => {
      const { db, etsy, scanner } = setup(2)
      etsy.refuseIncludes = ['Videos']
      etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
      const s1 = ok(await scanner.scanShop(SHOP_ID))
      expect(s1).toMatchObject({ buyerCountry: 'UA', buyerPrices: 'ok' })
      expect(getListing(db, 1)!.buyerPrice).toMatchObject({ hasDiscount: true, discounted: { amount: 120 } })
      expect(promosOf(db, 1)).toEqual([[60, 'running', null, 'UA']])
      delete etsy.promotions[1]
      const s2 = ok(await scanner.scanShop(SHOP_ID))
      expect(s2).toMatchObject({ buyerPrices: 'ok', promotionsEnded: 1 })
    })

    it('a country Etsy refuses does not switch buyer prices off for the next country (same client)', async () => {
      const { db, etsy, scanner, settings } = setup(2)
      etsy.intercept = (url) =>
        url.searchParams.get('buyer_country') === 'AQ' ? { status: 400, body: { error: 'Invalid buyer_country' } } : null
      settings.country = 'AQ'
      const s1 = ok(await scanner.scanShop(SHOP_ID))
      expect(s1).toMatchObject({ buyerCountry: 'AQ', buyerPrices: 'unavailable' })
      expect(getListing(db, 1)!.buyerPrice).toBeNull()
      settings.country = 'UA'
      const s2 = ok(await scanner.scanShop(SHOP_ID))
      expect(s2).toMatchObject({ buyerCountry: 'UA', buyerPrices: 'ok' })
      expect(getListing(db, 1)!.buyerPrice).toMatchObject({ country: 'UA', original: { amount: 300 } })
    })

    it('a promotion changing while prices were unknown is neither reported as ended nor started', async () => {
      const { db, etsy, scanner } = setup(2)
      etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
      ok(await scanner.scanShop(SHOP_ID))
      // Scan B: Etsy refuses BuyerPrice (a restarted app) → prices cleared, P1 left open.
      etsy.refuseIncludes = ['BuyerPrice']
      const blind = createScanner({ db, client: etsy.client(), now: () => 5_000_000, getBuyerCountry: () => 'UA' })
      ok(await blind.scanShop(SHOP_ID))
      expect(getListing(db, 1)!.buyerPrice).toBeNull()
      // Scan C (restarted again, BuyerPrice served): another sale now.
      etsy.refuseIncludes = []
      etsy.promotions[1] = { percentage: 30, start: 300, end: 400 }
      const later = createScanner({ db, client: etsy.client(), now: () => 6_000_000, getBuyerCountry: () => 'UA' })
      const sC = ok(await later.scanShop(SHOP_ID))
      expect(sC).toMatchObject({ promotionsStarted: 0, promotionsEnded: 0 })
      expect(listScanPromotions(db, sC.id)).toEqual({ started: [], ended: [] })
      expect(promosOf(db, 1)).toEqual([
        [30, 'running', null, 'UA'],
        [60, 'running', 'unknown', 'UA']
      ])
    })

    it('without a buyer country nothing is asked, nothing stored', async () => {
      const { db, etsy, scanner } = setup(2, null)
      const s1 = ok(await scanner.scanShop(SHOP_ID))
      expect(s1).toMatchObject({ buyerCountry: null, buyerPrices: null })
      const batch = etsy.requests.find((u) => u.pathname.endsWith('/listings/batch'))!
      expect(batch.searchParams.get('includes')).toBe('Images,Videos,Personalization')
      expect(getListing(db, 1)!.buyerPrice).toBeNull()
      expect(listListingPromotions(db, 1)).toEqual([])
    })

    it('a failed scan leaves buyer prices and promotions untouched', async () => {
      const { db, etsy, scanner } = setup(2)
      etsy.promotions[1] = { percentage: 60, start: 100, end: 200 }
      ok(await scanner.scanShop(SHOP_ID))
      delete etsy.promotions[1]
      etsy.intercept = (url) => (url.pathname.endsWith('/listings/batch') ? { status: 500, body: {} } : null)
      const s2 = await scanner.scanShop(SHOP_ID)
      expect(s2.ok).toBe(false)
      expect(getListing(db, 1)!.buyerPrice).toMatchObject({ hasDiscount: true })
      expect(getOpenPromotion(db, 1)).not.toBeNull()
      expect(listListingStats(db, 1)).toHaveLength(1)
    })
  })
})
