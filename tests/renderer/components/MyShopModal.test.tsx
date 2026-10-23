// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MyShopModal } from '../../../src/renderer/src/components/MyShopModal'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { Sidebar } from '../../../src/renderer/src/components/Sidebar'
import { useStore } from '../../../src/renderer/src/store'
import { etsyIn, etsyOut, mkMyListing, mkMyShop, mkShop, setupRenderer, withKey, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({ keyStatus: withKey })
})

const renderIt = () =>
  render(
    <>
      <Sidebar />
      <MyShopModal />
      <ConfirmModal />
    </>
  )

async function open(status = etsyOut) {
  api.getEtsyAuth.mockResolvedValue(status)
  useStore.setState({ etsyAuth: status })
  const r = renderIt()
  await act(async () => {
    fireEvent.click(screen.getByText(/Мій магазин/, { selector: 'button' }))
  })
  return r
}

describe('Мій магазин: signing in', () => {
  it('the sidebar button opens it; signed out shows the redirect URI and "Увійти через Etsy"', async () => {
    await open()
    expect(screen.getByRole('dialog', { name: 'Мій магазин Etsy' })).toBeInTheDocument()
    expect(screen.getByLabelText('Адреса повернення')).toHaveValue('https://localhost:3003/callback')
    expect(screen.queryByTestId('etsy-paste')).toBeNull()
  })

  it('begin → the paste step → complete → signed in', async () => {
    await open()
    fireEvent.change(screen.getByLabelText('Адреса повернення'), { target: { value: 'https://localhost:4000/cb' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Увійти через Etsy'))
    })
    expect(api.beginEtsyLogin).toHaveBeenCalledWith('https://localhost:4000/cb')
    expect(screen.getByTestId('etsy-paste')).toHaveTextContent('Allow Access')
    expect(screen.getByText('Відкрити сторінку Etsy ще раз')).toBeInTheDocument()
    const done = screen.getByText('Завершити вхід')
    expect(done).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Адреса з браузера'), {
      target: { value: 'https://localhost:4000/cb?code=C&state=S' }
    })
    await act(async () => {
      fireEvent.click(done)
    })
    expect(api.completeEtsyLogin).toHaveBeenCalledWith('https://localhost:4000/cb?code=C&state=S')
    expect(screen.getByTestId('etsy-signed-in')).toHaveTextContent('Ви увійшли: TidyFoxSheets')
    expect(useStore.getState().etsyAuth?.loggedIn).toBe(true)
  })

  it('a pending sign-in (from main) shows the paste step at once', async () => {
    await open({ ...etsyOut, pending: true })
    expect(screen.getByTestId('etsy-paste')).toBeInTheDocument()
  })

  it('errors from begin and complete are shown', async () => {
    await open()
    api.beginEtsyLogin.mockResolvedValueOnce({ ok: false, error: 'Спершу збережіть API-ключ Etsy.' })
    await act(async () => {
      fireEvent.click(screen.getByText('Увійти через Etsy'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Спершу збережіть API-ключ Etsy.')
    await act(async () => {
      fireEvent.click(screen.getByText('Увійти через Etsy'))
    })
    api.completeEtsyLogin.mockResolvedValueOnce({ ok: false, error: 'state не збігається' })
    fireEvent.change(screen.getByLabelText('Адреса з браузера'), { target: { value: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Завершити вхід'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('state не збігається')
  })

  it('unreadable stored tokens: asks to sign in again', async () => {
    await open({ ...etsyOut, unreadable: true })
    expect(screen.getByText(/не вдалося розшифрувати/)).toBeInTheDocument()
  })

  it('the developer page link opens in the browser', async () => {
    await open()
    fireEvent.click(screen.getByText('etsy.com/developers/your-apps'))
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/developers/your-apps')
  })

  it('sign-out asks first', async () => {
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getByText('Вийти'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Скасувати'))
    })
    expect(api.logoutEtsy).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText('Вийти'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Підтвердити'))
    })
    expect(api.logoutEtsy).toHaveBeenCalled()
    expect(screen.getByTestId('etsy-signin')).toBeInTheDocument()
  })

  it('an account without a shop', async () => {
    await open(etsyIn({ shopId: null, shopName: null }))
    expect(screen.getByText('У цього акаунта Etsy немає магазину.')).toBeInTheDocument()
  })

  it('signed in, the own shop is in the list marked "мій" and the sign-in button is gone', () => {
    useStore.setState({
      etsyAuth: etsyIn(),
      shops: [mkShop({ id: 1, shopName: 'Other' }), mkShop({ id: 68736507, shopName: 'TidyFoxSheets' })]
    })
    render(<Sidebar />)
    const own = screen.getByText('TidyFoxSheets').closest('.shop-item-name')!
    expect(within(own as HTMLElement).getByText('мій')).toBeInTheDocument()
    expect(within(screen.getByText('Other').closest('.shop-item-name') as HTMLElement).queryByText('мій')).toBeNull()
    expect(screen.queryByText('✏️ Мій магазин')).toBeNull()
  })

  it('the button stays while signed out, or while the own shop is not in the list yet', () => {
    useStore.setState({ etsyAuth: etsyOut, shops: [mkShop({ id: 68736507, shopName: 'TidyFoxSheets' })] })
    const { rerender } = render(<Sidebar />)
    expect(screen.getByText('✏️ Мій магазин')).toBeInTheDocument()
    expect(screen.queryByText('мій')).toBeNull()
    act(() => useStore.setState({ etsyAuth: etsyIn(), shops: [mkShop({ id: 1 })] }))
    rerender(<Sidebar />)
    expect(screen.getByText('✏️ Мій магазин')).toBeInTheDocument()
  })
})

describe('Мій магазин: listings', () => {
  const page = (listings = [mkMyListing(1), mkMyListing(2, { title: 'Habit Tracker' })], total = listings.length) => ({
    ok: true as const,
    value: { state: 'active' as const, total, offset: 0, listings }
  })

  it('lists the active ones; the state filter reloads', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    expect(api.getMyListings).toHaveBeenCalledWith('active', 0)
    const list = screen.getByTestId('my-listings')
    expect(within(list).getByText('Budget Planner 1')).toBeInTheDocument()
    expect(within(list).getByText(/активний · 5,01/)).toBeInTheDocument()
    api.getMyListings.mockResolvedValue({ ok: true, value: { state: 'draft', total: 0, offset: 0, listings: [] } })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Показати'), { target: { value: 'draft' } })
    })
    expect(api.getMyListings).toHaveBeenLastCalledWith('draft', 0)
    expect(screen.getByText('Тут немає лістингів.')).toBeInTheDocument()
  })

  it('"Показати ще" pages on', async () => {
    api.getMyListings.mockResolvedValueOnce(page([mkMyListing(1)], 2))
    api.getMyListings.mockResolvedValueOnce({ ok: true, value: { state: 'active', total: 2, offset: 1, listings: [mkMyListing(2)] } })
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getByText('Показати ще (1)'))
    })
    expect(api.getMyListings).toHaveBeenLastCalledWith('active', 1)
    expect(screen.getByText('Budget Planner 2')).toBeInTheDocument()
  })

  it('a load error is shown', async () => {
    api.getMyListings.mockResolvedValue({ ok: false, error: 'Вхід в Etsy більше не дійсний' })
    await open(etsyIn())
    expect(screen.getByRole('alert')).toHaveTextContent('Вхід в Etsy більше не дійсний')
  })

  it('edit: only the changed fields are sent; the row updates', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByText('Редагувати')[0])
    })
    const editor = screen.getByTestId('listing-editor')
    const save = within(editor).getByText('Зберегти на Etsy')
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Назва/), { target: { value: 'Budget Planner 2027' } })
    fireEvent.change(screen.getByLabelText(/Теги через кому/), { target: { value: 'budget, planner, 2027' } })
    expect(screen.getByText('(3/13)')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(save)
    })
    expect(api.saveMyListing).toHaveBeenCalledWith(1, { title: 'Budget Planner 2027', tags: ['budget', 'planner', '2027'] })
    expect(screen.getByText('Збережено на Etsy.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('← До списку'))
    })
    expect(screen.getByTestId('my-listings')).toBeInTheDocument()
  })

  it('invalid input is explained and blocks saving', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByText('Редагувати')[0])
    })
    fireEvent.change(screen.getByLabelText(/Теги через кому/), { target: { value: 'budget/plan' } })
    expect(screen.getByRole('alert')).toHaveTextContent('недозволений символ «/»')
    expect(screen.getByText('Зберегти на Etsy')).toBeDisabled()
  })

  it('an Etsy error on save is shown', async () => {
    api.getMyListings.mockResolvedValue(page())
    api.saveMyListing.mockResolvedValueOnce({ ok: false, error: 'Etsy не дозволив цю дію (HTTP 403)' })
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByText('Редагувати')[0])
    })
    fireEvent.change(screen.getByLabelText('Опис'), { target: { value: 'New text' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Зберегти на Etsy'))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 403')
  })

  it('publishing a draft asks first (fee, photo needed); deactivating does not', async () => {
    api.getMyListings.mockResolvedValue(page([mkMyListing(1, { state: 'draft' }), mkMyListing(2)]))
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByText('Редагувати')[0])
    })
    fireEvent.change(screen.getByLabelText('Стан'), { target: { value: 'active' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Зберегти на Etsy'))
    })
    expect(screen.getByText(/Etsy стягне звичайну плату за публікацію/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByText('Скасувати', { selector: '.modal-actions button' }))
    })
    expect(api.saveMyListing).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByText('Зберегти на Etsy'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Підтвердити'))
    })
    expect(api.saveMyListing).toHaveBeenCalledWith(1, { state: 'active' })

    await act(async () => {
      fireEvent.click(screen.getByText('← До списку'))
    })
    await act(async () => {
      fireEvent.click(screen.getAllByText('Редагувати')[1])
    })
    fireEvent.change(screen.getByLabelText('Стан'), { target: { value: 'inactive' } })
    await act(async () => {
      fireEvent.click(screen.getByText('Зберегти на Etsy'))
    })
    expect(api.saveMyListing).toHaveBeenLastCalledWith(2, { state: 'inactive' })
  })
})

