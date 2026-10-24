// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MyShopModal } from '../../../src/renderer/src/components/MyShopModal'
import { useStore } from '../../../src/renderer/src/store'
import { GLOSSARY } from '../../../src/shared/glossary'
import { etsyIn, mockFeature, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ showMyShop: true, etsyAuth: etsyIn() })
  api.getEtsyAuth.mockResolvedValue(etsyIn())
})

const summary = {
  userId: 555,
  email: 'me@example.com',
  firstName: 'Andrii',
  lastName: 'K',
  avatarUrl: null,
  addresses: [{ id: 9, name: 'Andrii', firstLine: 'Main st 1', secondLine: null, city: 'Lviv', state: null, zip: null, countryIso: 'UA', countryName: 'Ukraine', isDefaultShipping: true }],
  grantedScopes: ['listings_r', 'email_r'],
  shopId: 68736507,
  shopName: 'TidyFoxSheets',
  notes: ['Немає дозволу на адреси акаунта — увійдіть в Etsy ще раз, щоб його надати.']
}

async function openTab() {
  render(<MyShopModal />)
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: 'Акаунт' }))
  })
}

describe('Мій магазин → Акаунт', () => {
  it('shows the account (name, email, shop, permissions, addresses, notes)', async () => {
    mockFeature({ 'account.summary': summary })
    await openTab()
    expect(api.featureCall).toHaveBeenCalledWith('account', 'summary', {})
    const tab = screen.getByTestId('account-tab')
    expect(tab).toHaveTextContent('Andrii K')
    // The shop by its name only (Etsy's internal shop number means nothing to a beginner).
    expect(within(tab).getAllByRole('definition').map((d) => d.textContent)).toEqual(['me@example.com', 'TidyFoxSheets'])
    expect(tab).not.toHaveTextContent('68736507')
    // The ⓘ sits next to a visible label saying what the card is.
    expect(within(tab).getByText(/^Ваш акаунт Etsy/)).toBeInTheDocument()
    expect(within(tab).getByRole('button', { name: 'Що таке «Акаунт Etsy»?' })).toHaveAccessibleDescription(GLOSSARY['features.account.account'].short)
    expect(within(tab).getByRole('list', { name: 'Видані дозволи' }).textContent).toBe('читання товарівemail акаунта')
    expect(within(tab).getByRole('button', { name: 'Що таке «Дозволи»?' })).toHaveAccessibleDescription(GLOSSARY.permissions.short)
    expect(within(tab).getByText('Main st 1, Lviv, Ukraine')).toBeInTheDocument()
    expect(within(tab).getByText('для доставки за замовчуванням')).toHaveAccessibleDescription(/коли ви самі щось купуєте/)
    expect(within(tab).getByRole('status')).toHaveTextContent('Немає дозволу на адреси акаунта')
  })

  it('a sign-in without email/address permissions: says what is unknown, no address section', async () => {
    mockFeature({ 'account.summary': { ...summary, email: null, firstName: null, lastName: null, addresses: null, shopId: null, shopName: null, grantedScopes: null, notes: [] } })
    await openTab()
    const tab = screen.getByTestId('account-tab')
    expect(tab).toHaveTextContent('Ім’я не вказано')
    expect(within(tab).getAllByRole('definition').map((d) => d.textContent)).toEqual(['невідома', 'немає'])
    expect(tab).toHaveTextContent('Etsy не сказав, які дозволи має вхід.')
    expect(within(tab).queryByText('Адреси')).toBeNull()
    expect(within(tab).queryByRole('status')).toBeNull()
  })

  it('no saved addresses: an empty state', async () => {
    mockFeature({ 'account.summary': { ...summary, addresses: [], notes: [] } })
    await openTab()
    expect(screen.getByText('Адрес немає.')).toBeInTheDocument()
  })

  it('an error is shown, with "Спробувати ще" that asks Etsy again', async () => {
    mockFeature({ 'account.summary': { ok: false, error: 'Увійдіть в Etsy' } })
    await openTab()
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')
    expect(api.featureCall).toHaveBeenCalledTimes(1)
    mockFeature({ 'account.summary': summary })
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Спробувати ще' }))
    })
    expect(api.featureCall).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('account-tab')).toHaveTextContent('Andrii K')
  })

  it('a sign-in with fewer permissions than the app asks for is flagged', async () => {
    useStore.setState({ etsyAuth: etsyIn({ scopes: ['listings_r', 'listings_w', 'shops_r', 'shops_w'] }) })
    api.getEtsyAuth.mockResolvedValue(etsyIn({ scopes: ['listings_r', 'listings_w', 'shops_r', 'shops_w'] }))
    render(<MyShopModal />)
    await act(async () => {})
    expect(screen.getByTestId('missing-scopes')).toHaveTextContent('видалення товарів, замовлення й фінанси')
  })
})

describe('Мій магазин → Акаунт: фото профілю', () => {
  it('the avatar opens in the image viewer (Etsy gives only 75×75 — that is what opens)', async () => {
    const avatar = 'https://i.etsystatic.com/iusa/abc/75x75.jpg'
    mockFeature({ 'account.summary': { ...summary, avatarUrl: avatar } })
    await openTab()
    const tab = screen.getByTestId('account-tab')
    await act(async () => {
      fireEvent.click(within(tab).getByRole('button', { name: 'Відкрити на весь розмір: Фото профілю: Andrii K' }))
    })
    expect(useStore.getState().viewer).toEqual({ images: [{ src: avatar, alt: 'Фото профілю: Andrii K', caption: undefined }], index: 0 })
    // the modal stays open
    expect(useStore.getState().showMyShop).toBe(true)
  })

  it('no avatar: a placeholder icon, nothing to open', async () => {
    mockFeature({ 'account.summary': summary })
    await openTab()
    expect(within(screen.getByTestId('account-tab')).queryByRole('button', { name: /на весь розмір/ })).toBeNull()
  })
})
