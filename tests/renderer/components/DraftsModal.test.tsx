// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { DraftsModal } from '../../../src/renderer/src/components/DraftsModal'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import { ShopView } from '../../../src/renderer/src/components/ShopView'
import { useStore } from '../../../src/renderer/src/store'
import type { CreateListingProgress } from '../../../src/shared/types'
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

async function newDraft() {
  renderAll()
  await click(screen.getByText('＋ Новий лістинг'))
}

async function fillValid() {
  fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Budget Planner 2027' } })
  fireEvent.change(screen.getByLabelText('Опис'), { target: { value: 'Track your money.' } })
  fireEvent.change(screen.getByLabelText(/^Ціна/), { target: { value: '5.99' } })
  fireEvent.change(screen.getByLabelText('Категорія'), { target: { value: 'planner' } })
  await click(within(screen.getByRole('listbox', { name: 'Категорії' })).getAllByRole('option')[0])
  fireEvent.change(screen.getByLabelText(/Теги через кому/), { target: { value: 'budget, planner' } })
}

const confirm = () => click(screen.getByText('Підтвердити'))

describe('own shop header', () => {
  it('"мій", "＋ Новий лістинг", "📝 Чернетки" with the count of unsent drafts, "✏️ Керувати"', async () => {
    useStore.setState({ drafts: [mkDraft(1), mkDraft(2, { status: 'sent', sentListingId: 9 }), mkDraft(3, { source: 'mcp' })] })
    render(<ShopView />)
    expect(within(screen.getByRole('heading', { level: 1 })).getByText('мій')).toBeInTheDocument()
    expect(screen.getByText('📝 Чернетки').querySelector('.count-badge')).toHaveTextContent('2')
    fireEvent.click(screen.getByText('✏️ Керувати'))
    expect(useStore.getState().showMyShop).toBe(true)
  })

  it('other shops (or signed out) have none of it', () => {
    useStore.setState({ etsyAuth: etsyOut })
    render(<ShopView />)
    expect(screen.queryByText('мій')).toBeNull()
    expect(screen.queryByText('＋ Новий лістинг')).toBeNull()
    expect(screen.queryByText('📝 Чернетки')).toBeNull()
  })
})

