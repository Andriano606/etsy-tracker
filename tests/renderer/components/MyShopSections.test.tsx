// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'

// One fake feature section under the own-listing editor (the registry is otherwise the real one).
vi.mock('../../../src/renderer/src/features/registry', () => ({
  MY_SHOP_TABS: [],
  SHOP_PANELS: [],
  LISTING_PANELS: [],
  TOP_MODALS: [],
  OWN_LISTING_SECTIONS: [
    // Registry order on purpose: deleting first, a feature's own description, an unknown section.
    { id: 'danger', label: 'Небезпечна зона', Component: () => <div>danger body</div> },
    {
      id: 'fake',
      label: 'Фейкова секція',
      Component: ({ listing, onChanged }: { listing: { listingId: number; title: string }; onChanged: (l?: unknown) => void }) => (
        <div>
          <button onClick={() => onChanged({ ...listing, title: 'Changed by section', imageUrl: null })}>змінити</button>
          <button onClick={() => onChanged()}>видалити</button>
        </div>
      )
    },
    Object.assign({ id: 'orders-sales', label: 'Продажі', Component: () => <div>sales body</div> }, { description: 'Опис від самої функції.' }),
    { id: 'inventory', label: 'Ціна, кількість і варіації', Component: () => <div>inventory body</div> }
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
    fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }))
  })
  expect(screen.getByRole('heading', { name: 'Більше налаштувань товару' })).toBeInTheDocument()
  const d = screen.getByTestId('own-section-fake') as HTMLDetailsElement
  expect(d).toHaveClass('my-section') // one collapsible-card style for every feature section
  expect(d.querySelector('summary')).toHaveTextContent('Фейкова секція')
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
    // The editor shows the changed listing (its title in the header) and keeps the photo.
    expect(screen.getByTestId('listing-editor').querySelector('.my-editor-title')).toHaveTextContent('Changed by section')
    expect(screen.getByTestId('listing-editor').querySelector('img.my-thumb')).toHaveAttribute('src', mkMyListing(1).imageUrl)
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
    expect(screen.getByText('Тут немає товарів')).toBeInTheDocument()
  })
})

describe('the sections list', () => {
  it('a fixed order with deleting last and marked; every section says what it is for', async () => {
    render(<MyShopModal />)
    await act(async () => {})
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Редагувати' }))
    })
    const more = screen.getByRole('heading', { name: 'Більше налаштувань товару' }).closest('section')!
    const ids = [...more.querySelectorAll('details')].map((d) => d.getAttribute('data-testid'))
    expect(ids).toEqual(['own-section-inventory', 'own-section-orders-sales', 'own-section-fake', 'own-section-danger'])
    const summary = (id: string) => screen.getByTestId(`own-section-${id}`).querySelector('summary')!
    // The host explains its known sections (with an icon) …
    expect(summary('inventory')).toHaveTextContent(/варіанти \(розмір, колір\)/)
    expect(summary('inventory').querySelector('.feature-summary-icon svg')).not.toBeNull()
    // … a feature's own description wins …
    expect(summary('orders-sales')).toHaveTextContent('Опис від самої функції.')
    // … and deleting is named plainly, red, and last.
    const danger = screen.getByTestId('own-section-danger')
    expect(danger).toHaveClass('my-section--danger')
    expect(summary('danger')).toHaveTextContent('Видалити товар з Etsy')
    expect(summary('danger')).toHaveTextContent('Цю дію не можна скасувати.')
    expect(summary('danger')).not.toHaveTextContent('Небезпечна зона')
    expect(within(more).queryByText('danger body')).toBeNull()
  })
})
