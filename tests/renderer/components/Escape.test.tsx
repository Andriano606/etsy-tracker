// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { App } from '../../../src/renderer/src/App'
import { useStore } from '../../../src/renderer/src/store'
import { mkChange, mkListing, mkScan, mkShop, setupRenderer, type Api } from '../helpers'

// Escape must close modals wherever the focus is (a modal moves it inside; an
// older one leaves it on the button that opened it), and only the topmost modal
// at a time. Closing gives the focus back to the opener.

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

const escape = () => act(() => void fireEvent.keyDown(document.body, { key: 'Escape' }))

async function renderApp() {
  api.listShops.mockResolvedValue([mkShop({ lastOkScan: mkScan({ id: 7, added: 1 }) })])
  api.listListings.mockResolvedValue([mkListing(1)])
  render(<App />)
  await screen.findByRole('heading', { level: 1, name: /CeramicStudioUA/ })
}

describe('Escape closes modals', () => {
  it('a listing opened from a card closes with Escape and gives the focus back to the card', async () => {
    await renderApp()
    const card = screen.getAllByTestId('listing-card')[0]
    card.focus()
    fireEvent.click(card)
    expect(screen.getByTestId('listing-description')).toBeInTheDocument()
    const dialog = screen.getByTestId('listing-description').closest('[role="dialog"]')
    // The focus is in the listing dialog (or, for a dialog that doesn't take it, still on the card).
    expect(document.activeElement === card || !!dialog?.contains(document.activeElement)).toBe(true)
    escape()
    expect(useStore.getState().detailListing).toBeNull()
    expect(screen.queryByTestId('listing-description')).toBeNull()
    expect(document.activeElement).toBe(card)
  })

  it('Add-shop takes the focus into its field and returns it to the sidebar button', async () => {
    await renderApp()
    const opener = screen.getByRole('button', { name: 'Додати магазин' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByLabelText('Посилання на магазин Etsy або його назва')).toHaveFocus()
    escape()
    expect(screen.queryByRole('dialog', { name: 'Додати магазин' })).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('Settings and Add-shop close with Escape', async () => {
    await renderApp()
    act(() => useStore.getState().setShowSettings(true))
    expect(screen.getByRole('heading', { name: 'Налаштування' })).toBeInTheDocument()
    escape()
    expect(useStore.getState().showSettings).toBe(false)
    act(() => useStore.getState().setShowAddShop(true))
    escape()
    expect(useStore.getState().showAddShop).toBe(false)
  })

  it('closes only the topmost: a listing opened from the history, then the history', async () => {
    api.getScanChanges.mockImplementation(async (scanId: number) =>
      scanId === 3 ? [mkChange(1, 'added', mkListing(9, { title: 'From history' }))] : []
    )
    await renderApp()
    await act(() => useStore.getState().openHistoryScan(mkScan({ id: 3 })))
    fireEvent.click(await screen.findByText('From history'))
    expect(useStore.getState().detailListing?.listingId).toBe(9)
    escape()
    expect(useStore.getState().detailListing).toBeNull()
    expect(useStore.getState().historyScan?.id).toBe(3)
    escape()
    expect(useStore.getState().historyScan).toBeNull()
  })

  it('Escape in a confirm dialog cancels it and leaves Settings open', async () => {
    await renderApp()
    act(() => useStore.getState().setShowSettings(true))
    let answer: boolean | undefined
    act(() => void useStore.getState().requestConfirm('Sure?').then((ok) => (answer = ok)))
    expect(screen.getByText('Sure?')).toBeInTheDocument()
    escape()
    await act(async () => {})
    expect(answer).toBe(false)
    expect(useStore.getState().confirmRequest).toBeNull()
    expect(useStore.getState().showSettings).toBe(true)
  })
})
