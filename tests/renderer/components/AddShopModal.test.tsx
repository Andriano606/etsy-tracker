// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { GLOSSARY } from '../../../src/shared/glossary'
import { AddShopModal, EXAMPLES } from '../../../src/renderer/src/components/AddShopModal'
import { parseShopInput } from '../../../src/shared/shopUrl'
import { useStore } from '../../../src/renderer/src/store'
import { mkShop, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ showAddShop: true })
})

const type = (v: string) =>
  fireEvent.change(screen.getByLabelText('Посилання на магазин Etsy або його назва'), { target: { value: v } })

const addButton = () => screen.getByRole('button', { name: 'Додати магазин' })

describe('AddShopModal', () => {
  it('adds a shop from a pasted link and selects it', async () => {
    api.addShop.mockResolvedValue({ ok: true, shop: mkShop({ id: 42, shopName: 'NewShop' }) })
    render(<AddShopModal />)
    type('https://www.etsy.com/uk/shop/NewShop?ref=abc')
    fireEvent.click(addButton())
    await waitFor(() => expect(useStore.getState().showAddShop).toBe(false))
    expect(api.addShop).toHaveBeenCalledWith('https://www.etsy.com/uk/shop/NewShop?ref=abc')
    expect(useStore.getState().activeShopId).toBe(42)
    expect(useStore.getState().shops.map((s) => s.id)).toEqual([42])
  })

  it('validates locally before calling main (listing link)', async () => {
    render(<AddShopModal />)
    type('https://www.etsy.com/listing/123/mug')
    fireEvent.click(addButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(/посилання на товар/)
    expect(api.addShop).not.toHaveBeenCalled()
  })

  it('shows the error from main and stays open', async () => {
    api.addShop.mockResolvedValue({ ok: false, error: 'Магазин «Nope» не знайдено на Etsy.' })
    render(<AddShopModal />)
    type('Nope1')
    fireEvent.click(addButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('не знайдено на Etsy')
    expect(useStore.getState().showAddShop).toBe(true)
  })

  it('the add button is disabled for empty input; Скасувати closes', () => {
    render(<AddShopModal />)
    expect(addButton()).toBeDisabled()
    fireEvent.click(screen.getByText('Скасувати'))
    expect(useStore.getState().showAddShop).toBe(false)
  })

  it('is a dialog with the field focused, the link explained and examples', () => {
    render(<AddShopModal />)
    expect(screen.getByRole('dialog', { name: 'Додати магазин' })).toBeInTheDocument()
    expect(screen.getByLabelText('Посилання на магазин Etsy або його назва')).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Що таке «Посилання на магазин»?' })).toHaveAccessibleDescription(
      GLOSSARY['shell.shopLink'].short
    )
    expect(screen.getByText('Що можна вставити')).toBeInTheDocument()
    expect(screen.getByText('ShopName.etsy.com')).toBeInTheDocument()
    expect(screen.getByText(/латинськими літерами й цифрами, як у посиланні/)).toBeInTheDocument()
    expect(screen.getByLabelText('Посилання на магазин Etsy або його назва')).toHaveAttribute('placeholder', 'https://www.etsy.com/shop/ShopName')
    expect(screen.getByText(/Не підходить посилання на окремий товар/)).toBeInTheDocument()
  })

  it('every example it marks as accepted really is accepted', () => {
    expect(EXAMPLES.length).toBeGreaterThan(0)
    for (const x of EXAMPLES) {
      const r = parseShopInput(x)
      expect(r.ok && r.shopName.toLowerCase(), x).toBe('shopname')
    }
  })

  it('shows the shop name it recognised while typing — and that Etsy is asked only on submit', () => {
    render(<AddShopModal />)
    type('https://www.etsy.com/uk/shop/NewShop?ref=abc')
    expect(screen.getByText('NewShop')).toBeInTheDocument()
    expect(screen.getByText('Назва магазину')).toHaveAccessibleDescription(GLOSSARY['shell.shopName'].short)
    expect(screen.getByText(/з посилання:/)).toHaveTextContent(/з посилання: NewShop\. Перевіримо її на Etsy, коли натиснете «Додати магазин»\.$/)
    expect(screen.queryByText(/Знайдено/)).toBeNull()
    type('https://www.etsy.com/listing/123/mug')
    expect(screen.queryByText('NewShop')).toBeNull()
  })

  it('Enter submits; the button says it is searching meanwhile', async () => {
    let done!: (v: { ok: boolean; error?: string }) => void
    api.addShop.mockReturnValue(new Promise((r) => (done = r)))
    render(<AddShopModal />)
    type('NewShop')
    fireEvent.submit(screen.getByLabelText('Посилання на магазин Etsy або його назва').closest('form')!)
    expect(await screen.findByRole('button', { name: 'Шукаю магазин…' })).toBeDisabled()
    await act(async () => done({ ok: false, error: 'Магазин «NewShop» не знайдено на Etsy.' }))
    expect(screen.getByRole('alert')).toHaveTextContent('не знайдено')
    expect(addButton()).toBeEnabled()
  })

  it('Escape and the backdrop close it', () => {
    const { rerender } = render(<AddShopModal />)
    act(() => void fireEvent.keyDown(document.body, { key: 'Escape' }))
    expect(useStore.getState().showAddShop).toBe(false)
    act(() => useStore.setState({ showAddShop: true }))
    rerender(<AddShopModal />)
    fireEvent.click(document.querySelector('.modal-backdrop')!)
    expect(useStore.getState().showAddShop).toBe(false)
  })
})
