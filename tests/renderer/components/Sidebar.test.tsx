// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Sidebar } from '../../../src/renderer/src/components/Sidebar'
import { useStore } from '../../../src/renderer/src/store'
import { mkScan, mkShop, noKey, setupRenderer, withKey, type Api } from '../helpers'

let api: Api
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
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText('ще не скановано')).toBeInTheDocument()
  })

  it('shows progress and a spinner while scanning', () => {
    useStore.setState({
      shops: [mkShop({ id: 1, newCount: 3 })],
      scanning: { 1: true },
      progress: { 1: { shopId: 1, phase: 'details', done: 100, total: 430, label: 'Деталі 100/430' } }
    })
    render(<Sidebar />)
    expect(screen.getByText('Деталі 100/430')).toBeInTheDocument()
    expect(screen.getByLabelText('Сканування')).toBeInTheDocument()
    expect(screen.queryByText('+3')).toBeNull()
  })

  it('marks a shop whose last scan failed', () => {
    useStore.setState({ shops: [mkShop({ lastScan: mkScan({ status: 'error', error: 'x' }) })] })
    render(<Sidebar />)
    expect(screen.getByText('помилка сканування')).toBeInTheDocument()
  })

  it('Сканувати всі calls main; disabled without a key or shops', async () => {
    useStore.setState({ shops: [mkShop()] })
    const { rerender } = render(<Sidebar />)
    await act(async () => {
      fireEvent.click(screen.getByText('Сканувати всі'))
    })
    expect(api.scanAll).toHaveBeenCalled()
    act(() => {
      useStore.setState({ keyStatus: noKey, scanning: {} })
    })
    rerender(<Sidebar />)
    expect(screen.getByText('Сканувати всі')).toBeDisabled()
  })

  it('shows the remaining daily quota', () => {
    useStore.setState({
      quota: { limitPerDay: 10000, remainingToday: 9876, limitPerSecond: 10, remainingThisSecond: 9, at: 0 }
    })
    render(<Sidebar />)
    expect(screen.getByText(/Запитів сьогодні: 9\s876 \/ 10\s000/)).toBeInTheDocument()
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
    fireEvent.click(screen.getByText('+ Додати магазин'))
    expect(useStore.getState().showAddShop).toBe(true)
  })
})
