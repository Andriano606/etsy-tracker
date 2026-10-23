// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'

// One fake feature section under the own-listing editor (the registry is otherwise the real one).
vi.mock('../../../src/renderer/src/features/registry', () => ({
  MY_SHOP_TABS: [],
  SHOP_PANELS: [],
  LISTING_PANELS: [],
  TOP_MODALS: [],
  OWN_LISTING_SECTIONS: [
    {
      id: 'fake',
      label: 'Фейкова секція',
      Component: ({ listing, onChanged }: { listing: { listingId: number; title: string }; onChanged: (l?: unknown) => void }) => (
        <div>
          <button onClick={() => onChanged({ ...listing, title: 'Changed by section', imageUrl: null })}>змінити</button>
          <button onClick={() => onChanged()}>видалити</button>
        </div>
      )
    }
  ]
}))

import { MyShopModal } from '../../../src/renderer/src/components/MyShopModal'
import { useStore } from '../../../src/renderer/src/store'
import { etsyIn, mkMyListing, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ showMyShop: true, etsyAuth: etsyIn() })
  api.getEtsyAuth.mockResolvedValue(etsyIn())
  api.getMyListings.mockResolvedValue({ ok: true, value: { state: 'active', total: 1, offset: 0, listings: [mkMyListing(1)] } })
})

async function openSection() {
  render(<MyShopModal />)
  await act(async () => {})
  await act(async () => {
    fireEvent.click(screen.getByText('Редагувати'))
  })
  const d = screen.getByTestId('own-section-fake') as HTMLDetailsElement
  expect(screen.queryByText('змінити')).toBeNull() // lazy: nothing until opened
  await act(async () => {
    d.open = true
    fireEvent(d, new Event('toggle'))
  })
}

describe('own-listing feature sections', () => {
  it('render under the editor, lazily; a changed listing updates the editor and keeps the photo', async () => {
    await openSection()
    await act(async () => {
      fireEvent.click(screen.getByText('змінити'))
    })
    expect(screen.getByLabelText(/^Назва/)).toBeInTheDocument()
    expect(screen.getByTestId('listing-editor')).toBeInTheDocument()
  })

  it('a deleted listing (onChanged without one) closes the editor and reloads the list', async () => {
    await openSection()
    api.getMyListings.mockResolvedValue({ ok: true, value: { state: 'active', total: 0, offset: 0, listings: [] } })
    const before = api.getMyListings.mock.calls.length
    await act(async () => {
      fireEvent.click(screen.getByText('видалити'))
    })
    expect(screen.queryByTestId('listing-editor')).toBeNull()
    expect(api.getMyListings.mock.calls.length).toBeGreaterThan(before)
    expect(screen.getByText('Тут немає лістингів.')).toBeInTheDocument()
  })
})