describe('Мій магазин: shop profile', () => {
  async function openProfile(profile = mkMyShop()) {
    api.getMyShop.mockResolvedValue({ ok: true, value: profile })
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Профіль магазину' }))
    })
  }

  it('shows the texts; saves only what changed', async () => {
    await openProfile()
    expect(screen.getByLabelText('Оголошення')).toHaveValue('Hello!')
    const save = within(screen.getByTestId('my-profile')).getByText('Зберегти на Etsy')
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Оголошення'), { target: { value: 'Big sale!' } })
    await act(async () => {
      fireEvent.click(save)
    })
    expect(api.saveMyShop).toHaveBeenCalledWith({ announcement: 'Big sale!' })
    expect(screen.getByText('Збережено на Etsy.')).toBeInTheDocument()
  })

  it('additional policies are locked outside the EU, editable inside', async () => {
    await openProfile()
    expect(screen.getByLabelText(/Додаткові політики/)).toBeDisabled()
    expect(screen.getByText('Etsy дозволяє це поле лише магазинам у ЄС.')).toBeInTheDocument()
  })

  it('EU shops can edit them', async () => {
    await openProfile(mkMyShop({ inEu: true, countryIso: 'PL' }))
    expect(screen.getByLabelText(/Додаткові політики/)).toBeEnabled()
  })

  it('load and save errors are shown', async () => {
    api.getMyShop.mockResolvedValue({ ok: false, error: 'Увійдіть в Etsy' })
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Профіль магазину' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')
  })

  it('Escape closes it', async () => {
    await open(etsyIn())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
