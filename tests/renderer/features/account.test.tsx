// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MyShopModal } from '../../../src/renderer/src/components/MyShopModal'
import { useStore } from '../../../src/renderer/src/store'
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
    expect(tab).toHaveTextContent('me@example.com')
    expect(tab).toHaveTextContent('TidyFoxSheets (#68736507)')
    expect(tab).toHaveTextContent('читання лістингів, email акаунта')
    expect(tab).toHaveTextContent('Main st 1, Lviv, Ukraine')
    expect(tab).toHaveTextContent('для доставки за замовчуванням')
    expect(tab).toHaveTextContent('Немає дозволу на адреси акаунта')
  })

  it('an error is shown', async () => {
    mockFeature({ 'account.summary': { ok: false, error: 'Увійдіть в Etsy' } })
    await openTab()
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')
  })

  it('a sign-in with fewer permissions than the app asks for is flagged', async () => {
    useStore.setState({ etsyAuth: etsyIn({ scopes: ['listings_r', 'listings_w', 'shops_r', 'shops_w'] }) })
    api.getEtsyAuth.mockResolvedValue(etsyIn({ scopes: ['listings_r', 'listings_w', 'shops_r', 'shops_w'] }))
    render(<MyShopModal />)
    await act(async () => {})
    expect(screen.getByTestId('missing-scopes')).toHaveTextContent('видалення лістингів, замовлення й фінанси')
  })
})
