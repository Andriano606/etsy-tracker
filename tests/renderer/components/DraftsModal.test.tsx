// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { DraftsModal } from '../../../src/renderer/src/components/DraftsModal'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { ShopView } from '../../../src/renderer/src/components/ShopView'
import { useStore } from '../../../src/renderer/src/store'
import type { CreateListingProgress } from '../../../src/shared/types'
import { GLOSSARY } from '../../../src/shared/glossary'
import { etsyIn, etsyOut, mkDraft, mkScan, mkShop, setupRenderer, withKey, type Api } from '../helpers'

const OWN = 68736507

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({
    keyStatus: withKey,
    etsyAuth: etsyIn(),
    shops: [mkShop({ id: OWN, shopName: 'TidyFoxSheets', currency: 'USD', lastOkScan: mkScan({ shopId: OWN }) })],
    activeShopId: OWN
  })
})

const renderAll = () =>
  render(
    <>
      <ShopView />
      <DraftsModal />
      <ConfirmModal />
    </>
  )

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el)
  })
}

const renderModal = () =>
  render(
    <>
      <DraftsModal />
      <ConfirmModal />
    </>
  )

/** "Новий товар" in the own shop's header opens an empty editor (openDrafts({draftId: null})). */
async function newDraft() {
  renderModal()
  await act(async () => useStore.getState().openDrafts({ draftId: null }))
}

async function openList() {
  renderModal()
  await act(async () => useStore.getState().openDrafts('list'))
}

async function fillValid() {
  fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Budget Planner 2027' } })
  fireEvent.change(screen.getByLabelText('Опис'), { target: { value: 'Track your money.' } })
  fireEvent.change(screen.getByLabelText(/^Ціна/), { target: { value: '5.99' } })
  fireEvent.change(screen.getByLabelText('Категорія'), { target: { value: 'planner' } })
  await click(within(screen.getByRole('listbox', { name: 'Категорії' })).getAllByRole('option')[0])
  fireEvent.change(screen.getByLabelText('Теги'), { target: { value: 'budget, planner' } })
}

const confirm = () => click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Підтвердити' }))

describe('own shop header', () => {
  it('"мій", "Новий товар", "Чернетки" with the count of unsent drafts, "Керувати"', async () => {
    useStore.setState({ drafts: [mkDraft(1), mkDraft(2, { status: 'sent', sentListingId: 9 }), mkDraft(3, { source: 'mcp' })] })
    renderAll()
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('мій')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Чернетки.*2/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Керувати/ }))
    expect(useStore.getState().showMyShop).toBe(true)
    await click(screen.getByRole('button', { name: /Чернетки/ }))
    expect(screen.getByTestId('draft-list')).toBeInTheDocument()
  })

  it('"Новий товар" opens an empty editor', async () => {
    renderAll()
    await click(screen.getByRole('button', { name: 'Новий товар' }))
    expect(screen.getByTestId('draft-form')).toBeInTheDocument()
  })

  it('other shops (or signed out) have none of it', () => {
    useStore.setState({ etsyAuth: etsyOut })
    render(<ShopView />)
    expect(screen.queryByText('мій')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Новий товар' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Чернетки/ })).toBeNull()
  })
})

