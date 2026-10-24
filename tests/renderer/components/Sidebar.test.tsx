// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Sidebar, itemsWord } from '../../../src/renderer/src/components/Sidebar'
import { GLOSSARY } from '../../../src/shared/glossary'
import { useStore } from '../../../src/renderer/src/store'
import { mkScan, mkShop, noKey, setupRenderer, withKey, type Api } from '../helpers'

let api: Api
const esc = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ keyStatus: withKey })
})

describe('Sidebar', () => {
  it('lists shops with active count and a badge for new items', () => {
    useStore.setState({
      shops: [
        mkShop({ id: 1, shopName: 'Alpha', activeCount: 12, lastOkScan: mkScan(), newCount: 3 }),
        mkShop({ id: 2, shopName: 'Beta' })
      ]
    })
    render(<Sidebar />)
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('12 товарів')).toBeInTheDocument()
    // The badge, the status and the tagline are explained by the row's tooltip (its
    // accessible description, read on keyboard focus too) — no native title.
    expect(screen.getByText('+3')).not.toHaveAttribute('title')
    expect(row('Alpha')).not.toHaveAttribute('title')
    expect(row('Alpha')).toHaveAccessibleDescription(esc(`Alpha. Handmade ceramics`))
    expect(row('Alpha')).toHaveAccessibleDescription(esc(`«+3»: ${GLOSSARY['shell.newBadge'].short}`))
    expect(screen.getByText('ще не скановано')).toBeInTheDocument()
    expect(row('Beta')).toHaveAccessibleDescription(`Beta. Handmade ceramics ${GLOSSARY['shell.notScanned'].short}`)
    // The list is a real list of buttons; the counts are explained by an ⓘ.
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Alpha/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Що таке «Ваші магазини»?' })).toHaveAccessibleDescription(
      GLOSSARY['shell.shopList'].short
    )
  })

  it('pluralises the item count and says how old the data is', () => {
    const now = Date.now()
    useStore.setState({
      shops: [
        mkShop({ id: 1, shopName: 'One', activeCount: 1, lastOkScan: mkScan({ finishedAt: now - 2 * 3600_000 }) }),
        mkShop({ id: 2, shopName: 'Few', activeCount: 3, lastOkScan: mkScan({ finishedAt: now - 9 * 3600_000 }) }),
        mkShop({ id: 3, shopName: 'Many', activeCount: 1246, lastOkScan: mkScan({ finishedAt: now }) })
      ]
    })
    render(<Sidebar />)
    expect(screen.getByText('1 товар')).toBeInTheDocument()
    expect(screen.getByText('3 товари')).toBeInTheDocument()
    expect(screen.getByText(/^1\s246 товарів$/)).toBeInTheDocument()
    expect(screen.getByText(/2 год тому/)).not.toHaveClass('is-stale')
    // Older than 6 hours: Etsy asks for fresh data — the age is highlighted, and the row says why.
    expect(screen.getByText(/9 год тому/)).toHaveClass('is-stale')
    expect(screen.getByText(/9 год тому/)).not.toHaveAttribute('title')
    expect(row('Few')).toHaveAccessibleDescription(esc(GLOSSARY['shell.staleData'].short))
    expect(row('One')).not.toHaveAccessibleDescription(esc(GLOSSARY['shell.staleData'].short))
  })

  it('itemsWord', () => {
    expect([0, 1, 2, 5, 11, 12, 21, 22, 25, 111, 112].map((n) => `${n} ${itemsWord(n)}`)).toEqual([
      '0 товарів',
      '1 товар',
      '2 товари',
      '5 товарів',
      '11 товарів',
      '12 товарів',
      '21 товар',
      '22 товари',
      '25 товарів',
      '111 товарів',
      '112 товарів'
    ])
  })

  it('marks the selected shop', () => {
    useStore.setState({ shops: [mkShop({ id: 1, shopName: 'Alpha' }), mkShop({ id: 2, shopName: 'Beta' })], activeShopId: 2 })
    render(<Sidebar />)
    expect(screen.getByRole('button', { name: /Beta/ })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('button', { name: /Alpha/ })).not.toHaveAttribute('aria-current')
  })

  it('without shops: a hint instead of the list', () => {
    render(<Sidebar />)
    expect(screen.queryByRole('list', { name: 'Магазини' })).toBeNull()
    expect(screen.getByText(/Тут з’являться магазини/)).toBeInTheDocument()
  })

  it('shows progress and a spinner while scanning', () => {
    useStore.setState({
      shops: [mkShop({ id: 1, newCount: 3 })],
      scanning: { 1: true },
      progress: { 1: { shopId: 1, phase: 'details', done: 100, total: 430, label: 'Деталі 100/430' } }
    })
    render(<Sidebar />)
    // Main's internal label is replaced by plain words.
    expect(screen.getByText('Читаю фото й деталі товарів: 100 з 430')).toBeInTheDocument()
    expect(screen.queryByText('Деталі 100/430')).toBeNull()
    expect(screen.getByLabelText('Сканування')).toBeInTheDocument()
    expect(screen.queryByText('+3')).toBeNull()
  })

  it('marks a shop whose last scan failed', () => {
    useStore.setState({ shops: [mkShop({ lastScan: mkScan({ status: 'error', error: 'x' }) })] })
    render(<Sidebar />)
    expect(screen.getByText('помилка сканування')).toBeInTheDocument()
    expect(row('CeramicStudioUA')).toHaveAccessibleDescription(esc(GLOSSARY['shell.scanFailed'].short))
  })

  it('the own shop is marked «мій», explained in the row tooltip', () => {
    useStore.setState({
      shops: [mkShop({ id: 7, shopName: 'Mine', lastOkScan: mkScan({ finishedAt: Date.now() }) })],
      etsyAuth: { loggedIn: true, shopId: 7 } as never
    })
    render(<Sidebar />)
    expect(screen.getByText('мій')).not.toHaveAttribute('title')
    expect(row('Mine')).toHaveAccessibleDescription(esc('Ваш власний магазин — ви увійшли в Etsy.'))
  })

  it('the Claude access (MCP) button explains itself in plain words, with its state', () => {
    useStore.setState({ mcpStatus: null })
    const { rerender } = render(<Sidebar />)
    const btn = () => screen.getByRole('button', { name: 'MCP-сервер для Claude' })
    expect(btn()).not.toHaveAttribute('title')
    expect(btn()).toHaveAccessibleDescription(`Доступ для Claude. ${GLOSSARY.mcp.short} Зараз вимкнено.`)
    act(() => useStore.setState({ mcpStatus: { enabled: true, running: true } as never }))
    rerender(<Sidebar />)
    expect(btn()).toHaveAccessibleDescription(/Зараз увімкнено і працює\.$/)
    act(() => useStore.setState({ mcpStatus: { enabled: true, running: false, error: 'busy' } as never }))
    rerender(<Sidebar />)
    expect(btn()).toHaveAccessibleDescription(/не вдалося запустити/)
  })

  it('the sidebar windows show an icon instead of the emoji, with a hint', () => {
    useStore.setState({ etsyAuth: null })
    render(<Sidebar />)
    const search = screen.getByRole('button', { name: 'Пошук по Etsy' })
    expect(search).toHaveTextContent('🔎 Пошук по Etsy')
    expect(search).toHaveAccessibleDescription(GLOSSARY['shell.marketSearch'].short)
    fireEvent.click(search)
    expect(useStore.getState().featureModal).toBe('market')
    const mine = screen.getByRole('button', { name: 'Мій магазин' })
    expect(mine).toHaveAccessibleDescription(GLOSSARY['shell.myShop'].short)
    fireEvent.click(mine)
    expect(useStore.getState().showMyShop).toBe(true)
  })

  it('Сканувати всі calls main; disabled without a key or shops', async () => {
    useStore.setState({ shops: [mkShop()] })
    const { rerender } = render(<Sidebar />)
    const scanAll = () => screen.getByRole('button', { name: /^(Сканувати всі|Сканування…)$/ })
    expect(screen.getByRole('button', { name: 'Що таке «Сканувати всі»?' })).toHaveAccessibleDescription(
      GLOSSARY['shell.scanAll'].short
    )
    await act(async () => {
      fireEvent.click(scanAll())
    })
    expect(api.scanAll).toHaveBeenCalled()
    act(() => {
      useStore.setState({ keyStatus: noKey, scanning: {}, shops: [mkShop()] })
    })
    rerender(<Sidebar />)
    expect(scanAll()).toBeDisabled()
    // Says why, and the settings gear gets a red dot.
    expect(screen.getByText(/Щоб сканувати, додайте ключ доступу/)).toBeInTheDocument()
    expect(screen.getByLabelText('Налаштування').querySelector('.dot-warn')).not.toBeNull()
  })

  it('while a scan runs, Сканувати всі is busy', () => {
    useStore.setState({ shops: [mkShop()], scanning: { 1: true } })
    render(<Sidebar />)
    const b = screen.getByRole('button', { name: 'Сканування…' })
    expect(b).toBeDisabled()
    expect(b).toHaveAttribute('aria-busy', 'true')
  })

  it('shows the remaining daily quota', () => {
    useStore.setState({
      quota: { limitPerDay: 10000, remainingToday: 9876, limitPerSecond: 10, remainingThisSecond: 9, at: 0 }
    })
    render(<Sidebar />)
    expect(screen.getByText(/Залишилось 9\s876 з 10\s000/)).toBeInTheDocument()
    const meter = screen.getByRole('meter', { name: 'Залишок запитів на сьогодні' })
    expect(meter).toHaveAttribute('aria-valuenow', '9876')
    expect(meter).not.toHaveClass('is-warn')
    expect(screen.getByRole('button', { name: 'Що таке «Денний ліміт запитів»?' })).toHaveAccessibleDescription(GLOSSARY.quota.short)
  })

  it('a nearly used-up quota turns the bar amber, then red; no limit = no bar', () => {
    useStore.setState({ quota: { limitPerDay: 10000, remainingToday: 1500, limitPerSecond: 10, remainingThisSecond: 9, at: 0 } })
    const { rerender } = render(<Sidebar />)
    expect(screen.getByRole('meter')).toHaveClass('is-warn')
    act(() => useStore.setState({ quota: { limitPerDay: 10000, remainingToday: 300, limitPerSecond: 10, remainingThisSecond: 9, at: 0 } }))
    rerender(<Sidebar />)
    expect(screen.getByRole('meter')).toHaveClass('is-low')
    act(() => useStore.setState({ quota: { limitPerDay: null, remainingToday: 300, limitPerSecond: null, remainingThisSecond: null, at: 0 } }))
    rerender(<Sidebar />)
    expect(screen.queryByRole('meter')).toBeNull()
    expect(screen.getByText('Залишилось 300')).toBeInTheDocument()
  })

  it('selecting a shop loads its data', async () => {
    useStore.setState({ shops: [mkShop({ id: 1 }), mkShop({ id: 2, shopName: 'Beta' })] })
    render(<Sidebar />)
    await act(async () => {
      fireEvent.click(screen.getByText('Beta'))
    })
    expect(useStore.getState().activeShopId).toBe(2)
    expect(api.listListings).toHaveBeenCalledWith(2)
  })

  it('opens settings and the add-shop dialog', () => {
    render(<Sidebar />)
    fireEvent.click(screen.getByLabelText('Налаштування'))
    expect(useStore.getState().showSettings).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Додати магазин' }))
    expect(useStore.getState().showAddShop).toBe(true)
  })
})
