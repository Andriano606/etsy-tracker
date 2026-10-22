// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AddShopModal } from '../../../src/renderer/src/components/AddShopModal'
import { useStore } from '../../../src/renderer/src/store'
import { mkShop, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ showAddShop: true })
})

const type = (v: string) =>
  fireEvent.change(screen.getByLabelText(/Посилання на магазин/), { target: { value: v } })

describe('AddShopModal', () => {
  it('adds a shop from a pasted link and selects it', async () => {
    api.addShop.mockResolvedValue({ ok: true, shop: mkShop({ id: 42, shopName: 'NewShop' }) })
    render(<AddShopModal />)
    type('https://www.etsy.com/uk/shop/NewShop?ref=abc')
    fireEvent.click(screen.getByText('Додати'))
    await waitFor(() => expect(useStore.getState().showAddShop).toBe(false))
    expect(api.addShop).toHaveBeenCalledWith('https://www.etsy.com/uk/shop/NewShop?ref=abc')
    expect(useStore.getState().activeShopId).toBe(42)
    expect(useStore.getState().shops.map((s) => s.id)).toEqual([42])
  })

  it('validates locally before calling main (listing link)', async () => {
    render(<AddShopModal />)
    type('https://www.etsy.com/listing/123/mug')
    fireEvent.click(screen.getByText('Додати'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/посилання на товар/)
    expect(api.addShop).not.toHaveBeenCalled()
  })

  it('shows the error from main and stays open', async () => {
    api.addShop.mockResolvedValue({ ok: false, error: 'Магазин «Nope» не знайдено на Etsy.' })
    render(<AddShopModal />)
    type('Nope1')
    fireEvent.click(screen.getByText('Додати'))
    expect(await screen.findByRole('alert')).toHaveTextContent('не знайдено на Etsy')
    expect(useStore.getState().showAddShop).toBe(true)
  })

  it('the add button is disabled for empty input; Скасувати closes', () => {
    render(<AddShopModal />)
    expect(screen.getByText('Додати')).toBeDisabled()
    fireEvent.click(screen.getByText('Скасувати'))
    expect(useStore.getState().showAddShop).toBe(false)
  })
})
