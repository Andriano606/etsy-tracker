import { describe, expect, it } from 'vitest'
import {
  ORDERS_TOOL_SUMMARY,
  addByCurrency,
  addMoney,
  localDate,
  localDaySec,
  moneyValue,
  orderStatusLabel
} from '../../../src/shared/features/orders'

describe('orders shared helpers', () => {
  it('addMoney adds exactly, also across divisors', () => {
    expect(addMoney({ amount: 250, divisor: 100, currency: 'USD' }, { amount: 125, divisor: 100, currency: 'USD' })).toEqual({
      amount: 375,
      divisor: 100,
      currency: 'USD'
    })
    expect(addMoney({ amount: 25, divisor: 10, currency: 'USD' }, { amount: 125, divisor: 100, currency: 'USD' })).toEqual({
      amount: 375,
      divisor: 100,
      currency: 'USD'
    })
    expect(addMoney({ amount: 1, divisor: 4, currency: 'X' }, { amount: 1, divisor: 6, currency: 'X' })).toEqual({ amount: 5, divisor: 12, currency: 'X' })
  })

  it('addByCurrency keeps one entry per currency, first seen first, without mutating', () => {
    const start = [{ amount: 100, divisor: 100, currency: 'USD' }]
    const a = addByCurrency(start, { amount: 50, divisor: 100, currency: 'EUR' })
    const b = addByCurrency(a, { amount: 30, divisor: 100, currency: 'USD' })
    expect(b).toEqual([
      { amount: 130, divisor: 100, currency: 'USD' },
      { amount: 50, divisor: 100, currency: 'EUR' }
    ])
    expect(start[0].amount).toBe(100)
  })

  it('moneyValue is the decimal value', () => {
    expect(moneyValue({ amount: 1999, divisor: 100, currency: 'USD' })).toBe(19.99)
    expect(moneyValue({ amount: 5, divisor: 0, currency: 'JPY' })).toBe(5)
  })

  it('localDaySec: local day start / last second; invalid → null; localDate round-trips', () => {
    const start = localDaySec('2026-10-01')!
    expect(new Date(start * 1000).getHours()).toBe(0)
    expect(localDate(start * 1000)).toBe('2026-10-01')
    const end = localDaySec('2026-10-01', true)!
    expect(localDate(end * 1000)).toBe('2026-10-01')
    expect(localDate((end + 1) * 1000)).toBe('2026-10-02')
    expect(localDaySec('01.10.2026')).toBeNull()
    expect(localDaySec('')).toBeNull()
  })

  it('status labels: known statuses in Ukrainian, unknown as is', () => {
    expect(orderStatusLabel('paid')).toBe('оплачено')
    expect(orderStatusLabel('Payment Processing')).toBe('оплата обробляється')
    expect(orderStatusLabel('fully refunded')).toBe('повністю повернуто')
    expect(orderStatusLabel('weird')).toBe('weird')
  })

  it('the tool summary: unique names, Ukrainian, the two writes flagged', () => {
    const names = ORDERS_TOOL_SUMMARY.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(ORDERS_TOOL_SUMMARY.filter((t) => t.write).map((t) => t.name)).toEqual(['mark_my_order_shipped', 'update_my_order'])
    for (const t of ORDERS_TOOL_SUMMARY) expect(t.text).toMatch(/[а-яіїє]/i)
  })
})