describe('the drafts list', () => {
  it('shows each draft: who prepared it (explained), status chip, what is missing; opens one', async () => {
    useStore.setState({
      drafts: [
        mkDraft(1, { source: 'mcp', problems: ['Виберіть категорію.', 'Опис не може бути порожнім.'] }),
        mkDraft(2, { status: 'sent', sentListingId: 4242, sentPublished: false, fields: { ...mkDraft(2).fields, title: 'Sent one' } }),
        mkDraft(3, { status: 'error', lastError: 'HTTP 400' })
      ]
    })
    await openList()
    expect(screen.getByRole('dialog', { name: 'Чернетки нових товарів' })).toBeInTheDocument()
    const list = screen.getByTestId('draft-list')
    const row1 = within(list).getByText('Planner 1').closest('li')!
    expect(within(row1 as HTMLElement).getByText('від Claude')).toHaveAccessibleDescription(GLOSSARY['myshop.fromClaude'].short)
    expect(within(row1 as HTMLElement).getByText('чекає перевірки')).toHaveAccessibleDescription(/На Etsy ще нічого не надіслано/)
    expect(within(row1 as HTMLElement).getByText('ще потрібно: 2')).toHaveAccessibleDescription('Виберіть категорію. Опис не може бути порожнім.')
    const sent = within(list).getByText('Sent one').closest('li')!
    expect(sent).toHaveTextContent('надіслано на Etsy')
    expect(sent).toHaveTextContent('товар № 4242')
    expect(list).not.toHaveTextContent(/лістинг #/)
    expect(sent).not.toHaveTextContent('ще потрібно')
    expect(within(sent as HTMLElement).getByRole('button', { name: 'Переглянути' })).toBeInTheDocument()
    expect(within(list).getByText('Planner 3').closest('li')).toHaveTextContent('не вдалося надіслати')
    expect(within(list).getByText('Чернеток: 3')).toBeInTheDocument()
    await click(within(row1 as HTMLElement).getByRole('button', { name: 'Відкрити' }))
    expect(screen.getByRole('dialog', { name: 'Чернетка товару' })).toBeInTheDocument()
    expect(screen.getByText(/Цю чернетку підготував Claude/)).toBeInTheDocument()
    expect(screen.getByLabelText('Назва')).toHaveValue('Planner 1')
    await click(screen.getByRole('button', { name: 'До чернеток' }))
    expect(screen.getByTestId('draft-list')).toBeInTheDocument()
  })

  it('empty list explains itself; "Нова чернетка" opens an empty editor', async () => {
    await openList()
    expect(screen.getByText('Чернеток ще немає')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Нова чернетка' })).toHaveLength(1)
    await click(screen.getByRole('button', { name: 'Нова чернетка' }))
    expect(screen.getByRole('heading', { name: 'Новий товар' })).toBeInTheDocument()
    expect(screen.getByLabelText('Назва')).toHaveValue('')
  })
})

describe('editing and sending a draft', () => {
  it('saving keeps it in the app (nothing sent)', async () => {
    await newDraft()
    await fillValid()
    await click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    expect(api.saveDraft).toHaveBeenCalledWith({
      fields: expect.objectContaining({
        type: 'download',
        title: 'Budget Planner 2027',
        price: '5.99',
        taxonomyId: 2,
        taxonomyPath: 'Paper & Party Supplies › Paper › Calendars & Planners',
        tags: ['budget', 'planner']
      }),
      photos: [],
      files: []
    })
    expect(screen.getByText('Чернетку збережено в програмі.')).toBeInTheDocument()
    expect(api.sendDraft).not.toHaveBeenCalled()
    // Saved again: now with its id.
    await click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    expect(api.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ id: 501 }))
  })

  it('an incomplete draft can be saved but not sent; the checklist says why', async () => {
    await newDraft()
    fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Idea' } })
    expect(screen.getByTestId('create-problems')).toHaveTextContent('Щоб надіслати на Etsy, ще потрібно:')
    expect(screen.getByTestId('create-problems')).toHaveTextContent('Виберіть категорію.')
    expect(screen.getByRole('button', { name: 'Зберегти чернетку' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Надіслати на Etsy як чернетку' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Надіслати й опублікувати' })).toBeDisabled()
  })

  it('"Надіслати на Etsy як чернетку": confirm → save → send(id, false) → the sent view', async () => {
    api.listDrafts.mockResolvedValue([mkDraft(501, { status: 'sent', sentListingId: 4242, sentPublished: false })])
    await newDraft()
    await fillValid()
    expect(screen.getByTestId('publish-problems')).toHaveTextContent('хоча б одне фото')
    expect(screen.getByRole('button', { name: 'Надіслати на Etsy як чернетку' })).toHaveAccessibleDescription(GLOSSARY['myshop.sendAsDraft'].short)
    await click(screen.getByRole('button', { name: 'Надіслати на Etsy як чернетку' }))
    expect(screen.getByText(/Покупці її не побачать/)).toBeInTheDocument()
    await confirm()
    expect(api.saveDraft).toHaveBeenCalled()
    expect(api.sendDraft).toHaveBeenCalledWith(501, false)
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('Надіслано на Etsy: товар № 4242 (чернетка на Etsy)')
  })

  it('publishing needs a photo and a file; asks about the fee; offers a rescan', async () => {
    api.pickListingFiles.mockImplementation(async (kind) =>
      kind === 'images' ? [{ token: 't1', name: 'cover.jpg', size: 2000 }] : [{ token: 'f1', name: 'Plan.xlsx', size: 3000 }]
    )
    api.listDrafts.mockResolvedValue([mkDraft(501, { status: 'sent', sentListingId: 4242, sentPublished: true })])
    await newDraft()
    await fillValid()
    await click(screen.getByRole('button', { name: 'Додати фото' }))
    await click(screen.getByRole('button', { name: 'Додати файли' }))
    expect(screen.getByText('cover.jpg').closest('li')).toHaveTextContent('головне')
    expect(screen.getByText('1/10')).toBeInTheDocument()
    expect(screen.getByText('Усе заповнено — товар можна одразу опублікувати.')).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Надіслати й опублікувати' }))
    expect(screen.getByText(/Etsy стягне звичайну плату за публікацію \(\$0,20 за 4 місяці\)/)).toBeInTheDocument()
    await confirm()
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ photos: [{ token: 't1' }], files: [{ token: 'f1' }] }))
    expect(api.sendDraft).toHaveBeenCalledWith(501, true)
    await click(screen.getByRole('button', { name: 'Сканувати магазин зараз' }))
    expect(api.scanShop).toHaveBeenCalledWith(OWN)
    expect(useStore.getState().draftsView).toBeNull()
  })

  it('a stored photo shows its preview; removing it saves the remaining refs', async () => {
    const d = mkDraft(7, {
      source: 'mcp',
      photos: [
        { id: 31, kind: 'photo', position: 1, name: 'a.jpg', mime: 'image/jpeg', size: 1000 },
        { id: 32, kind: 'photo', position: 2, name: 'b.jpg', mime: 'image/jpeg', size: 1000 }
      ]
    })
    useStore.setState({ drafts: [d], draftsView: { draftId: 7 } })
    renderModal()
    expect(screen.getByText('a.jpg').closest('li')!.querySelector('img')).toHaveAttribute('src', 'etsyimg://draft/31')
    expect(screen.getByText('a.jpg').closest('li')).toHaveTextContent('головне')
    // b.jpg can move up (and become the main photo); the first one can't.
    expect(screen.queryByRole('button', { name: 'Вище: a.jpg' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Вище: b.jpg' }))
    expect(screen.getByText('b.jpg').closest('li')).toHaveTextContent('головне')
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати: a.jpg' }))
    await click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 7, photos: [{ mediaId: 32 }] }))
  })

  it('a failed send is said in the save bar, next to the button; a previous failure is shown on open', async () => {
    api.sendDraft.mockResolvedValue({ ok: false, error: 'Не вдалося створити лістинг: HTTP 400' })
    api.listDrafts.mockResolvedValue([mkDraft(8, { status: 'error', lastError: 'Не вдалося створити лістинг: HTTP 400' })])
    useStore.setState({ drafts: [mkDraft(8, { status: 'error', lastError: 'HTTP 403' })], draftsView: { draftId: 8 } })
    renderModal()
    expect(screen.getByRole('alert')).toHaveTextContent('Минула спроба надіслати: HTTP 403')
    const send = screen.getByRole('button', { name: 'Надіслати на Etsy як чернетку' })
    await click(send)
    await confirm()
    // One alert, in the sticky bar (the old "last time" callout would only repeat it, far above).
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Не вдалося надіслати на Etsy')
    expect(alert).toHaveTextContent('HTTP 400')
    expect(send.closest('.my-savebar')).toContainElement(alert)
  })

  it('a save error is shown in the save bar and nothing is sent', async () => {
    api.saveDraft.mockResolvedValue({ ok: false, error: 'Фото може бути не більше 10.' })
    await newDraft()
    await fillValid()
    await click(screen.getByRole('button', { name: 'Надіслати на Etsy як чернетку' }))
    await confirm()
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося зберегти чернеткуФото може бути не більше 10.')
    expect(screen.getByRole('button', { name: 'Зберегти чернетку' }).closest('.my-savebar')).toContainElement(screen.getByRole('alert'))
    expect(api.sendDraft).not.toHaveBeenCalled()
  })

  it('unsaved changes: Escape, × and "До чернеток" ask first; after saving they do not', async () => {
    await newDraft()
    // An untouched new draft closes at once.
    expect(screen.queryByText('Є незбережені зміни.')).toBeNull()
    fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Budget Planner 2027' } })
    expect(screen.getByText('Є незбережені зміни.')).toBeInTheDocument()
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    const ask = screen.getByRole('alertdialog')
    expect(ask).toHaveTextContent('Закрити без збереження?')
    expect(ask).toHaveTextContent('Нову чернетку ще не збережено')
    await click(within(ask).getByRole('button', { name: 'Скасувати' }))
    expect(screen.getByLabelText(/^Назва/)).toHaveValue('Budget Planner 2027')
    await click(screen.getByRole('button', { name: 'Закрити' }))
    await click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Скасувати' }))
    await click(screen.getByRole('button', { name: 'До чернеток' }))
    await click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Скасувати' }))
    expect(screen.getByTestId('draft-form')).toBeInTheDocument()
    // Saved: nothing to lose, "До чернеток" goes straight back.
    await click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    expect(screen.queryByText('Є незбережені зміни.')).toBeNull()
    await click(screen.getByRole('button', { name: 'До чернеток' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useStore.getState().draftsView).toBe('list')
  })

  it('a stored draft: a changed field asks before closing; agreeing closes the window', async () => {
    useStore.setState({ drafts: [mkDraft(9)], draftsView: { draftId: 9 } })
    renderModal()
    // Just opening and closing never asks.
    expect(screen.getByText('Усе збережено в програмі.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Автоматично продовжувати' }))
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Зміни в чернетці ще не збережено в програмі')
    await click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Не зберігати' }))
    expect(useStore.getState().draftsView).toBeNull()
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  it('the price hint accepts a comma; a physical product has one photos heading', async () => {
    await newDraft()
    expect(screen.getByLabelText(/^Ціна/)).toHaveAccessibleDescription(/Наприклад 5,99 — можна з комою або крапкою/)
    expect(screen.getByLabelText(/^Ціна/)).toHaveAttribute('placeholder', '5,99')
    expect(screen.getByRole('heading', { name: 'Фото і файли' })).toBeInTheDocument()
    await click(screen.getByRole('radio', { name: 'Фізичний' }))
    expect(screen.getAllByText('Фото', { exact: true })).toHaveLength(1)
    expect(screen.getByRole('heading', { name: 'Фото' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Що таке «Фото товару»?' })).toBeInTheDocument()
  })

  it('progress pushed by main is shown while sending', async () => {
    let push: ((p: CreateListingProgress) => void) | null = null
    api.onCreateListingProgress.mockImplementation((cb) => {
      push = cb
      return () => {}
    })
    let finish: (v: { ok: true; listingId: number; published: boolean; warnings: string[] }) => void = () => {}
    api.sendDraft.mockImplementation(() => new Promise((r) => (finish = r)))
    await newDraft()
    await fillValid()
    await click(screen.getByRole('button', { name: 'Надіслати на Etsy як чернетку' }))
    await confirm()
    act(() => push!({ step: 'images', done: 0, total: 2, label: 'Фото 1 з 2…' }))
    expect(screen.getByRole('status')).toHaveTextContent('Фото 1 з 2…')
    await act(async () => finish({ ok: true, listingId: 1, published: false, warnings: [] }))
  })

  it('deleting asks first', async () => {
    useStore.setState({ drafts: [mkDraft(9)], draftsView: { draftId: 9 } })
    renderModal()
    await click(within(screen.getByTestId('draft-form')).getByRole('button', { name: 'Видалити' }))
    expect(screen.getByText(/Видалити цю чернетку з програми\?/)).toBeInTheDocument()
    expect(screen.getByText(/На Etsy нічого не зміниться/)).toBeInTheDocument()
    await confirm()
    expect(api.deleteDraft).toHaveBeenCalledWith(9)
    expect(useStore.getState().draftsView).toBe('list')
  })

  it('physical: shipping/processing profiles, no files', async () => {
    await newDraft()
    expect(screen.getByRole('radio', { name: 'Цифровий' })).toBeChecked()
    expect(screen.getByTestId('draft-form')).toHaveTextContent('Покупець отримає файли')
    await click(screen.getByRole('radio', { name: 'Фізичний' }))
    expect(screen.getByRole('radio', { name: 'Фізичний' })).toBeChecked()
    expect(screen.getByTestId('draft-form')).toHaveTextContent('відправите поштою')
    expect(screen.getByLabelText('Кількість')).toHaveValue('1')
    expect(screen.getByLabelText('Профіль доставки')).toHaveValue('11')
    expect(screen.queryByRole('button', { name: 'Додати файли' })).toBeNull()
    await fillValid()
    await click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ type: 'physical', quantity: 1, shippingProfileId: 11, readinessStateId: 21 }) })
    )
  })

  it('a taxonomy error is shown; Escape closes', async () => {
    api.getTaxonomy.mockResolvedValue({ ok: false, error: 'Немає з’єднання з Etsy.' })
    await newDraft()
    expect(screen.getByRole('alert')).toHaveTextContent('Немає з’єднання з Etsy.')
    expect(screen.getByLabelText('Категорія')).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('every field is explained; the switches are toggles', async () => {
    await newDraft()
    for (const term of ['Назва товару', 'Опис товару', 'Базова ціна продавця', 'Кількість у наявності', 'Категорія', 'Теги', 'Матеріали', 'Хто зробив', 'Коли зроблено', 'Матеріал для рукоділля', 'Фото товару', 'Файли для покупця', 'Автоподовження'])
      expect(screen.getByRole('button', { name: `Що таке «${term}»?` })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Це матеріал чи інструмент для творчості' })).not.toBeChecked()
    const renew = screen.getByRole('switch', { name: 'Автоматично продовжувати' })
    expect(renew).toBeChecked()
    fireEvent.click(renew)
    await fillValid()
    await click(screen.getByRole('button', { name: 'Зберегти чернетку' }))
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ fields: expect.objectContaining({ shouldAutoRenew: false, isSupply: false }) }))
  })

  it('a sent draft is read-only and can be removed from the app', async () => {
    useStore.setState({ drafts: [mkDraft(4, { status: 'sent', sentListingId: 77, sentPublished: false })], draftsView: { draftId: 4 } })
    renderModal()
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('Чернетку створено на Etsy')
    expect(screen.queryByTestId('draft-form')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Сканувати магазин зараз' })).toBeNull()
    await click(screen.getByRole('button', { name: 'Прибрати з чернеток' }))
    await confirm()
    expect(api.deleteDraft).toHaveBeenCalledWith(4)
  })

  it('drafts:changed from main updates the list (a draft Claude just prepared appears)', async () => {
    await openList()
    act(() => useStore.getState().setDrafts([mkDraft(5, { source: 'mcp' })]))
    expect(screen.getByText('Planner 5')).toBeInTheDocument()
  })
})
