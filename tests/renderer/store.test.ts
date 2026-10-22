// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { waitFor } from '@testing-library/react'
import { useStore } from '../../src/renderer/src/store'
import type { ScanOutcome } from '../../src/shared/types'
import { mkChange, mkListing, mkScan, mkShop, setupRenderer, type Api } from './helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

describe('store', () => {
  it('load() picks the first shop and fetches its listings, scans and last changes', async () => {
    const shop = mkShop({ lastOkScan: mkScan({ id: 5 }) })
    api.listShops.mockResolvedValue([shop])
    api.listListings.mockResolvedValue([mkListing(1)])
    api.getScanChanges.mockResolvedValue([mkChange(1, 'added', mkListing(1))])
    await useStore.getState().load()
    const s = useStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.activeShopId).toBe(1)
    expect(s.listings).toHaveLength(1)
    expect(api.getScanChanges).toHaveBeenCalledWith(5)
    expect(s.lastChanges).toHaveLength(1)
  })

  it('setShops reloads the open shop when its latest scan changed', async () => {
    useStore.setState({ shops: [mkShop({ lastOkScan: mkScan({ id: 1 }) })], activeShopId: 1 })
    useStore.getState().setShops([mkShop({ lastOkScan: mkScan({ id: 2 }), lastScan: mkScan({ id: 2 }) })])
    await waitFor(() => expect(api.getScanChanges).toHaveBeenCalledWith(2))
  })

  it('setShops moves the selection when the open shop disappears', async () => {
    useStore.setState({ shops: [mkShop({ id: 1 }), mkShop({ id: 2 })], activeShopId: 1 })
    useStore.getState().setShops([mkShop({ id: 2 })])
    await waitFor(() => expect(useStore.getState().activeShopId).toBe(2))
  })

  it('scanAll shows the error when every shop failed (e.g. a bad key)', async () => {
    useStore.setState({ shops: [mkShop()] })
    api.scanAll.mockResolvedValue([{ ok: false, shopId: 1, error: 'Etsy відхилив API-ключ' }])
    await useStore.getState().scanAll()
    expect(useStore.getState().error).toMatch(/API-ключ/)
    expect(useStore.getState().scanning).toEqual({ 1: false })
  })

  it('scanAll finishing leaves a shop that is being rescanned on its own alone', async () => {
    useStore.setState({ shops: [mkShop({ id: 1 }), mkShop({ id: 2 })], activeShopId: 1 })
    let finishAll!: (v: ScanOutcome[]) => void
    let finishOne!: (v: ScanOutcome) => void
    api.scanAll.mockReturnValue(new Promise((r) => (finishAll = r)))
    api.scanShop.mockReturnValue(new Promise((r) => (finishOne = r)))
    const all = useStore.getState().scanAll()
    // Main reported shop 1 done; the user rescans it while scanAll is on shop 2.
    useStore.getState().setScanning(1, false)
    const one = useStore.getState().scanShop(1)
    useStore.getState().setProgress({ shopId: 1, phase: 'pages', done: 1, total: 2, label: 'Сторінка 1/2' })
    finishAll([])
    await all
    expect(useStore.getState().scanning).toEqual({ 1: true, 2: false })
    expect(useStore.getState().progress[1]?.label).toBe('Сторінка 1/2')
    finishOne({ ok: true, shopId: 1, scan: mkScan() })
    await one
    expect(useStore.getState().scanning).toEqual({ 1: false, 2: false })
  })

  it('scanShop surfaces a busy refusal', async () => {
    useStore.setState({ shops: [mkShop()], activeShopId: 1 })
    api.scanShop.mockResolvedValue({ ok: false, shopId: 1, busy: true, error: 'Цей магазин уже сканується.' })
    await useStore.getState().scanShop(1)
    expect(useStore.getState().error).toMatch(/уже сканується/)
  })

  it('removeShop reports a refusal from main', async () => {
    useStore.setState({ shops: [mkShop()], activeShopId: 1 })
    api.removeShop.mockResolvedValue({ ok: false, error: 'Зачекайте' } as never)
    const p = useStore.getState().removeShop(1)
    useStore.getState().resolveConfirm(true)
    await p
    expect(useStore.getState().error).toBe('Зачекайте')
    expect(useStore.getState().shops).toHaveLength(1)
  })
})
