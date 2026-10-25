// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ListingCard } from '../../../src/renderer/src/components/ListingCard'
import { ListingModal } from '../../../src/renderer/src/components/ListingModal'
import { parseOurListing } from '../../../src/renderer/src/components/ListingMark'
import { useStore } from '../../../src/renderer/src/store'
import { mkDraft, mkListing, mkMark, setupRenderer } from '../helpers'

let api: ReturnType<typeof setupRenderer>
beforeEach(() => {
  api = setupRenderer()
})

/** Hover something inside the card and read its tooltip. */
function tipOf(el: HTMLElement): string {
  act(() => void fireEvent.mouseEnter(el.closest('.ui-tooltip-anchor')!))
  return screen.getAllByRole('tooltip').at(-1)!.textContent!.replace(/\s+/g, ' ')
}

describe('the mark on a card', () => {
  it('no mark: no badge', () => {
    render(<ListingCard listing={mkListing(1)} onOpen={vi.fn()} />)
    expect(screen.queryByTestId('card-mark')).toBeNull()
  })

  it('"Реалізовано" / "В роботі" on the photo, with the note, our listing and who set it in the tooltip', () => {
    const { unmount } = render(
      <ListingCard listing={mkListing(1, { mark: mkMark({ status: 'done', note: 'Своя версія в зелених тонах', ourListingId: 4242, source: 'mcp' }) })} onOpen={vi.fn()} />
    )
    const badge = screen.getByTestId('card-mark')
    expect(badge).toHaveAttribute('data-status', 'done')
    expect(badge).toHaveTextContent('Реалізовано')
    expect(badge.closest('.thumb')).not.toBeNull()
    expect(badge.querySelector('.ui-badge--accent')).not.toBeNull()
    const tip = tipOf(badge)
    expect(tip).toContain('Реалізовано')
    expect(tip).toContain('Своя версія в зелених тонах')
    expect(tip).toContain('Наш товар № 4242')
    expect(tip).toContain('Поставив Claude')
    unmount()
    render(<ListingCard listing={mkListing(2, { mark: mkMark({ status: 'in_progress' }) })} onOpen={vi.fn()} />)
    expect(screen.getByTestId('card-mark')).toHaveTextContent('В роботі')
    expect(screen.getByTestId('card-mark').querySelector('.ui-badge--info')).not.toBeNull()
    expect(tipOf(screen.getByTestId('card-mark'))).toContain('Поставили ви')
  })

  it('the quick menu (a sibling of the card button) sets a mark without opening the listing', async () => {
    const l = mkListing(1)
    useStore.setState({ listings: [l] })
    const onOpen = vi.fn()
    render(<ListingCard listing={l} onOpen={onOpen} />)
    const trigger = screen.getByRole('button', { name: 'Мітка товару: Listing 1' })
    expect(trigger.closest('button.listing-card')).toBeNull()
    act(() => trigger.click())
    expect(screen.getByRole('menuitemcheckbox', { name: 'Без мітки' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: 'В роботі' })).toHaveAttribute('aria-checked', 'false')
    await act(async () => screen.getByRole('menuitemcheckbox', { name: 'Реалізовано' }).click())
    expect(api.setListingMark).toHaveBeenCalledWith(1, { status: 'done' })
    expect(onOpen).not.toHaveBeenCalled()
    expect(useStore.getState().listings[0].mark).toMatchObject({ status: 'done' })
  })

  it('the menu checks the current mark; "Без мітки" removes it; a refusal shows the app error', async () => {
    const l = mkListing(1, { mark: mkMark({ status: 'in_progress' }) })
    useStore.setState({ listings: [l] })
    render(<ListingCard listing={l} onOpen={vi.fn()} />)
    act(() => screen.getByRole('button', { name: /Мітка товару/ }).click())
    expect(screen.getByRole('menuitemcheckbox', { name: 'В роботі' })).toHaveAttribute('aria-checked', 'true')
    await act(async () => screen.getByRole('menuitemcheckbox', { name: 'Без мітки' }).click())
    expect(api.setListingMark).toHaveBeenCalledWith(1, { status: 'none' })
    expect(useStore.getState().listings[0].mark).toBeNull()

    api.setListingMark.mockResolvedValueOnce({ ok: false, error: 'Товару № 1 немає в базі програми.' })
    act(() => screen.getByRole('button', { name: /Мітка товару/ }).click())
    await act(async () => screen.getByRole('menuitemcheckbox', { name: 'Реалізовано' }).click())
    expect(useStore.getState().error).toBe('Товару № 1 немає в базі програми.')
  })

  it('choosing the current mark again sends nothing', () => {
    const l = mkListing(1, { mark: mkMark({ status: 'done' }) })
    render(<ListingCard listing={l} onOpen={vi.fn()} />)
    act(() => screen.getByRole('button', { name: /Мітка товару/ }).click())
    act(() => screen.getByRole('menuitemcheckbox', { name: 'Реалізовано' }).click())
    expect(api.setListingMark).not.toHaveBeenCalled()
  })
})

