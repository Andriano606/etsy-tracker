// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MyShopModal } from '../../../src/renderer/src/components/MyShopModal'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { Sidebar } from '../../../src/renderer/src/components/Sidebar'
import { useStore } from '../../../src/renderer/src/store'
import { GLOSSARY } from '../../../src/shared/glossary'
import { ImageViewer } from '../../../src/renderer/src/ui'
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

/** Opens the window the way the app does (the sidebar's / shop header's buttons call setShowMyShop). */
async function open(status = etsyOut) {
  api.getEtsyAuth.mockResolvedValue(status)
  useStore.setState({ etsyAuth: status })
  const r = renderIt()
  await act(async () => {
    useStore.getState().setShowMyShop(true)
  })
  return r
}

describe('Мій магазин: signing in', () => {
  it('the sidebar button opens it; signed out shows the 3-step guide with the redirect URI and "Увійти через Etsy"', async () => {
    api.getEtsyAuth.mockResolvedValue(etsyOut)
    useStore.setState({ etsyAuth: etsyOut })
    renderIt()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Мій магазин/ }))
    })
    expect(screen.getByRole('dialog', { name: 'Мій магазин Etsy' })).toBeInTheDocument()
    const guide = screen.getByTestId('etsy-signin')
    for (const step of ['Що станеться', 'Перевірте адресу й відкрийте Etsy', 'Вставте адресу з браузера'])
      expect(within(guide).getByRole('heading', { name: step })).toBeInTheDocument()
    // What the sign-in will ask for, in plain words.
    expect(guide).toHaveTextContent('зміну товарів')
    expect(guide).not.toHaveTextContent('лістинг')
    expect(guide).toHaveTextContent('замовлення й фінанси')
    expect(screen.getByLabelText('Адреса повернення')).toHaveValue('https://localhost:3003/callback')
    expect(screen.getByLabelText('Адреса повернення')).toHaveAccessibleDescription(/Має точно збігатися/)
    expect(screen.getByRole('button', { name: 'Що таке «Адреса повернення»?' })).toBeInTheDocument()
    // Step 3 waits for step 2.
    expect(screen.queryByTestId('etsy-paste')).toBeNull()
    expect(guide).toHaveTextContent('Цей крок стане доступним')
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
    const done = screen.getByRole('button', { name: 'Завершити вхід' })
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

  it('errors from begin and complete are shown at the step they belong to', async () => {
    await open()
    api.beginEtsyLogin.mockResolvedValueOnce({ ok: false, error: 'Спершу збережіть API-ключ Etsy.' })
    await act(async () => {
      fireEvent.click(screen.getByText('Увійти через Etsy'))
    })
    // Step 2: the redirect field is marked and explains what went wrong.
    const redirect = screen.getByLabelText('Адреса повернення')
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося відкрити Etsy: Спершу збережіть API-ключ Etsy.')
    expect(redirect).toHaveAttribute('aria-invalid', 'true')
    expect(redirect).toHaveAccessibleDescription(/Спершу збережіть API-ключ Etsy/)
    expect(redirect.closest('.my-step')).toContainElement(screen.getByRole('alert'))
    // Typing a new address clears it.
    fireEvent.change(redirect, { target: { value: 'https://localhost:3003/cb' } })
    expect(screen.queryByRole('alert')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByText('Увійти через Etsy'))
    })
    // Step 3 is open now: the cursor waits in the address box.
    const pasted = screen.getByLabelText('Адреса з браузера')
    expect(pasted).toHaveFocus()
    api.completeEtsyLogin.mockResolvedValueOnce({ ok: false, error: 'state не збігається' })
    fireEvent.change(pasted, { target: { value: 'x' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Завершити вхід' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося увійти: state не збігається')
    expect(pasted).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('etsy-paste')).toContainElement(screen.getByRole('alert'))
    expect(redirect).not.toHaveAttribute('aria-invalid', 'true')
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
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('signed in: who, until when (explained), the sign-out button', async () => {
    await open(etsyIn())
    const bar = screen.getByTestId('etsy-signed-in')
    expect(bar).toHaveTextContent('вхід дійсний до')
    expect(within(bar).getByRole('button', { name: 'Що таке «Вхід дійсний до»?' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Вийти' })).toBeInTheDocument()
    expect(bar).not.toHaveTextContent('без шифрування')
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
    expect(screen.queryByRole('button', { name: /Мій магазин/ })).toBeNull()
  })

  it('the button stays while signed out, or while the own shop is not in the list yet', () => {
    useStore.setState({ etsyAuth: etsyOut, shops: [mkShop({ id: 68736507, shopName: 'TidyFoxSheets' })] })
    const { rerender } = render(<Sidebar />)
    expect(screen.getByRole('button', { name: /Мій магазин/ })).toBeInTheDocument()
    expect(screen.queryByText('мій')).toBeNull()
    act(() => useStore.setState({ etsyAuth: etsyIn(), shops: [mkShop({ id: 1 })] }))
    rerender(<Sidebar />)
    expect(screen.getByRole('button', { name: /Мій магазин/ })).toBeInTheDocument()
  })
})

describe('Мій магазин: tabs', () => {
  it('every section is a tab in a vertical list, products first, each with an explanation', async () => {
    api.getMyListings.mockResolvedValue({ ok: true, value: { state: 'active', total: 0, offset: 0, listings: [] } })
    await open(etsyIn())
    const list = screen.getByRole('tablist', { name: 'Розділи магазину' })
    expect(list).toHaveAttribute('aria-orientation', 'vertical')
    const names = within(list)
      .getAllByRole('tab')
      .map((t) => t.textContent)
    expect(names[0]).toBe('Товари')
    expect(names).toContain('Профіль магазину')
    expect(names).toContain('Акаунт')
    expect(names[names.length - 1]).toBe('Акаунт')
    expect(screen.getByRole('tab', { name: 'Товари' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Товари' })).toHaveAccessibleDescription(/лістингами/)
    expect(screen.getByRole('tabpanel')).toContainElement(screen.getByTestId('my-listings'))
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Профіль магазину' }))
    })
    expect(screen.getByRole('tab', { name: 'Профіль магазину' })).toHaveAttribute('aria-selected', 'true')
  })

  it('the subtitle says when changes reach Etsy and the tracked data', async () => {
    await open(etsyIn())
    expect(screen.getByRole('dialog', { name: 'Мій магазин Etsy' })).toHaveAccessibleDescription(
      /Зміни одразу зберігаються на Etsy.*після наступного сканування/
    )
  })
})

describe('Мій магазин: listings', () => {
  const page = (listings = [mkMyListing(1), mkMyListing(2, { title: 'Habit Tracker' })], total = listings.length) => ({
    ok: true as const,
    value: { state: 'active' as const, total, offset: 0, listings }
  })

  it('lists the active ones: explained price and quantity, a state chip only when it differs from the filter; the filter reloads', async () => {
    api.getMyListings.mockResolvedValue(
      page([mkMyListing(1), mkMyListing(2, { title: 'Habit Tracker', state: 'sold_out' }), mkMyListing(3, { type: 'physical', quantity: 4 })])
    )
    await open(etsyIn())
    expect(api.getMyListings).toHaveBeenCalledWith('active', 0)
    const list = screen.getByTestId('my-listings')
    const row = within(list).getByText('Budget Planner 1').closest('li')!
    // The filter already says "Активні" — no chip repeating it on every row.
    expect(row).not.toHaveTextContent('активний')
    // The seller's base price and what the quantity means for a file are explained.
    expect(within(row as HTMLElement).getByText('5,01 USD')).toHaveAccessibleDescription(GLOSSARY.basePrice.short)
    expect(within(row as HTMLElement).getByText('можна купити ще: 999')).toHaveAccessibleDescription(GLOSSARY.quantity.short)
    expect(within(list).getByText('Budget Planner 3').closest('li')).toHaveTextContent('у наявності: 4')
    const other = within(list).getByText('Habit Tracker').closest('li')!
    expect(within(other as HTMLElement).getByText('розпроданий')).toHaveAccessibleDescription(GLOSSARY.listingSoldOut.short)
    expect(within(list).getByText('Budget Planner 1')).toHaveAttribute('title', 'Budget Planner 1')
    expect(screen.getByRole('radio', { name: 'Активні' })).toBeChecked()
    api.getMyListings.mockResolvedValue({ ok: true, value: { state: 'draft', total: 0, offset: 0, listings: [] } })
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Чернетки' }))
    })
    expect(api.getMyListings).toHaveBeenLastCalledWith('draft', 0)
    expect(screen.getByText('Тут немає товарів')).toBeInTheDocument()
    expect(screen.getByText(/Немає чернеток на Etsy/)).toBeInTheDocument()
  })

  it('"Показати ще" pages on', async () => {
    api.getMyListings.mockResolvedValueOnce(page([mkMyListing(1)], 2))
    api.getMyListings.mockResolvedValueOnce({ ok: true, value: { state: 'active', total: 2, offset: 1, listings: [mkMyListing(2)] } })
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Показати ще (1)' }))
    })
    expect(api.getMyListings).toHaveBeenLastCalledWith('active', 1)
    expect(screen.getByText('Budget Planner 2')).toBeInTheDocument()
  })

  it('a load error is shown and can be retried', async () => {
    api.getMyListings.mockResolvedValue({ ok: false, error: 'Вхід в Etsy більше не дійсний' })
    await open(etsyIn())
    expect(screen.getByRole('alert')).toHaveTextContent('Вхід в Etsy більше не дійсний')
    api.getMyListings.mockResolvedValue(page())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }))
    })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('Budget Planner 1')).toBeInTheDocument()
  })

  it('edit: only the changed fields are sent; the row updates', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    const editor = screen.getByTestId('listing-editor')
    const save = within(editor).getByRole('button', { name: 'Зберегти на Etsy' })
    expect(save).toBeDisabled()
    expect(editor).toHaveTextContent('Змін ще немає.')
    fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Budget Planner 2027' } })
    fireEvent.change(screen.getByLabelText('Теги'), { target: { value: 'budget, planner, 2027' } })
    expect(screen.getByText('3/13')).toBeInTheDocument()
    // The tags as Etsy will read them.
    expect(within(screen.getByRole('list', { name: 'Як це побачить Etsy' })).getAllByRole('listitem').map((x) => x.textContent)).toEqual([
      'budget',
      'planner',
      '2027'
    ])
    expect(editor).toHaveTextContent('Буде змінено: назву, теги.')
    await act(async () => {
      fireEvent.click(save)
    })
    expect(api.saveMyListing).toHaveBeenCalledWith(1, { title: 'Budget Planner 2027', tags: ['budget', 'planner', '2027'] })
    expect(screen.getByText('Збережено на Etsy.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'До списку' }))
    })
    expect(screen.getByTestId('my-listings')).toBeInTheDocument()
  })

  it('every field is explained', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    for (const term of ['Назва товару', 'Опис товару', 'Теги', 'Матеріали', 'Стан на Etsy', 'Автоподовження'])
      expect(screen.getByRole('button', { name: `Що таке «${term}»?` })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Автоматично продовжувати' })).toBeChecked()
  })

  it('invalid input is explained at the field and blocks saving', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    fireEvent.change(screen.getByLabelText('Теги'), { target: { value: 'budget/plan' } })
    expect(screen.getByRole('alert')).toHaveTextContent('недозволений символ «/»')
    expect(screen.getByLabelText('Теги')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('budget/plan')).toHaveClass('is-bad')
    expect(screen.getByRole('button', { name: 'Зберегти на Etsy' })).toBeDisabled()
  })

  it('an Etsy error on save is shown in the save bar, next to the button', async () => {
    api.getMyListings.mockResolvedValue(page())
    api.saveMyListing.mockResolvedValueOnce({ ok: false, error: 'Etsy не дозволив цю дію (HTTP 403)' })
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    fireEvent.change(screen.getByLabelText('Опис'), { target: { value: 'New text' } })
    const save = screen.getByRole('button', { name: 'Зберегти на Etsy' })
    await act(async () => {
      fireEvent.click(save)
    })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Не вдалося зберегти на Etsy')
    expect(alert).toHaveTextContent('HTTP 403')
    expect(save.closest('.my-savebar')).toContainElement(alert)
    // Editing again clears it.
    fireEvent.change(screen.getByLabelText('Опис'), { target: { value: 'New text 2' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('publishing a draft explains the fee, asks first; deactivating does not ask', async () => {
    api.getMyListings.mockResolvedValue(page([mkMyListing(1, { state: 'draft' }), mkMyListing(2)]))
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    expect(screen.getByRole('radiogroup', { name: 'Стан' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Чернетка (як зараз)' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Опублікувати' }))
    expect(screen.getByTestId('listing-editor')).toHaveTextContent('плату за розміщення $0,20')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Зберегти на Etsy' }))
    })
    expect(screen.getByText(/Etsy стягне звичайну плату за публікацію \(\$0,20 за 4 місяці\)/)).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Скасувати' }))
    })
    expect(api.saveMyListing).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Зберегти на Etsy' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Підтвердити'))
    })
    expect(api.saveMyListing).toHaveBeenCalledWith(1, { state: 'active' })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'До списку' }))
    })
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[1])
    })
    fireEvent.click(screen.getByRole('radio', { name: 'Вимкнути' }))
    expect(screen.getByTestId('listing-editor')).toHaveTextContent(GLOSSARY['myshop.deactivate'].short)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Зберегти на Etsy' }))
    })
    expect(api.saveMyListing).toHaveBeenLastCalledWith(2, { state: 'inactive' })
  })

  it('"Скасувати" in the editor goes back to the list without saving — after asking, when something changed', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Other' } })
    await act(async () => {
      fireEvent.click(within(screen.getByTestId('listing-editor')).getByRole('button', { name: 'Скасувати' }))
    })
    const ask = screen.getByRole('alertdialog')
    expect(ask).toHaveTextContent('Закрити без збереження?')
    expect(ask).toHaveTextContent('Ви змінили назву, але ще не зберегли на Etsy')
    expect(ask).toHaveTextContent('На Etsy нічого не зміниться.')
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: 'Не зберігати' }))
    })
    expect(api.saveMyListing).not.toHaveBeenCalled()
    expect(screen.getByTestId('my-listings')).toBeInTheDocument()
    // Nothing changed: back at once, no question.
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'До списку' }))
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('my-listings')).toBeInTheDocument()
  })

  it('unsaved edits: Escape, another tab and "До списку" ask first; "Скасувати" in the question keeps them', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    fireEvent.change(screen.getByLabelText('Назва'), { target: { value: 'Budget Planner 2027' } })
    fireEvent.change(screen.getByLabelText('Теги'), { target: { value: 'budget' } })
    const keep = async () => {
      expect(screen.getByRole('alertdialog')).toHaveTextContent('Ви змінили назву і теги')
      await act(async () => {
        fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Скасувати' }))
      })
      expect(screen.getByLabelText('Назва')).toHaveValue('Budget Planner 2027')
    }
    // Escape on the window.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await keep()
    expect(screen.getByRole('dialog', { name: 'Мій магазин Etsy' })).toBeInTheDocument()
    // The × button.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Закрити' }))
    })
    await keep()
    // Another tab.
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Профіль магазину' }))
    })
    await keep()
    expect(screen.getByRole('tab', { name: 'Товари' })).toHaveAttribute('aria-selected', 'true')
    // "До списку".
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'До списку' }))
    })
    await keep()
    // Agreeing to drop them does what was asked: the other tab opens.
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Профіль магазину' }))
    })
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Не зберігати' }))
    })
    expect(screen.getByRole('tab', { name: 'Профіль магазину' })).toHaveAttribute('aria-selected', 'true')
    expect(api.saveMyListing).not.toHaveBeenCalled()
    // Nothing unsaved any more: Escape closes at once.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('after a save nothing is unsaved: leaving does not ask', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    fireEvent.change(screen.getByLabelText('Опис'), { target: { value: 'New text' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Зберегти на Etsy' }))
    })
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
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
    expect(screen.getByRole('button', { name: 'Що таке «Оголошення»?' })).toBeInTheDocument()
    expect(screen.getByLabelText('Оголошення')).toHaveAccessibleDescription('Видно вгорі сторінки магазину.')
    const save = within(screen.getByTestId('my-profile')).getByRole('button', { name: 'Зберегти на Etsy' })
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
    expect(screen.getByLabelText(/Додаткові політики/, { selector: 'textarea' })).toBeDisabled()
    expect(screen.getByText('Etsy дозволяє це поле лише магазинам у ЄС.')).toBeInTheDocument()
  })

  it('EU shops can edit them', async () => {
    await openProfile(mkMyShop({ inEu: true, countryIso: 'PL' }))
    expect(screen.getByLabelText(/Додаткові політики/, { selector: 'textarea' })).toBeEnabled()
  })

  it('load and save errors are shown', async () => {
    api.getMyShop.mockResolvedValue({ ok: false, error: 'Увійдіть в Etsy' })
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Профіль магазину' }))
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')
  })

  it('a save error is shown in the save bar', async () => {
    api.saveMyShop.mockResolvedValueOnce({ ok: false, error: 'Etsy не дозволив цю дію (HTTP 403)' })
    await openProfile()
    fireEvent.change(screen.getByLabelText('Оголошення'), { target: { value: 'Big sale!' } })
    const save = within(screen.getByTestId('my-profile')).getByRole('button', { name: 'Зберегти на Etsy' })
    await act(async () => {
      fireEvent.click(save)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося зберегти на EtsyEtsy не дозволив цю дію (HTTP 403)')
    expect(save.closest('.my-savebar')).toContainElement(screen.getByRole('alert'))
  })

  it('changed shop texts: another tab asks first', async () => {
    await openProfile()
    fireEvent.change(screen.getByLabelText('Оголошення'), { target: { value: 'Big sale!' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Товари' }))
    })
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Тексти магазину, які ви змінили, ще не збережено на Etsy')
    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Скасувати' }))
    })
    expect(screen.getByLabelText('Оголошення')).toHaveValue('Big sale!')
  })

  it('Escape closes it', async () => {
    await open(etsyIn())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Мій магазин: фото товару на весь розмір', () => {
  const full = (id: number) => `https://i.etsystatic.com/1/il_fullxfull.${id}.jpg`
  const page = () => ({
    ok: true as const,
    value: { state: 'active' as const, total: 2, offset: 0, listings: [mkMyListing(1, { imageFullUrl: full(1) }), mkMyListing(2, { imageUrl: null, imageFullUrl: null })] }
  })

  it('a row thumbnail opens the main photo at full size; the editor does not open; Escape closes only the viewer', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    render(<ImageViewer />)
    const list = screen.getByTestId('my-listings')
    const row = within(list).getByText('Budget Planner 1').closest('li') as HTMLElement
    // a listing without a photo has a placeholder, nothing to open
    expect(within(within(list).getByText('Budget Planner 2').closest('li') as HTMLElement).queryByRole('button', { name: /на весь розмір/ })).toBeNull()
    await act(async () => {
      fireEvent.click(within(row).getByRole('button', { name: 'Відкрити на весь розмір: Головне фото: Budget Planner 1' }))
    })
    const dialog = screen.getByRole('dialog', { name: 'Перегляд зображення' })
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', full(1))
    expect(screen.queryByTestId('listing-editor')).toBeNull()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog', { name: 'Перегляд зображення' })).toBeNull()
    expect(useStore.getState().showMyShop).toBe(true)
    expect(screen.getByTestId('my-listings')).toBeInTheDocument()
  })

  it('an older listing object without the full-size URL opens the thumbnail it has', async () => {
    api.getMyListings.mockResolvedValue({ ok: true, value: { state: 'active', total: 1, offset: 0, listings: [mkMyListing(3)] } })
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Відкрити на весь розмір: Головне фото: Budget Planner 3' }))
    })
    expect(useStore.getState().viewer!.images[0].src).toBe('https://i.etsystatic.com/1/il_170x135.3.jpg')
  })

  it('the editor head thumbnail opens it too, and keeps the full-size URL after a save (Etsy answers without images)', async () => {
    api.getMyListings.mockResolvedValue(page())
    await open(etsyIn())
    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Редагувати' })[0])
    })
    const editor = screen.getByTestId('listing-editor')
    fireEvent.change(screen.getByLabelText('Опис'), { target: { value: 'New text' } })
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: 'Зберегти на Etsy' }))
    })
    expect(api.saveMyListing).toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(editor).getByRole('button', { name: /^Відкрити на весь розмір: Головне фото/ }))
    })
    expect(useStore.getState().viewer).toEqual({
      images: [{ src: full(1), alt: 'Головне фото: Budget Planner 1', caption: 'Budget Planner 1' }],
      index: 0
    })
    expect(screen.getByTestId('listing-editor')).toBeInTheDocument()
  })
})
