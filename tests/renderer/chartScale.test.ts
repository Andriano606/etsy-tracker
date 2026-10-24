import { describe, expect, it } from 'vitest'
import {
  axisLabels,
  fullDate,
  nearestIndex,
  niceTicks,
  shortDate,
  timeDomain,
  timeTicks,
  yScaleDomain
} from '../../src/renderer/src/chartScale'

const H = 3_600_000
const D = 24 * H

describe('chartScale', () => {
  it('niceTicks: round steps, integer steps when asked', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100])
    expect(niceTicks(56, 58, 4)).toEqual([56, 56.5, 57, 57.5, 58])
    expect(niceTicks(56, 58, 4, 1)).toEqual([56, 57, 58])
    expect(niceTicks(5, 5)).toEqual([5])
  })

  it('yScaleDomain: bars include 0; a flat line sits mid-plot', () => {
    expect(yScaleDomain([3, 7], { zero: true })).toMatchObject({ min: 0 })
    const flat = yScaleDomain([7100, 7100, null])
    expect(flat.min).toBeLessThan(7100)
    expect(flat.max).toBeGreaterThan(7100)
    expect(yScaleDomain([])).toEqual({ min: 0, max: 1, ticks: [0, 1] })
    expect(yScaleDomain([4.75], { minSpan: 0.2 }).ticks.length).toBeGreaterThan(1)
  })

  it('yScaleDomain: a line fits its data, so a small real change is visible on a big value', () => {
    // 110 700 → 110 835 (+135): the old 2 % floor made a 109k–112k axis and a flat-looking line.
    const d = yScaleDomain([110_700, 110_835], { integer: true })
    expect((110_835 - 110_700) / (d.max - d.min)).toBeGreaterThan(0.5)
    expect(d.min).toBeLessThan(110_700)
    expect(d.max).toBeGreaterThan(110_835)
    // Never below 0 for a non-negative series.
    expect(yScaleDomain([0, 10]).min).toBe(0)
    // An explicit minSpan is still a floor (a rating moving 4,80 → 4,81).
    const r = yScaleDomain([4.8, 4.81], { minSpan: 0.2 })
    expect(r.max - r.min).toBeGreaterThanOrEqual(0.2)
    // A rating axis never goes past 5, margin or not.
    const rating = yScaleDomain([4.38, 5], { minSpan: 0.5, ceil: 5 })
    expect(rating.max).toBe(5)
    expect(Math.max(...rating.ticks)).toBeCloseTo(5, 9)
    expect(yScaleDomain([5, 5], { minSpan: 0.5, ceil: 5 }).max).toBe(5)
  })

  it('axisLabels: one format per axis, never a repeated label', () => {
    const nb = (xs: string[]) => xs.map((s) => s.replace(/\s/g, ' '))
    expect(nb(axisLabels([2_540_000, 2_560_000, 2_580_000, 2_600_000]))).toEqual(['2,54 млн', '2,56 млн', '2,58 млн', '2,60 млн'])
    expect(nb(axisLabels([58_000, 58_500, 59_000, 59_500]))).toEqual(['58,0 тис.', '58,5 тис.', '59,0 тис.', '59,5 тис.'])
    expect(nb(axisLabels([0, 200_000, 400_000]))).toEqual(['0', '200 тис.', '400 тис.'])
    expect(nb(axisLabels([0, 5_000, 10_000, 15_000]))).toEqual(['0', '5 тис.', '10 тис.', '15 тис.'])
    expect(axisLabels([4.2, 4.4, 4.6, 4.8, 5])).toEqual(['4,2', '4,4', '4,6', '4,8', '5,0'])
    expect(axisLabels([4.65, 4.7, 4.75, 4.8, 4.85])).toEqual(['4,65', '4,70', '4,75', '4,80', '4,85'])
    expect(nb(axisLabels([9_000, 9_500, 10_000]))).toEqual(['9,0 тис.', '9,5 тис.', '10,0 тис.'])
    expect(nb(axisLabels([1_000, 2_000, 3_000]))).toEqual(['1 000', '2 000', '3 000'])
    // Below a million, 2 compact decimals read worse than the number itself.
    expect(nb(axisLabels([110_650, 110_700, 110_750]))).toEqual(['110 650', '110 700', '110 750'])
    for (const t of [[4.7, 4.75, 4.8], [1_000_000, 1_000_001, 1_000_002]]) expect(new Set(axisLabels(t)).size).toBe(t.length)
  })

  it('timeDomain pads; one time gets ±1 h', () => {
    const [a, b] = timeDomain([1000 * H])
    expect(b - a).toBeGreaterThanOrEqual(2 * H)
    expect(timeDomain([0, 10 * D])[0]).toBeLessThan(0)
  })

  it('timeTicks: hours, days, weeks (Mondays), months — in UTC when asked', () => {
    const t0 = Date.UTC(2026, 9, 22, 22, 30)
    const hours = timeTicks(t0, t0 + 3 * H, 6, true)
    expect(hours[0].label).toBe('22.10 23:00')
    expect(hours[1].label).toBe('23.10 00:00')
    expect(hours[2].label).toBe('01:00')
    const days = timeTicks(Date.UTC(2026, 9, 1), Date.UTC(2026, 9, 6), 6, true)
    expect(days.map((t) => t.label)).toEqual(['01.10', '02.10', '03.10', '04.10', '05.10', '06.10'])
    const weeks = timeTicks(Date.UTC(2026, 6, 1), Date.UTC(2026, 9, 1), 8, true)
    expect(weeks.every((t) => new Date(t.t).getUTCDay() === 1)).toBe(true)
    const months = timeTicks(Date.UTC(2023, 0, 1), Date.UTC(2026, 9, 1), 8, true)
    expect(months[0].label).toBe('01.2023')
    expect(months.every((t) => new Date(t.t).getUTCDate() === 1)).toBe(true)
    expect(timeTicks(5, 5, 4)).toEqual([])
  })

  it('timeTicks: a ~4-month axis in a half-width card still gets monthly ticks, not 2', () => {
    const ticks = timeTicks(Date.UTC(2026, 5, 21), Date.UTC(2026, 9, 23), 4, true)
    expect(ticks.map((t) => t.label)).toEqual(['07.2026', '08.2026', '09.2026', '10.2026'])
    // ~7 months over 4 ticks: every 2 months.
    expect(timeTicks(Date.UTC(2026, 0, 10), Date.UTC(2026, 7, 10), 4, true).map((t) => t.label)).toEqual([
      '03.2026',
      '05.2026',
      '07.2026'
    ])
  })

  it('dates: dd.MM and dd.MM.yyyy', () => {
    const t = Date.UTC(2026, 0, 5, 23)
    expect(shortDate(t, true)).toBe('05.01')
    expect(fullDate(t, true)).toBe('05.01.2026')
  })

  it('nearestIndex', () => {
    expect(nearestIndex([], 3)).toBe(-1)
    expect(nearestIndex([0, 10, 20], 4)).toBe(0)
    expect(nearestIndex([0, 10, 20], 6)).toBe(1)
    expect(nearestIndex([0, 10, 20], 99)).toBe(2)
  })
})

describe('yScaleDomain: a flat non-negative series near zero', () => {
  it('never goes below 0 (all zeros → 0…1)', () => {
    const d = yScaleDomain([0, 0, 0], { integer: true })
    expect(d.min).toBe(0)
    expect(d.ticks[0]).toBe(0)
    expect(d.ticks).not.toContain(-1)
    const small = yScaleDomain([0.2, 0.2])
    expect(small.min).toBeGreaterThanOrEqual(0)
  })
})