describe('the "Мітка" block in the listing window', () => {
  const open = (over: Parameters<typeof mkListing>[1] = {}) => {
    const l = mkListing(7, over)
    useStore.setState({ listings: [l], detailListing: l })
    render(<ListingModal />)
    return within(screen.getByTestId('mark-block'))
  }

  it('unmarked: only the choice; picking "В роботі" saves it and shows the note / our listing fields', async () => {
    const b = open()
    expect(b.getByRole('radio', { name: 'Без мітки' })).toBeChecked()
    expect(b.queryByTestId('mark-note')).toBeNull()
    await act(async () => fireEvent.click(b.getByRole('radio', { name: 'В роботі' })))
    expect(api.setListingMark).toHaveBeenCalledWith(7, { status: 'in_progress' })
    expect(b.getByRole('radio', { name: 'В роботі' })).toBeChecked()
    expect(b.getByTestId('mark-note')).toBeInTheDocument()
    expect(b.getByTestId('mark-meta')).toHaveTextContent('Поставили ви')
    expect(useStore.getState().listings[0].mark).toMatchObject({ status: 'in_progress' })
    // "Без мітки" removes it again.
    await act(async () => fireEvent.click(b.getByRole('radio', { name: 'Без мітки' })))
    expect(api.setListingMark).toHaveBeenLastCalledWith(7, { status: null })
    expect(b.queryByTestId('mark-note')).toBeNull()
  })

  it('the note is saved on leaving the field (and with "Зберегти"); over 500 characters it is refused', async () => {
    const b = open({ mark: mkMark({ status: 'done', note: 'old' }) })
    const note = b.getByTestId('mark-note')
    expect(note).toHaveValue('old')
    fireEvent.change(note, { target: { value: '  нова нотатка  ' } })
    expect(b.getByRole('button', { name: 'Зберегти' })).toBeInTheDocument()
    await act(async () => fireEvent.blur(note))
    expect(api.setListingMark).toHaveBeenCalledWith(7, { status: 'done', note: 'нова нотатка' })
    expect(b.queryByRole('button', { name: 'Зберегти' })).toBeNull()

    fireEvent.change(note, { target: { value: 'ще одна' } })
    await act(async () => fireEvent.click(b.getByRole('button', { name: 'Зберегти' })))
    expect(api.setListingMark).toHaveBeenLastCalledWith(7, { status: 'done', note: 'ще одна' })

    api.setListingMark.mockClear()
    fireEvent.change(note, { target: { value: 'x'.repeat(501) } })
    expect(b.getByText('501/500')).toBeInTheDocument()
    expect(b.getByText('Можна до 500 символів.')).toBeInTheDocument()
    await act(async () => fireEvent.blur(note))
    expect(api.setListingMark).not.toHaveBeenCalled()
  })

  it('"Наш товар": an Etsy link or a number is saved as the listing id, with a link to it on Etsy; junk is refused', async () => {
    const b = open({ mark: mkMark({ status: 'done' }) })
    const our = b.getByTestId('mark-our-listing')
    fireEvent.change(our, { target: { value: 'https://www.etsy.com/listing/1803602196/budget-planner?ref=shop' } })
    await act(async () => fireEvent.blur(our))
    expect(api.setListingMark).toHaveBeenCalledWith(7, { status: 'done', ourListingId: 1803602196 })
    const link = b.getByRole('link', { name: /Відкрити наш товар на Etsy/ })
    expect(link).toHaveAttribute('href', 'https://www.etsy.com/listing/1803602196')
    act(() => link.click())
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/listing/1803602196')

    fireEvent.change(our, { target: { value: 'не посилання' } })
    await act(async () => fireEvent.keyDown(our, { key: 'Enter' }))
    expect(b.getByText('Не схоже на посилання на товар Etsy чи його номер.')).toBeInTheDocument()
    expect(api.setListingMark).toHaveBeenCalledTimes(1)

    // Emptying the field clears it.
    fireEvent.change(our, { target: { value: '' } })
    await act(async () => fireEvent.blur(our))
    expect(api.setListingMark).toHaveBeenLastCalledWith(7, { status: 'done', ourListingId: null })
  })

  it('a draft made from it: "Відкрити чернетку" closes the listing and opens that draft; a gone draft shows no button', async () => {
    useStore.setState({ drafts: [mkDraft(5)] })
    const b = open({ mark: mkMark({ status: 'in_progress', ourDraftId: 5, source: 'mcp' }) })
    expect(b.getByTestId('mark-meta')).toHaveTextContent('Поставив Claude')
    act(() => b.getByTestId('mark-open-draft').click())
    expect(useStore.getState().detailListing).toBeNull()
    expect(useStore.getState().draftsView).toEqual({ draftId: 5 })
  })

  it('no button for a draft that is not in the app any more', () => {
    useStore.setState({ drafts: [] })
    const b = open({ mark: mkMark({ status: 'in_progress', ourDraftId: 5 }) })
    expect(b.queryByTestId('mark-open-draft')).toBeNull()
  })

  it('a refused save shows the error in the block', async () => {
    api.setListingMark.mockResolvedValueOnce({ ok: false, error: 'Чернетки № 9 у програмі немає.' })
    const b = open()
    await act(async () => fireEvent.click(b.getByRole('radio', { name: 'Реалізовано' })))
    expect(b.getByRole('alert')).toHaveTextContent('Чернетки № 9 у програмі немає.')
    expect(b.getByRole('radio', { name: 'Без мітки' })).toBeChecked()
  })
})

