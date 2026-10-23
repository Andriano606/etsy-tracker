// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

// Fake registry entries: one per host kind (the real features test their own components).
vi.mock('../../../src/renderer/src/features/registry', () => ({
  MY_SHOP_TABS: [],
  OWN_LISTING_SECTIONS: [],
  SHOP_PANELS: [
    { id: 'p1', label: 'Панель магазину', Component: ({ shop, mine }: { shop: { shopName: string }; mine: boolean }) => <div>панель {shop.shopName} {mine ? 'мій' : 'чужий'}</div> }
  ],
  LISTING_PANELS: [
    { id: 'l1', label: 'Панель товару', Component: ({ listing, mine }: { listing: { title: string }; mine: boolean }) => <div>товар {listing.title} {mine ? 'мій' : 'чужий'}</div> }
  ],
  TOP_MODALS: [{ id: 'm1', button: '🔎 Тестове вікно', title: 'Тестове вікно', Component: () => <div>вміст вікна</div> }]
}))

import { FeatureModalHost, ShopPanelsModal } from '../../../src/renderer/src/features/hosts'
import { ShopView } from '../../../src/renderer/src/components/ShopView'
import { Sidebar } from '../../../src/renderer/src/components/Sidebar'
import { ListingModal } from '../../../src/renderer/src/components/ListingModal'
import { useStore } from '../../../src/renderer/src/store'
import { etsyIn, mkListing, mkScan, mkShop, setupRenderer, withKey } from '../helpers'

const OWN = 68736507

beforeEach(() => {
  setupRenderer()
  useStore.setState({
    keyStatus: withKey,
    etsyAuth: etsyIn(),
    shops: [mkShop({ id: 1, shopName: 'Other', lastOkScan: mkScan() }), mkShop({ id: OWN, shopName: 'TidyFoxSheets', lastOkScan: mkScan({ shopId: OWN }) })],
    activeShopId: 1
  })
})

function open(details: HTMLElement) {
  const d = details as HTMLDetailsElement
  d.open = true
  fireEvent(d, new Event('toggle'))
}

describe('feature hosts', () => {
  it('"ℹ️ Більше" opens the shop panels window; a panel mounts only when opened; Escape closes', async () => {
    render(
      <>
        <ShopView />
        <ShopPanelsModal />
      </>
    )
    await act(async () => {
      fireEvent.click(screen.getByText('ℹ️ Більше'))
    })
    expect(screen.getByRole('dialog', { name: 'Other: більше даних з Etsy' })).toBeInTheDocument()
    expect(screen.queryByText(/панель Other/)).toBeNull()
    await act(async () => open(screen.getByTestId('shop-panel-p1')))
    expect(screen.getByText('панель Other чужий')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the own shop’s panels get mine = true', async () => {
    useStore.setState({ shopPanelsFor: OWN })
    render(<ShopPanelsModal />)
    await act(async () => open(screen.getByTestId('shop-panel-p1')))
    expect(screen.getByText('панель TidyFoxSheets мій')).toBeInTheDocument()
  })

  it('a sidebar button opens its window', async () => {
    render(
      <>
        <Sidebar />
        <FeatureModalHost />
      </>
    )
    await act(async () => {
      fireEvent.click(screen.getByText('🔎 Тестове вікно'))
    })
    expect(screen.getByRole('dialog', { name: 'Тестове вікно' })).toHaveTextContent('вміст вікна')
    fireEvent.click(screen.getByText('Закрити'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('listing panels render at the bottom of the listing window, lazily, with mine for the own shop', async () => {
    useStore.setState({ detailListing: mkListing(5, { shopId: OWN, title: 'Planner' }) })
    render(<ListingModal />)
    expect(screen.queryByText(/товар Planner/)).toBeNull()
    await act(async () => open(screen.getByTestId('listing-panel-l1')))
    expect(screen.getByText('товар Planner мій')).toBeInTheDocument()
  })

  it('nothing opens for an unknown shop or window id', () => {
    useStore.setState({ shopPanelsFor: 999, featureModal: 'nope' })
    render(
      <>
        <ShopPanelsModal />
        <FeatureModalHost />
      </>
    )
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
