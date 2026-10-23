// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import type { Quota, ScanProgress, ShopSummary } from '../../../src/shared/types'
import { App } from '../../../src/renderer/src/App'
import { useStore } from '../../../src/renderer/src/store'
import { mkScan, mkShop, noKey, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

describe('App empty states', () => {
  it('first run without a key: explains how to get one and opens Settings', async () => {
    api.getKeyStatus.mockResolvedValue(noKey)
    render(<App />)
    expect(await screen.findByTestId('no-key')).toBeInTheDocument()
    expect(screen.getByText(/Почнімо з API-ключа Etsy/)).toBeInTheDocument()
    expect(screen.getAllByText(/Keystring/).length).toBeGreaterThan(0)
    expect(screen.getByText('etsy.com/developers/register')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Відкрити налаштування'))
    expect(useStore.getState().showSettings).toBe(true)
    expect(screen.getByRole('heading', { name: 'Налаштування' })).toBeInTheDocument()
  })

  it('with a key but no shops: prompts to add the first shop', async () => {
    render(<App />)
    expect(await screen.findByTestId('no-shops')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('+ Додати магазин')[1])
    expect(screen.getByRole('heading', { name: 'Додати магазин' })).toBeInTheDocument()
  })

  it('with shops: opens the first shop and shows the Etsy notice', async () => {
    api.listShops.mockResolvedValue([mkShop({ lastOkScan: mkScan({ isBaseline: true }) })])
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: /CeramicStudioUA/ })).toBeInTheDocument()
    expect(api.listListings).toHaveBeenCalledWith(1)
    expect(screen.getByText(/not endorsed or certified by Etsy/)).toBeInTheDocument()
  })

  it('without a key but with stored shops: still shows them, with a warning', async () => {
    api.getKeyStatus.mockResolvedValue(noKey)
    api.listShops.mockResolvedValue([mkShop()])
    render(<App />)
    expect(await screen.findByText(/API-ключ Etsy не задано/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сканувати' })).toBeDisabled()
  })

  it('remembers the selected shop across launches', async () => {
    localStorage.setItem('etsyTracker.ui', JSON.stringify({ activeShopId: 2 }))
    api.listShops.mockResolvedValue([mkShop(), mkShop({ id: 2, shopName: 'SecondShop' })])
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: /SecondShop/ })).toBeInTheDocument()
  })

  it('main-process events update the UI (shops, scan state, progress, quota)', async () => {
    render(<App />)
    await screen.findByTestId('no-shops')
    // The callbacks App registered with the preload subscriptions.
    const pushShops = api.onShopsChanged.mock.calls[0][0] as (s: ShopSummary[]) => void
    const pushState = api.onScanState.mock.calls[0][0] as (s: { shopId: number; running: boolean }) => void
    const pushProgress = api.onScanProgress.mock.calls[0][0] as (p: ScanProgress) => void
    const pushQuota = api.onQuota.mock.calls[0][0] as (q: Quota) => void

    await act(async () => pushShops([mkShop({ shopName: 'PushedShop', lastOkScan: mkScan() })]))
    expect(await screen.findByRole('heading', { level: 1, name: /PushedShop/ })).toBeInTheDocument()

    act(() => pushState({ shopId: 1, running: true }))
    expect(screen.getAllByLabelText('Сканування').length).toBeGreaterThan(0)
    act(() => pushProgress({ shopId: 1, phase: 'pages', done: 2, total: 5, label: 'Сторінка 2/5' }))
    expect(screen.getAllByText('Сторінка 2/5').length).toBeGreaterThan(0)
    act(() => pushState({ shopId: 1, running: false }))
    expect(screen.queryByLabelText('Сканування')).toBeNull()
    expect(screen.queryByText('Сторінка 2/5')).toBeNull()

    act(() => pushQuota({ limitPerDay: 10000, remainingToday: 4321, limitPerSecond: 10, remainingThisSecond: 9, at: 0 }))
    expect(screen.getByText(/Запитів сьогодні: 4\s321 \/ 10\s000/)).toBeInTheDocument()
  })

  it('unsubscribes from main-process events on unmount', async () => {
    const offs = [vi.fn(), vi.fn(), vi.fn(), vi.fn()]
    api.onShopsChanged.mockReturnValue(offs[0])
    api.onScanProgress.mockReturnValue(offs[1])
    api.onScanState.mockReturnValue(offs[2])
    api.onQuota.mockReturnValue(offs[3])
    const { unmount } = render(<App />)
    await screen.findByTestId('no-shops')
    unmount()
    for (const off of offs) expect(off).toHaveBeenCalled()
  })
})

describe('App: Etsy sign-in pushes', () => {
  it('etsyAuth:changed from main updates the store (e.g. a refresh that signed out)', async () => {
    render(<App />)
    await screen.findByTestId('no-shops')
    const push = api.onEtsyAuth.mock.calls[0][0] as (s: unknown) => void
    act(() => push({ loggedIn: false, redirectUri: 'https://localhost:3003/callback', pending: false, encrypted: false }))
    expect(useStore.getState().etsyAuth).toMatchObject({ loggedIn: false })
  })
})
