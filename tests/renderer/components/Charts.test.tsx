// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Legend, LineChart, Sparkline, StackedBarChart, lineScale, tipLeft } from '../../../src/renderer/src/components/Charts'
import { GLOSSARY } from '../../../src/shared/glossary'

const H = 3_600_000

describe('Charts', () => {
  it('tipLeft keeps a tooltip of any width inside the chart', () => {
    // Room on the right: just right of the crosshair.
    expect(tipLeft(100, 260, 640)).toBe(110)
    // A 260px box 200px from the right edge (the old fixed 170px flip let it overflow): flipped left.
    expect(tipLeft(440, 260, 640)).toBe(170)
    expect(tipLeft(440, 260, 640) + 260).toBeLessThanOrEqual(640)
    // Too wide for either side: clamped to the chart.
    expect(tipLeft(200, 500, 640)).toBe(0)
    expect(tipLeft(10, 700, 640)).toBe(0)
  })

  it('Sparkline places points by time when times are given', () => {
    const pts = (el: Element) =>
      el
        .querySelector('polyline')!
        .getAttribute('points')!
        .split(' ')
        .map((p) => Number(p.split(',')[0]))
    // 10 minutes, then 5 days: the middle point sits near the start, not halfway.
    const { container } = render(<Sparkline values={[1, 2, 3]} times={[0, 10 * 60_000, 5 * 24 * H]} />)
    const [a, b, c] = pts(container)
    expect(b - a).toBeLessThan((c - a) * 0.05)
    // Without times: evenly spaced (equal time slices).
    const even = render(<Sparkline values={[1, 2, 3]} />)
    const [x, y, z] = pts(even.container)
    expect(y - x).toBeCloseTo(z - y, 5)
  })

  it('the changes stack: one column width for every scan, and every scan marked on the axis', () => {
    const t0 = Date.UTC(2026, 9, 1)
    const stacks = [0, 9_000, 2 * 24 * H, 4 * 24 * H, 6 * 24 * H].map((dt, i) => ({
      t: t0 + dt,
      values: i === 1 ? [0, 0, 0, 0] : [i + 1, 0, 1, 0],
      marker: i === 0,
      tip: null
    }))
    const { container } = render(
      <StackedBarChart
        label="Зміни"
        series={['a', 'r', 'c', 'x'].map((k) => ({ key: k, label: k, className: `c-${k}` }))}
        stacks={stacks}
        domain={[t0 - H, t0 + 6 * 24 * H + H]}
      />
    )
    const widths = new Set(
      [...container.querySelectorAll('path.seg')].map((p) => {
        const d = p.getAttribute('d')!
        const xs = [
          ...[...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[1])),
          ...[...d.matchAll(/H(-?[\d.]+)/g)].map((m) => Number(m[1]))
        ]
        return Math.round(Math.max(...xs) - Math.min(...xs))
      })
    )
    expect(widths.size).toBe(1)
    expect([...widths][0]).toBeGreaterThanOrEqual(4)
    // 1 baseline ring + 4 scan ticks (the one without changes included).
    expect(container.querySelectorAll('circle.marker')).toHaveLength(1)
    expect(container.querySelectorAll('circle.scan-tick')).toHaveLength(4)
  })

  it('a legend item can explain its series with an ⓘ; the colour key is decorative', () => {
    const { container } = render(
      <Legend
        items={[
          { label: 'Нові', className: 'c-added', glossary: 'listingNew' },
          { label: 'сканування', className: 'c-scan', kind: 'dot' }
        ]}
      />
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Що таке «Новий товар»?' })).toHaveAccessibleDescription(GLOSSARY.listingNew.short)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(container.querySelectorAll('.key[aria-hidden="true"]')).toHaveLength(2)
    expect(container.querySelector('.key.dot.c-scan')).not.toBeNull()
  })

  it('a flat non-negative line (no sales: all 0) gets no negative tick', () => {
    expect(lineScale([0, 0, 0], { integer: true })).toEqual({ min: 0, max: 1, ticks: [0, 1] })
    // Any other flat value stays centred; a series with negatives is left alone.
    expect(lineScale([3, 3], { integer: true }).ticks).toEqual([2, 3, 4])
    expect(lineScale([-2, -2], { integer: true }).min).toBeLessThan(-2)
    const { container } = render(
      <LineChart
        label="Продано"
        points={[0, 1, 2].map((i) => ({ t: i * H, v: 0 }))}
        domain={[0, 2 * H]}
        format={String}
        dateText={String}
      />
    )
    const labels = [...container.querySelectorAll('text.tick.y')].map((t) => t.textContent)
    expect(labels).toContain('0')
    expect(labels.some((l) => /[-−]/.test(l ?? ''))).toBe(false)
  })

  it('compact: a strip of scan marks without a y axis or grid', () => {
    const series = [{ key: 'a', label: 'Нові', className: 'c-added' }]
    const { container } = render(
      <StackedBarChart
        label="Зміни"
        series={series}
        compact
        domain={[0, 4 * H]}
        stacks={[0, 2, 4].map((i) => ({ t: i * H, values: [0], marker: i === 0, tip: 'x' }))}
      />
    )
    const chart = screen.getByRole('group', { name: 'Зміни' })
    expect(chart).toHaveClass('compact')
    expect(container.querySelectorAll('text.tick.y')).toHaveLength(0)
    expect(container.querySelectorAll('line.grid')).toHaveLength(0)
    expect(container.querySelectorAll('circle.marker')).toHaveLength(1)
    expect(container.querySelectorAll('circle.scan-tick')).toHaveLength(2)
    expect(Number(container.querySelector('svg')!.getAttribute('height'))).toBeLessThan(60)
  })
})
