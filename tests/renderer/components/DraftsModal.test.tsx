// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { DOWNLOAD_NOTE_MS, DraftsModal, draftStatus, pullSummaryText } from '../../../src/renderer/src/components/DraftsModal'
import { ImageViewer } from '../../../src/renderer/src/ui'
import { etsyListingEditUrl, etsyListingUrl } from '../../../src/shared/myShop'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { ShopView } from '../../../src/renderer/src/components/ShopView'
import { IDLE_DRAFT_PULL, useStore } from '../../../src/renderer/src/store'
import type { CreateListingProgress, CreateListingResult, DraftMedia, DraftPullState } from '../../../src/shared/types'
import { GLOSSARY } from '../../../src/shared/glossary'
import { etsyIn, etsyOut, mkDraft, mkDraftLink, mkScan, mkShop, setupRenderer, withKey, type Api } from '../helpers'

const OWN = 68736507

let api: Api
beforeEach(() => {
  api = setupRenderer()
  useStore.setState({
    keyStatus: withKey,
    etsyAuth: etsyIn(),
    shops: [mkShop({ id: OWN, shopName: 'TidyFoxSheets', currency: 'USD', lastOkScan: mkScan({ shopId: OWN }) })],
    activeShopId: OWN,
    // (resetStore in helpers doesn't know the pull state)
    draftPull: IDLE_DRAFT_PULL
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
      <ImageViewer />
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
    expect(screen.getByRole('dialog', { name: 'Чернетки товарів' })).toBeInTheDocument()
    const list = screen.getByTestId('draft-list')
    const row1 = within(list).getByText('Planner 1').closest('li')!
    expect(within(row1 as HTMLElement).getByText('від Claude')).toHaveAccessibleDescription(GLOSSARY['myshop.fromClaude'].short)
    expect(within(row1 as HTMLElement).getByText('лише в програмі')).toHaveAccessibleDescription(/На Etsy ще нічого не надіслано/)
    expect(within(row1 as HTMLElement).getByText('ще потрібно: 2')).toHaveAccessibleDescription('Виберіть категорію. Опис не може бути порожнім.')
    const sent = within(list).getByText('Sent one').closest('li')!
    expect(sent).toHaveTextContent('на Etsy: чернетка')
    expect(sent).toHaveTextContent('товар № 4242')
    expect(list).not.toHaveTextContent(/лістинг #/)
    expect(sent).not.toHaveTextContent('ще потрібно')
    // A sent draft opens editable, like any other.
    expect(within(sent as HTMLElement).getByRole('button', { name: 'Відкрити' })).toBeInTheDocument()
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
    expect(api.sendDraft).toHaveBeenCalledWith(501, false, { expectedUpdatedAt: expect.any(Number) })
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
    expect(api.sendDraft).toHaveBeenCalledWith(501, true, { expectedUpdatedAt: expect.any(Number) })
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
    await confirmWith('Видалити чернетку')
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

  it('a sent draft opens editable (no read-only view any more)', async () => {
    await openDraft(mkDraft(4, { status: 'sent', sentListingId: 77, sentPublished: false }))
    expect(screen.getByTestId('draft-form')).toBeInTheDocument()
    expect(screen.getByLabelText('Назва')).toBeEnabled()
    expect(screen.queryByTestId('draft-sent')).toBeNull()
    expect(screen.getByRole('button', { name: 'Зберегти в програмі' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Надіслати на Etsy як чернетку' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Оновити на Etsy' })).toBeEnabled()
  })

  it('drafts:changed from main updates the list (a draft Claude just prepared appears)', async () => {
    await openList()
    act(() => useStore.getState().setDrafts([mkDraft(5, { source: 'mcp' })]))
    expect(screen.getByText('Planner 5')).toBeInTheDocument()
  })
})

const photo = (id: number, position: number, name: string): DraftMedia => ({
  id,
  kind: 'photo',
  position,
  name,
  mime: 'image/jpeg',
  size: 1000,
  onEtsy: false,
  remote: false
})
const file = (id: number, position: number, name: string, over: Partial<DraftMedia> = {}): DraftMedia => ({
  id,
  kind: 'file',
  position,
  name,
  mime: 'application/pdf',
  size: 3000,
  onEtsy: false,
  remote: false,
  ...over
})
const viewer = () => screen.getByRole('dialog', { name: 'Перегляд зображення' })
const viewerImg = () => viewer().querySelector('img.ui-viewer-img')

describe('pictures open in the full-size viewer', () => {
  it('editor: a photo opens the draft\'s photos as a gallery at that photo; the editor stays as it was', async () => {
    api.pickListingFiles.mockResolvedValue([{ token: 't9', name: 'new.png', size: 500 }])
    useStore.setState({ drafts: [mkDraft(7, { photos: [photo(31, 1, 'a.jpg'), photo(32, 2, 'b.jpg')] })], draftsView: { draftId: 7 } })
    renderModal()
    // A freshly picked photo has no preview yet: nothing to open, and it is not in the gallery.
    await click(screen.getByRole('button', { name: 'Додати фото' }))
    expect(within(screen.getByText('new.png').closest('li')!).queryByRole('button', { name: /Відкрити на весь розмір/ })).toBeNull()
    await click(screen.getByRole('button', { name: 'Відкрити на весь розмір: b.jpg' }))
    expect(useStore.getState().viewer).toEqual({
      images: [
        { src: 'etsyimg://draft/31', alt: 'a.jpg', caption: 'a.jpg' },
        { src: 'etsyimg://draft/32', alt: 'b.jpg', caption: 'b.jpg' }
      ],
      index: 1
    })
    expect(viewerImg()).toHaveAttribute('src', 'etsyimg://draft/32')
    expect(viewer()).toHaveTextContent('2 / 2')
    // Escape closes only the viewer — the draft (with its unsaved photo) stays open, nothing was removed/moved.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    expect(screen.queryByRole('dialog', { name: 'Перегляд зображення' })).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('draft-form')).toBeInTheDocument()
    expect(screen.getByText('a.jpg').closest('li')).toHaveTextContent('головне')
    expect(useStore.getState().draftsView).toEqual({ draftId: 7 })
  })

  it('the list: a row\'s first photo opens all its photos; the draft itself does not open', async () => {
    useStore.setState({
      drafts: [mkDraft(3, { photos: [photo(41, 1, 'cover.jpg'), photo(42, 2, 'inside.jpg')] }), mkDraft(4)]
    })
    await openList()
    const row = screen.getByText('Planner 3').closest('li') as HTMLElement
    expect(within(screen.getByText('Planner 4').closest('li') as HTMLElement).queryByRole('button', { name: /Відкрити на весь розмір/ })).toBeNull()
    await click(within(row).getByRole('button', { name: 'Відкрити на весь розмір: Planner 3' }))
    const v = useStore.getState().viewer!
    expect(v.index).toBe(0)
    expect(v.images.map((i) => i.src)).toEqual(['etsyimg://draft/41', 'etsyimg://draft/42'])
    expect(viewerImg()).toHaveAttribute('src', 'etsyimg://draft/41')
    expect(useStore.getState().draftsView).toBe('list')
    expect(screen.getByTestId('draft-list')).toBeInTheDocument()
  })

  it('a sent draft: its photos open too', async () => {
    useStore.setState({
      drafts: [mkDraft(4, { status: 'sent', sentListingId: 77, sentPublished: true, photos: [photo(51, 1, 'x.jpg'), photo(52, 2, 'y.jpg')] })],
      draftsView: { draftId: 4 }
    })
    renderModal()
    await click(within(screen.getByTestId('draft-form')).getByRole('button', { name: 'Відкрити на весь розмір: x.jpg' }))
    expect(useStore.getState().viewer).toMatchObject({ index: 0, images: [{ src: 'etsyimg://draft/51' }, { src: 'etsyimg://draft/52' }] })
    expect(viewerImg()).toHaveAttribute('src', 'etsyimg://draft/51')
    expect(api.openExternal).not.toHaveBeenCalled()
  })
})

describe('the buyer\'s files can be downloaded', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('editor: a stored file has a download button (a freshly picked one has none); the saved path is said, then goes away', async () => {
    api.pickListingFiles.mockResolvedValue([{ token: 'f2', name: 'Fresh.xlsx', size: 100 }])
    api.saveDraftMedia.mockResolvedValue({ ok: true, value: { path: '/home/me/Downloads/Plan.pdf' } })
    useStore.setState({ drafts: [mkDraft(9, { files: [file(61, 1, 'Plan.pdf')] })], draftsView: { draftId: 9 } })
    renderModal()
    await click(screen.getByRole('button', { name: 'Додати файли' }))
    expect(within(screen.getByText('Fresh.xlsx').closest('li')!).queryByRole('button', { name: /Завантажити/ })).toBeNull()
    vi.useFakeTimers()
    await click(screen.getByRole('button', { name: 'Завантажити файл «Plan.pdf»' }))
    expect(api.saveDraftMedia).toHaveBeenCalledWith(61)
    expect(screen.getByRole('status')).toHaveTextContent('Збережено: /home/me/Downloads/Plan.pdf')
    // Downloading changes nothing in the draft.
    expect(screen.getByText('Є незбережені зміни.')).toBeInTheDocument() // (the picked file — not the download)
    expect(screen.getByText('Plan.pdf')).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(DOWNLOAD_NOTE_MS)
    })
    expect(screen.queryByText(/Збережено: /)).toBeNull()
    expect(api.saveDraft).not.toHaveBeenCalled()
  })

  it('a cancelled save says nothing; a failed one says why', async () => {
    useStore.setState({ drafts: [mkDraft(9, { files: [file(61, 1, 'Plan.pdf')] })], draftsView: { draftId: 9 } })
    renderModal()
    api.saveDraftMedia.mockResolvedValueOnce({ ok: true, value: null })
    await click(screen.getByRole('button', { name: 'Завантажити файл «Plan.pdf»' }))
    expect(api.saveDraftMedia).toHaveBeenCalledWith(61)
    expect(screen.queryByText(/Збережено/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    api.saveDraftMedia.mockResolvedValueOnce({ ok: false, error: 'Немає доступу до папки.' })
    await click(screen.getByRole('button', { name: 'Завантажити файл «Plan.pdf»' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося зберегти файл: Немає доступу до папки.')
  })

  it('a sent draft lists its files with the same download buttons (and they can be removed — it is editable)', async () => {
    useStore.setState({
      drafts: [mkDraft(4, { status: 'sent', sentListingId: 77, sentPublished: false, files: [file(61, 1, 'Plan.pdf'), file(62, 2, 'Guide.pdf')] })],
      draftsView: { draftId: 4 }
    })
    renderModal()
    const sent = screen.getByTestId('draft-form')
    expect(within(sent).getByText('Файли для покупця')).toBeInTheDocument()
    expect(within(sent).getByRole('button', { name: 'Прибрати: Plan.pdf' })).toBeInTheDocument()
    await click(within(sent).getByRole('button', { name: 'Завантажити файл «Guide.pdf»' }))
    expect(api.saveDraftMedia).toHaveBeenCalledWith(62)
    expect(within(sent).getByText('Збережено: /tmp/file').closest('[role="status"]')).toHaveClass('draft-dl-note')
  })
})

describe('after a send: links to the listing on Etsy', () => {
  it('published: "Відкрити на Etsy" (the public page) and "Редагувати на Etsy" (the editor)', async () => {
    useStore.setState({ drafts: [mkDraft(4, { status: 'sent', sentListingId: 77, sentPublished: true })], draftsView: { draftId: 4 } })
    renderModal()
    const links = screen.getByTestId('draft-etsy-links')
    expect(links).toHaveTextContent('якщо на etsy.com ви увійшли як власник цього магазину')
    await click(within(links).getByRole('button', { name: 'Відкрити на Etsy' }))
    expect(api.openExternal).toHaveBeenLastCalledWith(etsyListingUrl(77))
    await click(within(links).getByRole('button', { name: 'Редагувати на Etsy' }))
    expect(api.openExternal).toHaveBeenLastCalledWith(etsyListingEditUrl(77))
  })

  it('sent as an Etsy draft: only the editor (there is no public page yet)', async () => {
    useStore.setState({ drafts: [mkDraft(4, { status: 'sent', sentListingId: 77, sentPublished: false })], draftsView: { draftId: 4 } })
    renderModal()
    expect(screen.queryByRole('button', { name: 'Відкрити на Etsy' })).toBeNull()
    await click(screen.getByRole('button', { name: 'Редагувати на Etsy' }))
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/your/shops/me/listing-editor/edit/77')
  })

  it('a partial failure with a listing id: the editor link is there to finish it', async () => {
    useStore.setState({
      drafts: [mkDraft(4, { status: 'error', sentListingId: 88, sentPublished: false, lastError: 'Чернетку створено (#88), але фото не завантажилось.' })],
      draftsView: { draftId: 4 }
    })
    renderModal()
    expect(screen.getByRole('alert')).toHaveTextContent('Минула спроба надіслати: Чернетку створено (#88), але фото не завантажилось.')
    expect(screen.getByTestId('draft-link')).toHaveTextContent('не вдалося надіслати')
    expect(screen.queryByRole('button', { name: 'Відкрити на Etsy' })).toBeNull()
    // The retry updates that listing (main never creates a second one).
    expect(screen.getByRole('button', { name: 'Оновити на Etsy' })).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Редагувати на Etsy' }))
    expect(api.openExternal).toHaveBeenCalledWith(etsyListingEditUrl(88))
  })

  it('right after publishing, the links are the next step', async () => {
    api.listDrafts.mockResolvedValue([mkDraft(501, { status: 'sent', sentListingId: 4242, sentPublished: true })])
    await newDraft()
    await fillValid()
    expect(screen.queryByTestId('draft-etsy-links')).toBeNull()
    await click(screen.getByRole('button', { name: 'Надіслати на Etsy як чернетку' }))
    await confirm()
    await click(within(screen.getByTestId('draft-etsy-links')).getByRole('button', { name: 'Відкрити на Etsy' }))
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/listing/4242')
  })

  it('a draft that was never sent has no Etsy links', async () => {
    useStore.setState({ drafts: [mkDraft(9)], draftsView: { draftId: 9 } })
    await act(async () => {
      renderModal()
    })
    expect(screen.queryByTestId('draft-etsy-links')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Редагувати на Etsy' })).toBeNull()
  })
})

// ---------------------------------------------------------------- linked drafts (sent / pulled from Etsy)

/** A draft linked to Etsy listing 77 (an Etsy draft, in sync unless `link` says otherwise). */
const linked = (id: number, link: Parameters<typeof mkDraftLink>[1] = {}, over: Parameters<typeof mkDraft>[1] = {}) =>
  mkDraft(id, { status: 'sent', sentListingId: 77, sentPublished: link.state === 'active', etsy: mkDraftLink(77, link), ...over })

const withPhoto = { photos: [photo(31, 1, 'cover.jpg')], files: [file(61, 1, 'Plan.pdf')] }

async function openDraft(d: ReturnType<typeof mkDraft>) {
  useStore.setState({ drafts: [d], draftsView: { draftId: d.id } })
  await act(async () => {
    renderModal()
  })
}

const confirmWith = (name: string) => click(within(screen.getByRole('alertdialog')).getByRole('button', { name }))

describe('the drafts list: where each draft is', () => {
  it('a chip per state: only here / on Etsy (draft, published + link) / unsent edits / changed on Etsy / deleted on Etsy / failed', async () => {
    useStore.setState({
      drafts: [
        mkDraft(1),
        linked(2),
        linked(3, { state: 'active', url: 'https://www.etsy.com/listing/77' }),
        linked(4, { dirty: true }, { status: 'changed' }),
        linked(5, { dirty: true, changedOnEtsy: true }, { status: 'changed' }),
        linked(6, { state: 'removed', removed: true }),
        linked(7, {}, { status: 'error', lastError: 'HTTP 500' }),
        linked(8, { state: 'inactive' }),
        mkDraft(9, { source: 'etsy', status: 'sent', sentListingId: 99, etsy: mkDraftLink(99) })
      ]
    })
    await openList()
    const row = (title: string) => screen.getByText(title).closest('li') as HTMLElement
    expect(within(row('Planner 1')).getByText('лише в програмі')).toBeInTheDocument()
    expect(within(row('Planner 2')).getByText('на Etsy: чернетка')).toHaveAccessibleDescription(/покупці її не бачать/)
    expect(within(row('Planner 3')).getByText('на Etsy: опубліковано')).toBeInTheDocument()
    expect(within(row('Planner 4')).getByText('є зміни, не надіслані на Etsy')).toHaveAccessibleDescription(/«Оновити на Etsy»/)
    expect(within(row('Planner 5')).getByText('змінено на Etsy')).toHaveAccessibleDescription(GLOSSARY['myshop.changedOnEtsy'].short)
    expect(within(row('Planner 6')).getByText('видалено на Etsy')).toHaveAccessibleDescription(GLOSSARY['myshop.removedOnEtsy'].short)
    expect(within(row('Planner 7')).getByText('не вдалося надіслати')).toBeInTheDocument()
    expect(within(row('Planner 8')).getByText('на Etsy: вимкнено')).toBeInTheDocument()
    // Imported from a draft made on Etsy's site: the "з Etsy" badge, explained.
    expect(within(row('Planner 9')).getByText('з Etsy')).toHaveAccessibleDescription(GLOSSARY['myshop.fromEtsy'].short)
    expect(within(row('Planner 1')).queryByText('з Etsy')).toBeNull()
    // Only a published one links to its public page.
    expect(within(row('Planner 2')).queryByRole('button', { name: /Відкрити на Etsy/ })).toBeNull()
    await click(within(row('Planner 3')).getByRole('button', { name: 'Відкрити на Etsy: Planner 3' }))
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/listing/77')
    expect(useStore.getState().draftsView).toBe('list')
  })

  it('draftStatus: a removed link wins over an error; an unknown state still says it is on Etsy', () => {
    expect(draftStatus(linked(1, { state: 'removed', removed: true }, { status: 'error' })).label).toBe('видалено на Etsy')
    expect(draftStatus(linked(1, { state: null })).label).toBe('надіслано на Etsy')
    expect(draftStatus(mkDraft(1, { status: 'error' })).label).toBe('не вдалося надіслати')
    expect(draftStatus(linked(1, { state: 'expired' })).tone).toBe('warn')
  })
})

describe('"Синхронізувати з Etsy" (pulling the Etsy drafts in)', () => {
  it('runs a pull, says it is running, then what it did; the list is re-read', async () => {
    let finish: (v: { ok: true; value: { imported: number; updated: number; removed: number; conflicts: number; errors: string[] } }) => void = () => {}
    api.pullDrafts.mockImplementation(() => new Promise((r) => (finish = r)))
    api.listDrafts.mockResolvedValue([mkDraft(1, { source: 'etsy', fields: { ...mkDraft(1).fields, title: 'From Etsy' } })])
    await openList()
    const btn = screen.getByRole('button', { name: 'Синхронізувати з Etsy' })
    expect(btn).toHaveAccessibleDescription(GLOSSARY['myshop.syncDrafts'].short)
    await click(btn)
    expect(api.pullDrafts).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('draft-pull')).toHaveTextContent('Синхронізація з Etsy…')
    expect(screen.getByRole('button', { name: 'Синхронізувати з Etsy' })).toBeDisabled()
    await act(async () => finish({ ok: true, value: { imported: 2, updated: 1, removed: 1, conflicts: 1, errors: [] } }))
    expect(screen.getByTestId('draft-pull')).toHaveTextContent('Додано 2, оновлено 1, видалено на Etsy 1, змінено і тут, і на Etsy 1.')
    expect(screen.getByText('From Etsy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Синхронізувати з Etsy' })).toBeEnabled()
  })

  it('a failed pull and per-listing problems are said', async () => {
    api.pullDrafts.mockResolvedValueOnce({ ok: false, error: 'Вхід в Etsy більше не дійсний — увійдіть ще раз.' })
    await openList()
    await click(screen.getByRole('button', { name: 'Синхронізувати з Etsy' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося синхронізувати з Etsy')
    expect(screen.getByRole('alert')).toHaveTextContent('увійдіть ще раз')
    api.pullDrafts.mockResolvedValueOnce({ ok: true, value: { imported: 0, updated: 0, removed: 0, conflicts: 0, errors: ['Товар #5: не вдалося завантажити фото.'] } })
    await click(screen.getByRole('button', { name: 'Синхронізувати з Etsy' }))
    expect(screen.queryByText('Не вдалося синхронізувати з Etsy')).toBeNull()
    expect(screen.getByTestId('draft-pull')).toHaveTextContent('Деякі товари не вдалося синхронізувати')
    expect(screen.getByTestId('draft-pull')).toHaveTextContent('Товар #5: не вдалося завантажити фото.')
    // Not "all in sync" when some products failed.
    expect(screen.getByTestId('draft-pull')).toHaveTextContent('Нічого нового не підтягнуто — з деякими товарами не вийшло (див. нижче).')
    expect(screen.getByTestId('draft-pull')).not.toHaveTextContent('усе вже синхронізовано')
  })

  it('shows the state main pushes (a pull after a scan of the own shop), and reads the current one on start', async () => {
    let push: ((s: DraftPullState) => void) | null = null
    api.onDraftsPull.mockImplementation((cb) => {
      push = cb
      return () => {}
    })
    api.getDraftsPullState.mockResolvedValue({ running: false, lastAt: Date.UTC(2026, 9, 24, 9), lastSummary: { imported: 1, updated: 0, removed: 0, conflicts: 0, errors: [] }, error: null })
    await openList()
    expect(api.getDraftsPullState).toHaveBeenCalled()
    expect(screen.getByTestId('draft-pull')).toHaveTextContent('Додано 1, оновлено 0.')
    act(() => push!({ running: true, lastAt: null, lastSummary: null, error: null }))
    expect(screen.getByTestId('draft-pull')).toHaveTextContent('Синхронізація з Etsy…')
    act(() => push!({ running: false, lastAt: 1, lastSummary: null, error: 'Немає з’єднання з Etsy.' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Немає з’єднання з Etsy.')
  })

  it('signed out: the button is off and says why', async () => {
    useStore.setState({ etsyAuth: etsyOut })
    await openList()
    const btn = screen.getByRole('button', { name: 'Синхронізувати з Etsy' })
    expect(btn).toBeDisabled()
  })

  it('pullSummaryText', () => {
    expect(pullSummaryText({ imported: 0, updated: 3, removed: 0, conflicts: 0, errors: [] })).toBe('Додано 0, оновлено 3.')
  })
})

describe('a linked draft in the editor', () => {
  it('a strip says where it is on Etsy, links there, and when local edits are not on Etsy yet', async () => {
    await openDraft(linked(4, { state: 'active', url: 'https://www.etsy.com/listing/77' }, withPhoto))
    const strip = screen.getByTestId('draft-link')
    expect(strip).toHaveTextContent('Товар на Etsy № 77')
    expect(within(strip).getByText('на Etsy: опубліковано')).toBeInTheDocument()
    expect(strip).toHaveTextContent('синхронізовано')
    expect(within(strip).getByRole('button', { name: 'Що таке «Чернетка, пов’язана з Etsy»?' })).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Чернетка товару' })).toHaveAccessibleDescription(/«Оновити на Etsy» перенесе зміни туди/)
    expect(screen.queryByTestId('draft-unsent')).toBeNull()
    await click(within(strip).getByRole('button', { name: 'Відкрити на Etsy' }))
    expect(api.openExternal).toHaveBeenLastCalledWith('https://www.etsy.com/listing/77')
    await click(within(strip).getByRole('button', { name: 'Редагувати на Etsy' }))
    expect(api.openExternal).toHaveBeenLastCalledWith(etsyListingEditUrl(77))
    fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Better title' } })
    expect(screen.getByTestId('draft-unsent')).toHaveTextContent('є незбережені на Etsy зміни')
  })

  it('saved here but not on Etsy yet (dirty): said on open; an imported one has the "з Etsy" badge', async () => {
    await openDraft(linked(4, { dirty: true }, { status: 'changed', source: 'etsy' }))
    expect(screen.getByTestId('draft-unsent')).toBeInTheDocument()
    expect(within(screen.getByTestId('draft-link')).getByText('з Etsy')).toBeInTheDocument()
    expect(within(screen.getByTestId('draft-link')).getByText('є зміни, не надіслані на Etsy')).toBeInTheDocument()
  })

  it('"Зберегти в програмі" saves only here and says how to update Etsy', async () => {
    await openDraft(linked(4))
    fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Better title' } })
    await click(screen.getByRole('button', { name: 'Зберегти в програмі' }))
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 4, fields: expect.objectContaining({ title: 'Better title' }) }))
    expect(api.sendDraft).not.toHaveBeenCalled()
    expect(screen.getByText(/Збережено в програмі\. Щоб змінити й товар на Etsy, натисніть «Оновити на Etsy»\./)).toBeInTheDocument()
  })

  it('"Оновити на Etsy": confirm (free) → save → send(id, false) → "Товар на Etsy оновлено"', async () => {
    api.saveDraft.mockImplementation(async (input) => ({ ok: true, value: linked(4, { dirty: true }, { status: 'changed', fields: input.fields }) }))
    api.sendDraft.mockResolvedValue({ ok: true, listingId: 77, published: false, warnings: [], updated: true })
    api.listDrafts.mockResolvedValue([linked(4)])
    await openDraft(linked(4))
    fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Better title' } })
    expect(screen.getByRole('button', { name: 'Оновити на Etsy' })).toHaveAccessibleDescription(GLOSSARY['myshop.updateOnEtsy'].short)
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    const ask = screen.getByRole('alertdialog')
    expect(ask).toHaveTextContent('Оновити товар на Etsy?')
    expect(ask).toHaveTextContent('товару № 77 на Etsy стануть такими, як у цій чернетці')
    expect(ask).toHaveTextContent('Плати за це немає.')
    await confirmWith('Оновити на Etsy')
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }))
    expect(api.sendDraft).toHaveBeenCalledWith(4, false, { expectedUpdatedAt: expect.any(Number) })
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('Товар на Etsy оновлено')
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('Товар № 77 на Etsy тепер такий, як ця чернетка.')
    // Still the editor: it can be changed and updated again.
    expect(screen.getByTestId('draft-form')).toBeInTheDocument()
    expect(screen.queryByTestId('draft-unsent')).toBeNull()
  })

  it('not published yet: "Оновити й опублікувати" asks about the fee and sends with publish', async () => {
    api.sendDraft.mockResolvedValue({ ok: true, listingId: 77, published: true, warnings: [], updated: true })
    api.listDrafts.mockResolvedValue([linked(4, { state: 'active', url: 'https://www.etsy.com/listing/77' }, withPhoto)])
    await openDraft(linked(4, {}, withPhoto))
    await click(screen.getByRole('button', { name: 'Оновити й опублікувати' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/Etsy стягне звичайну плату за публікацію \(\$0,20 за 4 місяці\)/)
    await confirmWith('Оновити й опублікувати')
    expect(api.sendDraft).toHaveBeenCalledWith(4, true, { expectedUpdatedAt: expect.any(Number) })
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('Товар на Etsy оновлено й опубліковано')
    // Published now: the strip links to the public page; no second "publish" button.
    expect(within(screen.getByTestId('draft-link')).getByRole('button', { name: 'Відкрити на Etsy' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Оновити й опублікувати' })).toBeNull()
    await click(screen.getByRole('button', { name: 'Сканувати магазин зараз' }))
    expect(api.scanShop).toHaveBeenCalledWith(OWN)
  })

  it('inactive: turning it back on is free (said in the confirm and the tooltip)', async () => {
    await openDraft(linked(4, { state: 'inactive' }, withPhoto))
    // Turning a deactivated listing back on is not "publishing": the button, the confirm's title and button say so.
    expect(screen.queryByRole('button', { name: 'Оновити й опублікувати' })).toBeNull()
    const btn = screen.getByRole('button', { name: 'Оновити й увімкнути' })
    expect(btn).toHaveAccessibleDescription(/безкоштовно/)
    await click(btn)
    const ask = screen.getByRole('alertdialog')
    expect(within(ask).getByRole('heading', { name: 'Оновити й увімкнути' })).toBeInTheDocument()
    expect(ask).toHaveTextContent('Оновити й знову ввімкнути товар?')
    expect(ask).toHaveTextContent('безкоштовно')
    expect(ask).not.toHaveTextContent('$0,20')
    await confirmWith('Оновити й увімкнути')
    expect(api.sendDraft).toHaveBeenCalledWith(4, true, { expectedUpdatedAt: expect.any(Number) })
  })

  it('published: updating keeps the publish rules (a photo is needed)', async () => {
    await openDraft(linked(4, { state: 'active', url: 'https://www.etsy.com/listing/77' }))
    expect(screen.getByTestId('create-problems')).toHaveTextContent('Щоб оновити опублікований товар на Etsy, ще потрібно:')
    expect(screen.getByRole('button', { name: 'Оновити на Etsy' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Оновити й опублікувати' })).toBeNull()
  })

  it('changed on Etsy too: a callout warns; the send answers "conflict" → asked → sent again with overwrite', async () => {
    const conflict: CreateListingResult = {
      ok: false,
      listingId: 77,
      conflict: true,
      error: 'На Etsy цей товар змінили після останньої синхронізації (24.10.2026, 10:00). Надіслати все одно й перезаписати ті зміни?'
    }
    api.sendDraft.mockResolvedValueOnce(conflict).mockResolvedValueOnce({ ok: true, listingId: 77, published: false, warnings: [], updated: true })
    await openDraft(linked(4, { dirty: true, changedOnEtsy: true }, { status: 'changed' }))
    expect(screen.getByText('Товар змінили і на Etsy')).toBeInTheDocument()
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    const ask = screen.getByRole('alertdialog')
    expect(ask).toHaveTextContent('Перезаписати зміни, зроблені на Etsy?')
    expect(ask).toHaveTextContent('(24.10.2026, 10:00)')
    await confirmWith('Перезаписати на Etsy')
    expect(api.sendDraft).toHaveBeenNthCalledWith(1, 4, false, { expectedUpdatedAt: expect.any(Number) })
    expect(api.sendDraft).toHaveBeenNthCalledWith(2, 4, false, { overwrite: true })
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('Товар на Etsy оновлено')
  })

  it('a conflict declined: nothing overwritten, a note says so', async () => {
    api.sendDraft.mockResolvedValueOnce({ ok: false, listingId: 77, conflict: true, error: 'На Etsy цей товар змінили…' })
    await openDraft(linked(4))
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    await click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Скасувати' }))
    expect(api.sendDraft).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('draft-notes')).toHaveTextContent('Товар на Etsy не змінено')
    expect(screen.queryByTestId('draft-sent')).toBeNull()
  })

  it('the notes under the form are scrolled into view when they appear (the send may start at the top)', async () => {
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    try {
      api.sendDraft.mockResolvedValueOnce({ ok: false, listingId: 77, conflict: true, error: 'На Etsy цей товар змінили…' })
      await openDraft(linked(4))
      expect(scroll).not.toHaveBeenCalled()
      await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
      await confirmWith('Оновити на Etsy')
      await click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Скасувати' }))
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' })
      expect(scroll.mock.contexts.at(-1)).toContainElement(screen.getByTestId('draft-notes'))
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    }
  })

  it('notes of the send are shown (e.g. prices set in variations)', async () => {
    const note = 'Ціна й кількість у цього товару задані у варіаціях — змініть їх у «Ціни й залишки».'
    api.sendDraft.mockResolvedValue({ ok: true, listingId: 77, published: false, warnings: [], updated: true, notes: [note] })
    await openDraft(linked(4))
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    expect(screen.getByTestId('draft-notes')).toHaveTextContent(note)
    expect(screen.getByTestId('draft-sent')).toBeInTheDocument()
  })

  it('a failed update is said in the save bar', async () => {
    api.sendDraft.mockResolvedValue({ ok: false, listingId: 77, error: 'Не вдалося оновити ціну й кількість: HTTP 500' })
    await openDraft(linked(4))
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Не вдалося оновити товар на Etsy')
    expect(alert).toHaveTextContent('HTTP 500')
    expect(alert.closest('.my-savebar')).not.toBeNull()
  })

  it('deleted on Etsy (learned by a send): the error says so and the draft shows it is gone', async () => {
    api.sendDraft.mockResolvedValue({ ok: false, listingId: 77, removedOnEtsy: true, error: 'Цей товар видалено на Etsy, тож оновити його не вийде.' })
    api.listDrafts.mockResolvedValue([linked(4, { state: 'removed', removed: true }, { status: 'error', lastError: 'Цей товар видалено на Etsy…' })])
    await openDraft(linked(4))
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    expect(screen.getByText('Товару на Etsy більше немає')).toBeInTheDocument()
    expect(screen.getByText('Цей товар видалено на Etsy')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Оновити на Etsy' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Надіслати як новий товар' })).toBeInTheDocument()
  })

  it('deleted on Etsy: "Надіслати як новий товар" → confirm → save, unlink, send as a new Etsy draft', async () => {
    const remote = file(62, 2, 'Big.zip', { remote: true, onEtsy: true })
    api.unlinkDraft.mockResolvedValue({ ok: true, value: mkDraft(4, { notes: ['Файл «Big.zip» був лише на Etsy — його прибрано з чернетки.'] }) })
    api.sendDraft.mockResolvedValue({ ok: true, listingId: 5555, published: false, warnings: [] })
    api.listDrafts.mockResolvedValue([mkDraft(4, { status: 'sent', sentListingId: 5555, sentPublished: false })])
    api.saveDraft.mockImplementation(async (input) => ({
      ok: true,
      value: linked(4, { state: 'removed', removed: true }, { fields: input.fields, files: [file(61, 1, 'Plan.pdf'), remote] })
    }))
    await openDraft(linked(4, { state: 'removed', removed: true }, { files: [file(61, 1, 'Plan.pdf'), remote] }))
    expect(screen.queryByTestId('draft-etsy-links')).toBeNull()
    await click(screen.getByRole('button', { name: 'Надіслати як новий товар' }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Товару № 77 на Etsy більше немає')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('без плати')
    await confirmWith('Надіслати як новий')
    expect(api.saveDraft).toHaveBeenCalled()
    expect(api.unlinkDraft).toHaveBeenCalledWith(4)
    expect(api.sendDraft).toHaveBeenCalledWith(4, false, { expectedUpdatedAt: expect.any(Number) })
    expect(api.unlinkDraft.mock.invocationCallOrder[0]).toBeLessThan(api.sendDraft.mock.invocationCallOrder[0])
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('Надіслано на Etsy: товар № 5555 (чернетка на Etsy)')
    expect(screen.getByTestId('draft-notes')).toHaveTextContent('Файл «Big.zip» був лише на Etsy')
    expect(within(screen.getByTestId('draft-link')).getByText('№ 5555')).toBeInTheDocument()
  })

  it('unlinking leaves it incomplete (its Etsy-only files are gone): nothing is sent, the note says what is missing', async () => {
    api.unlinkDraft.mockResolvedValue({ ok: true, value: mkDraft(4, { problems: ['Додайте хоча б один файл для покупця.'], notes: ['Файл «Big.zip» прибрано.'] }) })
    await openDraft(linked(4, { state: 'removed', removed: true }))
    await click(screen.getByRole('button', { name: 'Надіслати як новий товар' }))
    await confirmWith('Надіслати як новий')
    expect(api.sendDraft).not.toHaveBeenCalled()
    expect(screen.getByTestId('draft-notes')).toHaveTextContent('Файл «Big.zip» прибрано.')
    expect(screen.getByTestId('draft-notes')).toHaveTextContent('ще потрібно: Додайте хоча б один файл для покупця.')
    // Unlinked now: the usual first-send buttons.
    expect(screen.getByRole('button', { name: 'Надіслати на Etsy як чернетку' })).toBeInTheDocument()
  })

  it('a failed unlink is said and nothing is sent', async () => {
    api.unlinkDraft.mockResolvedValue({ ok: false, error: 'Чернетки #4 немає.' })
    await openDraft(linked(4, { state: 'removed', removed: true }))
    await click(screen.getByRole('button', { name: 'Надіслати як новий товар' }))
    await confirmWith('Надіслати як новий')
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося від’єднати чернетку від Etsy')
    expect(api.sendDraft).not.toHaveBeenCalled()
  })

  it('a buyer file that is only on Etsy: "лише на Etsy" (explained), no download, can be removed', async () => {
    await openDraft(linked(4, {}, { files: [file(61, 1, 'Plan.pdf', { onEtsy: true }), file(62, 2, 'Big.zip', { remote: true, onEtsy: true, size: 5 * 1024 * 1024 })] }))
    const row = screen.getByText('Big.zip').closest('li') as HTMLElement
    expect(within(row).getByText('лише на Etsy')).toHaveAccessibleDescription(GLOSSARY['myshop.remoteFile'].short)
    expect(within(row).queryByRole('button', { name: /Завантажити/ })).toBeNull()
    expect(row).toHaveTextContent('5,0 МБ')
    expect(screen.getByRole('button', { name: 'Завантажити файл «Plan.pdf»' })).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Прибрати: Big.zip' }))
    await click(screen.getByRole('button', { name: 'Зберегти в програмі' }))
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ files: [{ mediaId: 61 }] }))
  })

  it('a pull that changes the open draft (drafts:changed) updates its strip', async () => {
    await openDraft(linked(4))
    expect(screen.queryByText('Товар змінили і на Etsy')).toBeNull()
    act(() => useStore.getState().setDrafts([linked(4, { changedOnEtsy: true, dirty: true }, { status: 'changed' })]))
    expect(screen.getByText('Товар змінили і на Etsy')).toBeInTheDocument()
    expect(within(screen.getByTestId('draft-link')).getByText('змінено на Etsy')).toBeInTheDocument()
  })
})

describe('deleting a linked draft', () => {
  const openMenu = () => click(within(screen.getByTestId('draft-form')).getByRole('button', { name: 'Видалити' }))

  it('a menu: only in the app, or on Etsy too', async () => {
    await openDraft(linked(4))
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /Видалити лише в програмі/ })).toHaveTextContent('Товар на Etsy лишиться як є.')
    expect(screen.getByRole('menuitem', { name: /Видалити і на Etsy/ })).toHaveTextContent(GLOSSARY['myshop.deleteOnEtsy'].short)
  })

  it('only in the app: asks (the Etsy listing stays) → deleteDraft(id) → the list', async () => {
    useStore.setState({ draftsView: 'list' })
    await openDraft(linked(4))
    await openMenu()
    await click(screen.getByRole('menuitem', { name: /Видалити лише в програмі/ }))
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Товар № 77 на Etsy лишиться як є.')
    await confirmWith('Видалити з програми')
    expect(api.deleteDraft).toHaveBeenCalledWith(4)
    expect(useStore.getState().draftsView).toBe('list')
  })

  it('on Etsy too: a red confirm that it cannot be undone → deleteDraft(id, {onEtsy: true})', async () => {
    await openDraft(linked(4))
    await openMenu()
    await click(screen.getByRole('menuitem', { name: /Видалити і на Etsy/ }))
    const ask = screen.getByRole('alertdialog')
    expect(ask).toHaveTextContent('Видалити товар і на Etsy?')
    expect(ask).toHaveTextContent('Цього не можна скасувати.')
    await confirmWith('Видалити назавжди')
    expect(api.deleteDraft).toHaveBeenCalledWith(4, { onEtsy: true })
    expect(useStore.getState().draftsView).toBe('list')
  })

  it('a failed delete on Etsy keeps the draft open and says why', async () => {
    api.deleteDraft.mockResolvedValue({ ok: false, error: 'Вхід не має дозволу видаляти товари — увійдіть ще раз.' })
    await openDraft(linked(4))
    await openMenu()
    await click(screen.getByRole('menuitem', { name: /Видалити і на Etsy/ }))
    await confirmWith('Видалити назавжди')
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося видалити товар на Etsy')
    expect(screen.getByRole('alert')).toHaveTextContent('увійдіть ще раз')
    expect(useStore.getState().draftsView).toEqual({ draftId: 4 })
  })

  it('deleted on Etsy already: just "Видалити" (in the app)', async () => {
    await openDraft(linked(4, { state: 'removed', removed: true }))
    await click(within(screen.getByTestId('draft-form')).getByRole('button', { name: 'Видалити' }))
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Видалити цю чернетку з програми?')
    await confirmWith('Видалити чернетку')
    expect(api.deleteDraft).toHaveBeenCalledWith(4)
  })
})

describe('a linked draft changed meanwhile, and what each send says', () => {
  it('an unedited form shows a newer version pushed meanwhile (e.g. a pull); sending it saves nothing and sends that version', async () => {
    const d = linked(4, {}, withPhoto)
    await openDraft(d)
    expect(screen.getByLabelText(/^Назва/)).toHaveValue(d.fields.title)
    const pulled = { ...d, updatedAt: d.updatedAt + 5000, fields: { ...d.fields, title: 'Renamed on Etsy' } }
    await act(async () => useStore.setState({ drafts: [pulled] }))
    expect(screen.getByLabelText(/^Назва/)).toHaveValue('Renamed on Etsy')
    api.sendDraft.mockResolvedValue({ ok: true, listingId: 77, published: false, state: 'draft', warnings: [], updated: true })
    api.listDrafts.mockResolvedValue([pulled])
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    expect(api.saveDraft).not.toHaveBeenCalled()
    expect(api.sendDraft).toHaveBeenCalledWith(4, false, { expectedUpdatedAt: pulled.updatedAt })
  })

  it('an edited form and a newer version: warned; saving asks before writing over it', async () => {
    const d = linked(4, {}, withPhoto)
    await openDraft(d)
    fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Mine' } })
    const pulled = { ...d, updatedAt: d.updatedAt + 5000, fields: { ...d.fields, title: 'Renamed on Etsy' } }
    await act(async () => useStore.setState({ drafts: [pulled] }))
    expect(screen.getByLabelText(/^Назва/)).toHaveValue('Mine') // the user's typing is never replaced
    expect(screen.getByText('Чернетку змінили, поки ви її редагували')).toBeInTheDocument()
    api.saveDraft
      .mockResolvedValueOnce({ ok: false, stale: true, error: 'Поки чернетка була відкрита, її змінили.' })
      .mockImplementationOnce(async (input) => ({ ok: true, value: { ...pulled, updatedAt: pulled.updatedAt + 1, fields: input.fields } }))
    await click(screen.getByRole('button', { name: 'Зберегти в програмі' }))
    expect(api.saveDraft).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 4, expectedUpdatedAt: d.updatedAt }))
    const ask = screen.getByRole('alertdialog')
    expect(ask).toHaveTextContent('Записати ваші зміни поверх?')
    await confirmWith('Записати мої зміни')
    expect(api.saveDraft).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ expectedUpdatedAt: expect.anything() }))
    expect(api.saveDraft.mock.calls[1][0].fields.title).toBe('Mine')
  })

  it('declining keeps the form and saves nothing', async () => {
    const d = linked(4, {}, withPhoto)
    await openDraft(d)
    fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Mine' } })
    api.saveDraft.mockResolvedValueOnce({ ok: false, stale: true, error: 'x' })
    await click(screen.getByRole('button', { name: 'Зберегти в програмі' }))
    await click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Скасувати' }))
    expect(api.saveDraft).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Чернетку не збережено')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Назва/)).toHaveValue('Mine')
  })

  it('a send refused as stale says so and sends nothing else', async () => {
    const d = linked(4, {}, withPhoto)
    await openDraft(d)
    api.sendDraft.mockResolvedValueOnce({ ok: false, stale: true, listingId: 77, error: 'Поки чернетка була відкрита, її змінили. Нічого не надіслано.' })
    api.listDrafts.mockResolvedValue([d])
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    expect(api.sendDraft).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Чернетку змінили')).toBeInTheDocument()
    expect(screen.queryByTestId('draft-sent')).toBeNull()
  })

  it('updating an active listing is "оновлено" (not "опубліковано"); an inactive one updated stays off and says where it is', async () => {
    const act1 = linked(4, { state: 'active', url: 'https://www.etsy.com/listing/77' }, withPhoto)
    api.sendDraft.mockResolvedValue({ ok: true, listingId: 77, published: true, state: 'active', warnings: [], updated: true })
    api.listDrafts.mockResolvedValue([act1])
    await openDraft(act1)
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    const sent = screen.getByTestId('draft-sent')
    expect(within(sent).getByText('Товар на Etsy оновлено')).toBeInTheDocument()
    expect(sent).not.toHaveTextContent('опубліковано')
  })

  it('an inactive listing updated (not switched on): no "Чернетки" hint; switched on: "оновлено й увімкнено"', async () => {
    const off = linked(4, { state: 'inactive' }, withPhoto)
    api.sendDraft.mockResolvedValueOnce({ ok: true, listingId: 77, published: false, state: 'inactive', warnings: [], updated: true })
    api.listDrafts.mockResolvedValue([off])
    await openDraft(off)
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('вимкнений товар')
    expect(screen.getByTestId('draft-sent')).not.toHaveTextContent('«Чернетки»')
    api.sendDraft.mockResolvedValueOnce({ ok: true, listingId: 77, published: true, state: 'active', warnings: [], updated: true })
    await click(screen.getByRole('button', { name: 'Оновити й увімкнути' }))
    await confirmWith('Оновити й увімкнути')
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('Товар на Etsy оновлено й увімкнено')
  })

  it('a link never compared with Etsy: said in the strip; its conflict asks to overwrite the listing', async () => {
    const d = linked(4, { unverified: true, etsyUpdatedAt: null, syncedAt: null }, withPhoto)
    api.sendDraft
      .mockResolvedValueOnce({ ok: false, listingId: 77, conflict: true, error: 'Цю чернетку надіслали на Etsy старішою версією програми…' })
      .mockResolvedValueOnce({ ok: true, listingId: 77, published: false, state: 'draft', warnings: [], updated: true })
    api.listDrafts.mockResolvedValue([d])
    await openDraft(d)
    expect(screen.getByTestId('draft-unverified')).toHaveTextContent('ще не порівнювали')
    await click(screen.getByRole('button', { name: 'Оновити на Etsy' }))
    await confirmWith('Оновити на Etsy')
    const ask = screen.getByRole('alertdialog')
    expect(within(ask).getByRole('heading', { name: 'Товар ще не порівнювали з Etsy' })).toBeInTheDocument()
    await confirmWith('Перезаписати на Etsy')
    expect(api.sendDraft).toHaveBeenNthCalledWith(2, 4, false, { overwrite: true })
  })

  it('photos a pull couldn’t fetch: said in the strip', async () => {
    await openDraft(linked(4, { incomplete: true }, withPhoto))
    expect(screen.getByTestId('draft-incomplete')).toHaveTextContent('не буде видалено з Etsy')
  })

  it('a listing of another shop: warned; updating and deleting on Etsy are off', async () => {
    await openDraft(linked(4, { shopId: 111 }, withPhoto))
    expect(within(screen.getByTestId('draft-link')).getByText('Товар іншого магазину')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Оновити на Etsy' })).toBeDisabled()
    await click(screen.getByRole('button', { name: 'Видалити' }))
    expect(screen.getByRole('menuitem', { name: /Видалити і на Etsy/ })).toBeDisabled()
  })

  it('"Видалити і на Etsy" is off (with the reason) without the delete permission', async () => {
    useStore.setState({ etsyAuth: etsyIn({ scopes: ['listings_r', 'listings_w'] }) })
    await openDraft(linked(4, {}, withPhoto))
    await click(screen.getByRole('button', { name: 'Видалити' }))
    const item = screen.getByRole('menuitem', { name: /Видалити і на Etsy/ })
    expect(item).toBeDisabled()
    expect(item).toHaveTextContent('не має дозволу видаляти товари')
    expect(screen.getByRole('menuitem', { name: /Видалити лише в програмі/ })).toBeEnabled()
  })

  it('"Синхронізувати з Etsy" is off without the read permission', async () => {
    useStore.setState({ etsyAuth: etsyIn({ scopes: ['listings_w'] }) })
    await openList()
    const btn = screen.getByRole('button', { name: 'Синхронізувати з Etsy' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAccessibleDescription(/не має дозволу читати товари/)
  })
})