describe('the drafts list', () => {
  it('shows each draft: who prepared it, status, what is missing; opens one', async () => {
    useStore.setState({
      drafts: [
        mkDraft(1, { source: 'mcp', problems: ['Виберіть категорію.', 'Опис не може бути порожнім.'] }),
        mkDraft(2, { status: 'sent', sentListingId: 4242, sentPublished: false, fields: { ...mkDraft(2).fields, title: 'Sent one' } }),
        mkDraft(3, { status: 'error', lastError: 'HTTP 400' })
      ]
    })
    renderAll()
    await click(screen.getByText('📝 Чернетки'))
    const list = screen.getByTestId('draft-list')
    const row1 = within(list).getByText('Planner 1').closest('li')!
    expect(row1).toHaveTextContent('від Claude')
    expect(row1).toHaveTextContent('чекає перевірки · ще потрібно: 2')
    expect(within(list).getByText('Sent one').closest('li')).toHaveTextContent('надіслано на Etsy (#4242)')
    expect(within(list).getByText('Planner 3').closest('li')).toHaveTextContent('не вдалося надіслати')
    await click(within(row1 as HTMLElement).getByText('Відкрити'))
    expect(screen.getByText(/Цю чернетку підготував Claude/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Назва/)).toHaveValue('Planner 1')
    await click(screen.getByText('← До чернеток'))
    expect(screen.getByTestId('draft-list')).toBeInTheDocument()
  })

  it('empty list; "＋ Нова чернетка" opens an empty editor', async () => {
    renderAll()
    await click(screen.getByText('📝 Чернетки'))
    expect(screen.getByText('Чернеток ще немає.')).toBeInTheDocument()
    await click(screen.getByText('＋ Нова чернетка'))
    expect(screen.getByRole('heading', { name: 'Новий лістинг' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Назва/)).toHaveValue('')
  })
})

describe('editing and sending a draft', () => {
  it('saving keeps it in the app (nothing sent)', async () => {
    await newDraft()
    await fillValid()
    await click(screen.getByText('Зберегти чернетку'))
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
    await click(screen.getByText('Зберегти чернетку'))
    expect(api.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ id: 501 }))
  })

  it('an incomplete draft can be saved but not sent; the checklist says why', async () => {
    await newDraft()
    fireEvent.change(screen.getByLabelText(/^Назва/), { target: { value: 'Idea' } })
    expect(screen.getByTestId('create-problems')).toHaveTextContent('Виберіть категорію.')
    expect(screen.getByText('Зберегти чернетку')).toBeEnabled()
    expect(screen.getByText('Надіслати на Etsy як чернетку')).toBeDisabled()
    expect(screen.getByText('Надіслати й опублікувати')).toBeDisabled()
  })

  it('"Надіслати на Etsy як чернетку": confirm → save → send(id, false) → the sent view', async () => {
    api.listDrafts.mockResolvedValue([mkDraft(501, { status: 'sent', sentListingId: 4242, sentPublished: false })])
    await newDraft()
    await fillValid()
    expect(screen.getByTestId('publish-problems')).toHaveTextContent('хоча б одне фото')
    await click(screen.getByText('Надіслати на Etsy як чернетку'))
    expect(screen.getByText(/Покупці її не побачать/)).toBeInTheDocument()
    await confirm()
    expect(api.saveDraft).toHaveBeenCalled()
    expect(api.sendDraft).toHaveBeenCalledWith(501, false)
    expect(screen.getByTestId('draft-sent')).toHaveTextContent('Надіслано на Etsy: лістинг #4242 (чернетка на Etsy)')
  })

  it('publishing needs a photo and a file; asks about the fee; offers a rescan', async () => {
    api.pickListingFiles.mockImplementation(async (kind) =>
      kind === 'images' ? [{ token: 't1', name: 'cover.jpg', size: 2000 }] : [{ token: 'f1', name: 'Plan.xlsx', size: 3000 }]
    )
    api.listDrafts.mockResolvedValue([mkDraft(501, { status: 'sent', sentListingId: 4242, sentPublished: true })])
    await newDraft()
    await fillValid()
    await click(screen.getByText('＋ Додати фото'))
    await click(screen.getByText('＋ Додати файли'))
    await click(screen.getByText('Надіслати й опублікувати'))
    expect(screen.getByText(/Etsy стягне звичайну плату/)).toBeInTheDocument()
    await confirm()
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ photos: [{ token: 't1' }], files: [{ token: 'f1' }] }))
    expect(api.sendDraft).toHaveBeenCalledWith(501, true)
    await click(screen.getByText('Сканувати магазин зараз'))
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
    renderAll()
    expect(screen.getByText('a.jpg').closest('li')!.querySelector('img')).toHaveAttribute('src', 'etsyimg://draft/31')
    fireEvent.click(screen.getByLabelText('Прибрати: a.jpg'))
    await click(screen.getByText('Зберегти чернетку'))
    expect(api.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 7, photos: [{ mediaId: 32 }] }))
  })

  it('a failed send shows the error; a previous failure is shown on open', async () => {
    api.sendDraft.mockResolvedValue({ ok: false, error: 'Не вдалося створити лістинг: HTTP 400' })
    useStore.setState({ drafts: [mkDraft(8, { status: 'error', lastError: 'HTTP 403' })], draftsView: { draftId: 8 } })
    renderAll()
    expect(screen.getByRole('alert')).toHaveTextContent('Минула спроба надіслати: HTTP 403')
    await click(screen.getByText('Надіслати на Etsy як чернетку'))
    await confirm()
    expect(screen.getAllByRole('alert').some((a) => a.textContent?.includes('HTTP 400'))).toBe(true)
  })

  it('a save error is shown and nothing is sent', async () => {
    api.saveDraft.mockResolvedValue({ ok: false, error: 'Фото може бути не більше 10.' })
    await newDraft()
    await fillValid()
    await click(screen.getByText('Надіслати на Etsy як чернетку'))
    await confirm()
    expect(screen.getByRole('alert')).toHaveTextContent('Фото може бути не більше 10.')
    expect(api.sendDraft).not.toHaveBeenCalled()
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
    await click(screen.getByText('Надіслати на Etsy як чернетку'))
    await confirm()
    act(() => push!({ step: 'images', done: 0, total: 2, label: 'Фото 1 з 2…' }))
    expect(screen.getByRole('status')).toHaveTextContent('Фото 1 з 2…')
    await act(async () => finish({ ok: true, listingId: 1, published: false, warnings: [] }))
  })

  it('deleting asks first', async () => {
    useStore.setState({ drafts: [mkDraft(9)], draftsView: { draftId: 9 } })
    renderAll()
    await click(within(screen.getByTestId('draft-form')).getByText('Видалити'))
    expect(screen.getByText(/Видалити цю чернетку з програми\?/)).toBeInTheDocument()
    await confirm()
    expect(api.deleteDraft).toHaveBeenCalledWith(9)
    expect(useStore.getState().draftsView).toBe('list')
  })

  it('physical: shipping/processing profiles, no files', async () => {
    await newDraft()
    await click(screen.getByLabelText('Фізичний'))
    expect(screen.getByLabelText('Кількість')).toHaveValue('1')
    expect(screen.getByLabelText('Профіль доставки')).toHaveValue('11')
    expect(screen.queryByText('＋ Додати файли')).toBeNull()
    await fillValid()
    await click(screen.getByText('Зберегти чернетку'))
    expect(api.saveDraft).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.objectContaining({ type: 'physical', quantity: 1, shippingProfileId: 11, readinessStateId: 21 }) })
    )
  })

  it('a taxonomy error is shown; Escape closes', async () => {
    api.getTaxonomy.mockResolvedValue({ ok: false, error: 'Немає з’єднання з Etsy.' })
    await newDraft()
    expect(screen.getByText('Немає з’єднання з Etsy.')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('drafts:changed from main updates the list (a draft Claude just prepared appears)', async () => {
    renderAll()
    await click(screen.getByText('📝 Чернетки'))
    act(() => useStore.getState().setDrafts([mkDraft(5, { source: 'mcp' })]))
    expect(screen.getByText('Planner 5')).toBeInTheDocument()
  })
})
