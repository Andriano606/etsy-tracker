import { describe, expect, it } from 'vitest'
import {
  checkDestinationCreate,
  checkDestinationUpdate,
  checkProcessingCreate,
  checkProcessingUpdate,
  checkProfileCreate,
  checkProfileUpdate,
  checkReturnPolicy,
  checkSection,
  checkUpgradeCreate,
  checkUpgradeUpdate,
  daysText,
  moneyInput,
  moneyText,
  parseCost,
  parseFields,
  SHOP_CONFIG_TOOL_SUMMARY
} from '../../../src/shared/features/shopConfig'

const uk = (c: { problems: Array<{ uk: string }> }) => c.problems.map((p) => p.uk).join(' | ')
const en = (c: { problems: Array<{ en: string }> }) => c.problems.map((p) => p.en).join(' | ')

const profile = {
  title: ' Standard ',
  origin_country_iso: 'ua',
  primary_cost: '5,50',
  secondary_cost: 1,
  destination_country_iso: 'US',
  min_delivery_days: '5',
  max_delivery_days: 10
}

describe('shopConfig field checks', () => {
  it('parseCost: non-negative, ≤ 2 decimals, comma ok', () => {
    expect(parseCost('5,5')).toBe(5.5)
    expect(parseCost(0)).toBe(0)
    expect(parseCost(' 12.34 ')).toBe(12.34)
    expect(parseCost('1.234')).toBeNull()
    expect(parseCost(-1)).toBeNull()
    expect(parseCost('abc')).toBeNull()
    expect(parseCost(true)).toBeNull()
  })

  it('parseFields types values, skips empty, reports required and wrong ones in both languages', () => {
    const c = checkProfileCreate(profile)
    expect(c.problems).toEqual([])
    expect(c.values).toEqual({
      title: 'Standard',
      origin_country_iso: 'UA',
      primary_cost: 5.5,
      secondary_cost: 1,
      destination_country_iso: 'US',
      min_delivery_days: 5,
      max_delivery_days: 10
    })
    const bad = checkProfileCreate({ title: '', origin_country_iso: 'XX', primary_cost: '1.555', secondary_cost: 0, min_processing_time: 11 })
    expect(uk(bad)).toContain('Заповніть «назва»')
    expect(uk(bad)).toContain('«країна відправлення»: невідомий код країни')
    expect(uk(bad)).toContain('«вартість доставки»: сума ≥ 0')
    expect(uk(bad)).toContain('«мін. час обробки»: від 1 до 10')
    expect(en(bad)).toContain('"title" is required.')
    expect(en(bad)).toContain('"origin_country_iso" must be a 2-letter ISO country code.')
    expect(parseFields('nope', []).problems[0].en).toBe('The input must be an object.')
    expect(parseFields({ x: 1, title: 'a' }, [{ name: 'title', label: 't', about: '', kind: 'text' }]).values).toEqual({ title: 'a' })
  })

  it('a profile needs a country or a region (not both) and a carrier + mail class or both delivery days', () => {
    expect(en(checkProfileCreate({ ...profile, destination_country_iso: undefined }))).toContain('Give destination_country_iso or destination_region.')
    expect(uk(checkProfileCreate({ ...profile, destination_region: 'eu' }))).toContain('не обидва')
    expect(checkProfileCreate({ ...profile, destination_country_iso: undefined, destination_region: 'non_eu' }).problems).toEqual([])
    const noDelivery = checkProfileCreate({ ...profile, min_delivery_days: undefined, max_delivery_days: undefined })
    expect(uk(noDelivery)).toContain('Вкажіть перевізника й клас пошти або строк доставки')
    const half = checkProfileCreate({ ...profile, max_delivery_days: undefined })
    expect(uk(half)).toContain('Мін. і макс. днів доставки вказуються разом.')
    const carrier = checkProfileCreate({ ...profile, min_delivery_days: '', max_delivery_days: '', shipping_carrier_id: 2, mail_class: 'priority' })
    expect(carrier.problems).toEqual([])
    expect(en(checkProfileCreate({ ...profile, shipping_carrier_id: 2 }))).toContain('shipping_carrier_id and mail_class go together.')
    expect(uk(checkProfileCreate({ ...profile, min_delivery_days: 12 }))).toContain('Строк доставки: мінімум більший за максимум.')
    expect(uk(checkProfileCreate({ ...profile, min_processing_time: 5, max_processing_time: 2 }))).toContain('Час обробки')
  })

  it('updates: only given fields, nothing given = "Нічого не змінено."', () => {
    expect(checkProfileUpdate({ title: 'New' }).values).toEqual({ title: 'New' })
    expect(uk(checkProfileUpdate({}))).toBe('Нічого не змінено.')
    expect(en(checkUpgradeUpdate({ upgrade_name: '  ' }))).toBe('Nothing to change.')
    expect(checkDestinationUpdate({ primary_cost: 3 }).values).toEqual({ primary_cost: 3 })
    expect(uk(checkDestinationUpdate({ shipping_carrier_id: 3 }))).toContain('разом')
    expect(checkProcessingUpdate({ max_processing_time: 4 }).problems).toEqual([])
    expect(uk(checkProcessingUpdate({ min_processing_time: 5, max_processing_time: 4 }))).toContain('мінімум більший')
  })

  it('a profile update can clear the postal code with an explicit empty string; a create cannot send one', () => {
    expect(checkProfileUpdate({ origin_postal_code: '' })).toEqual({ values: { origin_postal_code: '' }, problems: [] })
    expect(checkProfileUpdate({ origin_postal_code: '  ' }).values).toEqual({ origin_postal_code: '' })
    expect(uk(checkProfileUpdate({ origin_postal_code: null }))).toBe('Нічого не змінено.')
    expect(uk(checkProfileUpdate({ title: '' }))).toBe('Нічого не змінено.')
    expect(checkProfileCreate({ ...profile, origin_postal_code: '' }).values).not.toHaveProperty('origin_postal_code')
  })

  it('destinations: neither country nor region = everywhere else (allowed)', () => {
    const c = checkDestinationCreate({ primary_cost: 2, secondary_cost: 1, min_delivery_days: 3, max_delivery_days: 7 })
    expect(c.problems).toEqual([])
    expect(uk(checkDestinationCreate({ primary_cost: 2, secondary_cost: 1, destination_region: 'eu', destination_country_iso: 'DE', min_delivery_days: 3, max_delivery_days: 7 }))).toContain('не обидва')
    const none = { primary_cost: 2, secondary_cost: 1, destination_region: 'none', min_delivery_days: 3, max_delivery_days: 7 }
    expect(checkDestinationCreate(none).problems).toEqual([])
    // Etsy answers 400 to a country together with any region, `none` included.
    expect(en(checkDestinationCreate({ ...none, destination_country_iso: 'DE' }))).toBe('Give destination_country_iso or destination_region, not both.')
    expect(en(checkDestinationUpdate({ destination_country_iso: 'DE', destination_region: 'none' }))).toContain('not both')
    expect(en(checkProfileCreate({ ...profile, destination_region: 'none' }))).toContain('not both')
  })

  it('upgrades: type 0/1 (also from a select string), name and prices required', () => {
    const c = checkUpgradeCreate({ type: '1', upgrade_name: 'Express', price: '10', secondary_price: '2', min_delivery_days: 1, max_delivery_days: 3 })
    expect(c.problems).toEqual([])
    expect(c.values.type).toBe(1)
    expect(en(checkUpgradeCreate({ type: 2, upgrade_name: 'x', price: 1, secondary_price: 1, min_delivery_days: 1, max_delivery_days: 3 }))).toContain('"type" must be one of: 0, 1.')
  })

  it('processing: readiness state enum, 1–10 days, unit days|weeks', () => {
    expect(checkProcessingCreate({ readiness_state: 'made_to_order', min_processing_time: 1, max_processing_time: 3, processing_time_unit: 'weeks' }).problems).toEqual([])
    const bad = checkProcessingCreate({ readiness_state: 'later', min_processing_time: 0, max_processing_time: 3, processing_time_unit: 'business_days' })
    expect(bad.problems).toHaveLength(3)
  })

  it('return policies: a deadline from the OAS list when returns or exchanges are accepted; none sent otherwise', () => {
    expect(checkReturnPolicy({ accepts_returns: true, accepts_exchanges: false, return_deadline: 30 }).problems).toEqual([])
    expect(uk(checkReturnPolicy({ accepts_returns: false, accepts_exchanges: true }))).toBe('Вкажіть строк повернення.')
    expect(uk(checkReturnPolicy({ accepts_returns: true, accepts_exchanges: true, return_deadline: 10 }))).toContain('одне з: 7, 14, 21, 30, 45, 60, 90')
    expect(checkReturnPolicy({ accepts_returns: false, accepts_exchanges: false, return_deadline: 30 }).values).toEqual({
      accepts_returns: false,
      accepts_exchanges: false
    })
    expect(uk(checkReturnPolicy({ accepts_returns: 'yes' }))).toContain('має бути так/ні')
  })

  it('sections: a title', () => {
    expect(checkSection({ title: ' Planners ' }).values).toEqual({ title: 'Planners' })
    expect(uk(checkSection({ title: ' ' }))).toBe('Заповніть «назва розділу».')
    expect(uk(checkSection({ title: 5 }))).toContain('має бути текстом')
  })
})

describe('shopConfig display helpers', () => {
  it('money, form value, days', () => {
    expect(moneyText({ amount: 550, divisor: 100, currency: 'USD' })).toMatch(/5,50\s*USD/)
    expect(moneyText({ amount: 5, divisor: 1, currency: '' })).toBe('5.00')
    expect(moneyText(null)).toBe('—')
    expect(moneyInput({ amount: 550, divisor: 100, currency: 'USD' })).toBe('5.5')
    expect(moneyInput(null)).toBe('')
    expect(daysText(1, 3)).toBe('1–3 дн.')
    expect(daysText(2, 2)).toBe('2 дн.')
    expect(daysText(null, null)).toBe('—')
  })

  it('the MCP tool list: unique names, Ukrainian text', () => {
    const names = SHOP_CONFIG_TOOL_SUMMARY.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const t of SHOP_CONFIG_TOOL_SUMMARY) expect(t.text).toMatch(/[а-яіїєґ]/i)
  })
})