describe('marks changed elsewhere (main pushes marks:changed)', () => {
  it('refreshes the open shop and the open listing window', async () => {
    const l = mkListing(7)
    useStore.setState({ activeShopId: 1, shops: [], listings: [l], detailListing: l })
    api.listListings.mockResolvedValue([{ ...l, mark: mkMark({ source: 'mcp' }) }])
    api.getListing.mockResolvedValue({ ...l, mark: mkMark({ source: 'mcp' }) })
    await act(() => useStore.getState().marksChanged([7]))
    expect(useStore.getState().listings[0].mark).toMatchObject({ status: 'done', source: 'mcp' })
    expect(useStore.getState().detailListing!.mark).toMatchObject({ status: 'done', source: 'mcp' })
  })

  it('ignores listings that are not shown', async () => {
    useStore.setState({ activeShopId: 1, listings: [mkListing(7)], detailListing: null })
    await act(() => useStore.getState().marksChanged([99]))
    expect(api.listListings).not.toHaveBeenCalled()
    expect(api.getListing).not.toHaveBeenCalled()
  })
})

describe('parseOurListing', () => {
  it('reads Etsy links, app references and bare numbers', () => {
    expect(parseOurListing('1803602196')).toBe(1803602196)
    expect(parseOurListing(' https://www.etsy.com/uk/listing/1803602196/x ')).toBe(1803602196)
    expect(parseOurListing('etsy-tracker://product/42/photo/7')).toBe(42)
    expect(parseOurListing('https://www.etsy.com/shop/Foo')).toBeNull()
    expect(parseOurListing('0')).toBeNull()
    expect(parseOurListing('hello')).toBeNull()
  })
})

