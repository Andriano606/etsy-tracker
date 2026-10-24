// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ListingModal } from '../../../src/renderer/src/components/ListingModal'
import { useStore } from '../../../src/renderer/src/store'
import { GLOSSARY } from '../../../src/shared/glossary'
import { mkBuyerPrice, mkListing, mkPromotion, mkReview, mkShop, setupRenderer, type Api } from '../helpers'
import { mkDetails } from '../../helpers/db'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

/** The value (dd) of a labelled row (dt) — the ⓘ next to the label is not part of the label text. */
function rowValue(root: HTMLElement, label: string): string | null {
  const dt = [...root.querySelectorAll('dt')].find((d) => d.querySelector('span')?.textContent === label)
  return dt ? dt.parentElement!.querySelector('dd')!.textContent : null
}

/** The value and the change of a popularity tile. */
function tile(testId: string): { value: string; delta: Element | null } {
  const t = screen.getByTestId(testId)
  return { value: t.querySelector('.ui-stat-value')!.textContent!.replace(/\s/g, ' '), delta: t.querySelector('.ui-stat-delta') }
}

describe('ListingModal', () => {
  it('renders the description as plain text with line breaks, never as HTML', () => {
    const description = 'Line one\nLine <b>two</b>\n<img src=x onerror="alert(1)">'
    useStore.setState({ detailListing: mkListing(1, { description }) })
    const { container } = render(<ListingModal />)
    const desc = screen.getByTestId('listing-description')
    expect(desc.textContent).toBe(description)
    expect(desc.querySelector('b')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(desc).toHaveClass('description')
  })

  it('shows price, tags, quantity and a gallery that switches images', () => {
    const l = mkListing(2, {
      tags: ['mug', 'ceramic'],
      quantity: 4,
      images: [
        { ...mkListing(2).images[0], id: 1, rank: 1, url570: 'https://i.etsystatic.com/a.jpg' },
        { ...mkListing(2).images[0], id: 2, rank: 2, url570: 'https://i.etsystatic.com/b.jpg' }
      ]
    })
    useStore.setState({ detailListing: l })
    const { container } = render(<ListingModal />)
    expect(screen.getByText('mug')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText(/20,00/)).toBeInTheDocument()
    const main = () => container.querySelector('.gallery-main img')!.getAttribute('src')
    // Images go through main's etsyimg:// protocol (MinIO copy, else the Etsy CDN).
    expect(main()).toBe('etsyimg://img/1/fullxfull')
    fireEvent.click(screen.getByLabelText('Фото 2'))
    expect(main()).toBe('etsyimg://img/2/fullxfull')
  })

  it('Відкрити на Etsy goes through main (system browser)', () => {
    useStore.setState({ detailListing: mkListing(3) })
    render(<ListingModal />)
    fireEvent.click(screen.getByText('Відкрити на Etsy'))
    expect(api.openExternal).toHaveBeenCalledWith('https://www.etsy.com/listing/3/x')
  })

  it('closes', () => {
    useStore.setState({ detailListing: mkListing(3) })
    render(<ListingModal />)
    fireEvent.click(screen.getByText('Закрити'))
    expect(useStore.getState().detailListing).toBeNull()
  })

  it('handles a listing with no images', () => {
    useStore.setState({ detailListing: mkListing(4, { images: [] }) })
    render(<ListingModal />)
    expect(screen.getByText('без фото')).toBeInTheDocument()
  })
})

describe('ListingModal: the window', () => {
  it('is a dialog named by the listing title, with the shop and the state under it; × and Escape close it', async () => {
    useStore.setState({ shops: [mkShop({ id: 1, shopName: 'CeramicStudioUA' })], detailListing: mkListing(3, { title: 'Blue mug', state: 'sold_out' }) })
    render(<ListingModal />)
    const dlg = screen.getByRole('dialog', { name: 'Blue mug' })
    expect(dlg).toHaveClass('listing-modal')
    expect(within(dlg).getByText('CeramicStudioUA')).toBeInTheDocument()
    expect(within(dlg).getByText('розпродано')).toBeInTheDocument()
    expect(within(dlg).getByText(/Дані станом на/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Закрити' })[0])
    expect(useStore.getState().detailListing).toBeNull()
    act(() => useStore.setState({ detailListing: mkListing(3) }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useStore.getState().detailListing).toBeNull()
  })

  it('a listing that left the shop says so (badge + note) instead of looking like it is on sale', () => {
    useStore.setState({ detailListing: mkListing(3, { state: 'active', removedAt: new Date(2026, 9, 20, 9, 0).getTime() }) })
    render(<ListingModal />)
    expect(screen.getByText('зник з магазину')).toBeInTheDocument()
    expect(screen.queryByText('у продажу')).toBeNull()
    expect(screen.getByText('Товар зник з магазину 20.10.2026, 09:00')).toBeInTheDocument()
  })

  it('the gallery: ‹ › and ←/→ move through the photos, a counter says where you are', () => {
    const base = mkListing(2).images[0]
    const l = mkListing(2, { images: [1, 2, 3].map((id) => ({ ...base, id, rank: id })) })
    useStore.setState({ detailListing: l })
    const { container } = render(<ListingModal />)
    const main = () => container.querySelector('.gallery-main img')!.getAttribute('src')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Наступне фото' }))
    expect(main()).toBe('etsyimg://img/2/fullxfull')
    expect(screen.getByLabelText('Фото 2')).toHaveAttribute('aria-current', 'true')
    fireEvent.keyDown(screen.getByLabelText('Фото 2'), { key: 'ArrowRight' })
    expect(main()).toBe('etsyimg://img/3/fullxfull')
    fireEvent.click(screen.getByRole('button', { name: 'Наступне фото' }))
    expect(main()).toBe('etsyimg://img/1/fullxfull') // wraps around
    fireEvent.click(screen.getByRole('button', { name: 'Попереднє фото' }))
    expect(main()).toBe('etsyimg://img/3/fullxfull')
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('←/→ work right after opening (focus is on the dialog), but not in a field, a sideways table or outside the window', () => {
    const base = mkListing(2).images[0]
    useStore.setState({ detailListing: mkListing(2, { images: [1, 2, 3].map((id) => ({ ...base, id, rank: id })) }) })
    render(<ListingModal />)
    const dlg = screen.getByRole('dialog')
    expect(dlg).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Наступне фото' })).toHaveAttribute('title', 'Наступне фото (→)')
    fireEvent.keyDown(dlg, { key: 'ArrowRight' })
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    fireEvent.keyDown(dlg, { key: 'ArrowLeft' })
    fireEvent.keyDown(dlg, { key: 'ArrowLeft' })
    expect(screen.getByText('3 / 3')).toBeInTheDocument() // wraps around
    // A field inside the window keeps its arrows (moving the caret).
    const field = document.createElement('input')
    dlg.querySelector('.lm-info')!.appendChild(field)
    fireEvent.keyDown(field, { key: 'ArrowRight' })
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
    // A key with a modifier, or one outside the window, does nothing.
    fireEvent.keyDown(dlg, { key: 'ArrowRight', altKey: true })
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('one photo: no arrows, no counter, no thumbnails', () => {
    useStore.setState({ detailListing: mkListing(2) })
    render(<ListingModal />)
    expect(screen.queryByRole('button', { name: 'Наступне фото' })).toBeNull()
    expect(screen.queryByLabelText('Фото 1')).toBeNull()
  })

  it('tags are chips; a long description is folded with "Показати весь опис", a short one is not', () => {
    const description = 'Line\n'.repeat(40)
    useStore.setState({ detailListing: mkListing(2, { tags: ['mug', 'gift'], description }) })
    const { unmount } = render(<ListingModal />)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['mug', 'gift'])
    const desc = screen.getByTestId('listing-description')
    expect(desc).toHaveClass('is-folded')
    const more = screen.getByRole('button', { name: 'Показати весь опис' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(more)
    expect(desc).not.toHaveClass('is-folded')
    expect(screen.getByRole('button', { name: 'Згорнути опис' })).toHaveAttribute('aria-expanded', 'true')
    unmount()
    useStore.setState({ detailListing: mkListing(3, { description: 'Short' }) })
    render(<ListingModal />)
    expect(screen.getByTestId('listing-description')).not.toHaveClass('is-folded')
    expect(screen.queryByRole('button', { name: 'Показати весь опис' })).toBeNull()
  })

  it('an empty description says so', () => {
    useStore.setState({ detailListing: mkListing(2, { description: '  ' }) })
    render(<ListingModal />)
    expect(screen.getByTestId('listing-description')).toHaveTextContent('Продавець не додав опису.')
  })

  it('the history sections explain themselves while closed and show what they hold', () => {
    useStore.setState({ detailListing: mkListing(2, { reviewCount: 3, reviewAvg: 5 }) })
    const { container } = render(<ListingModal />)
    expect(container.querySelector('details.price-details > summary')).toHaveTextContent(GLOSSARY['listing.priceHistory'].short)
    expect(container.querySelector('details.stats-details > summary')).toHaveTextContent(GLOSSARY['listing.popularityHistory'].short)
    expect(container.querySelector('details.raw-json > summary')).toHaveTextContent(GLOSSARY['listing.advanced'].short)
    for (const d of container.querySelectorAll('details')) expect(d.open).toBe(false)
  })
})

describe('ListingModal: popularity, details, raw JSON', () => {
  it('shows favorers / views with growth and the featured rank as explained tiles', () => {
    useStore.setState({
      detailListing: mkListing(5, { numFavorers: 1530, favorersDelta: 12, views: 20000, viewsDelta: -1, featuredRank: 2 })
    })
    render(<ListingModal />)
    const fav = tile('fact-favorers')
    expect(fav.value).toBe('1 530')
    expect(fav.delta).toHaveTextContent('+12')
    expect(fav.delta).toHaveClass('is-up')
    const views = tile('fact-views')
    expect(views.value).toBe('20 000')
    expect(views.delta).toHaveTextContent('−1')
    expect(views.delta).toHaveClass('is-down')
    expect(tile('fact-featured').value).toBe('№ 2')
    // Every tile explains itself (glossary ⓘ).
    expect(screen.getByRole('button', { name: 'Що таке «Обране»?' })).toHaveAccessibleDescription(GLOSSARY.favorites.short)
    expect(screen.getByRole('button', { name: 'Що таке «Перегляди»?' })).toHaveAccessibleDescription(GLOSSARY.views.short)
    expect(screen.getByRole('button', { name: `Що таке «${GLOSSARY.featuredRank.term}»?` })).toHaveAccessibleDescription(GLOSSARY.featuredRank.short)
  })

  it('no change → no delta; no featured position → no tile; the stock is always shown', () => {
    useStore.setState({ detailListing: mkListing(5, { numFavorers: 3, favorersDelta: 0, views: null, featuredRank: -1, quantity: 7 }) })
    render(<ListingModal />)
    expect(tile('fact-favorers').delta).toBeNull()
    expect(screen.queryByTestId('fact-views')).toBeNull()
    expect(screen.queryByTestId('fact-featured')).toBeNull()
    expect(tile('fact-quantity').value).toBe('7')
  })

  it('a "Деталі" section lists materials, who/when made, processing time, dimensions, personalization', () => {
    useStore.setState({
      detailListing: mkListing(6, {
        state: 'active',
        details: mkDetails({
          materials: ['stoneware', 'glaze'],
          whoMade: 'i_did',
          whenMade: 'made_to_order',
          processingMin: 1,
          processingMax: 3,
          itemWeight: 0.4,
          itemWeightUnit: 'kg',
          itemLength: 12,
          itemWidth: 9,
          itemDimensionsUnit: 'cm',
          isPersonalizable: true,
          personalization: [
            { questionId: 1, text: 'Name to engrave', instructions: 'Up to 20 chars', type: 'text_input', required: true, maxChars: 20, maxFiles: null, options: [] }
          ]
        })
      })
    })
    render(<ListingModal />)
    const d = screen.getByTestId('listing-details')
    expect(rowValue(d, 'Матеріали')).toBe('stoneware, glaze')
    expect(rowValue(d, 'Хто зробив')).toBe('сам продавець')
    expect(rowValue(d, 'Коли зроблено')).toBe('на замовлення')
    expect(rowValue(d, 'Час на підготовку')).toBe('1–3 дн.')
    expect(rowValue(d, 'Вага')).toBe('0,4 кг')
    expect(rowValue(d, 'Розміри')).toBe('12 × 9 × ? см')
    expect(rowValue(d, 'Персоналізація')).toBe('так')
    expect(rowValue(d, 'Тип товару')).toBe('фізичний (надсилають поштою)')
    expect(rowValue(d, 'Мова опису')).toMatch(/^англійська/)
    expect(d).toHaveTextContent('Name to engrave')
    expect(within(d).getByText('обовʼязково')).toBeInTheDocument()
    expect(within(d).getByText('Up to 20 chars')).toBeInTheDocument()
    // Plain-language explanations from the glossary next to the labels.
    expect(within(d).getByRole('button', { name: 'Що таке «Хто зробив»?' })).toHaveAccessibleDescription(GLOSSARY.whoMade.short)
    expect(within(d).getByRole('button', { name: 'Що таке «Час на підготовку»?' })).toHaveAccessibleDescription(
      GLOSSARY.processingTime.short
    )
    // No API jargon in the visible labels.
    expect(d.textContent).not.toMatch(/taxonomy|supply\)|SKU,/)
  })

  it('Etsy’s internal numbers are not among the details but under "Для досвідчених"', () => {
    useStore.setState({
      detailListing: mkListing(6, { details: mkDetails({ taxonomyId: 1874, shopSectionId: 40, shippingProfileId: 77, returnPolicyId: 1 }) })
    })
    render(<ListingModal />)
    expect(rowValue(screen.getByTestId('listing-details'), 'Номер категорії')).toBeNull()
    const adv = screen.getByTestId('listing-advanced')
    expect(adv.querySelector('summary')).toHaveTextContent('Для досвідчених: технічні дані')
    expect(rowValue(adv, 'Номер товару')).toBe('6')
    expect(rowValue(adv, 'Номер категорії')).toBe('1874')
    expect(rowValue(adv, 'Номер розділу магазину')).toBe('40')
    expect(rowValue(adv, 'Номер профілю доставки')).toBe('77')
    expect(rowValue(adv, 'Номер правил повернення')).toBe('1')
  })

  it('dates say what each one means: on Etsy vs. seen by the app', () => {
    const seen = new Date(2026, 9, 5, 14, 30).getTime()
    useStore.setState({
      detailListing: mkListing(6, {
        firstSeenAt: seen,
        lastSeenAt: seen,
        etsyCreatedAt: Date.UTC(2026, 8, 1, 12) / 1000,
        details: mkDetails({ originalCreatedAt: Date.UTC(2022, 10, 29, 12) / 1000, endingAt: Date.UTC(2027, 1, 23, 12) / 1000 })
      })
    })
    render(<ListingModal />)
    const dates = screen.getByTestId('listing-dates')
    expect(rowValue(dates, 'Уперше виставлено на Etsy')).toBe('29.11.2022')
    expect(rowValue(dates, 'Розміщено або поновлено')).toBe('01.09.2026')
    expect(rowValue(dates, 'Розміщення діє до')).toBe('23.02.2027')
    expect(rowValue(dates, 'Програма вперше побачила')).toBe('05.10.2026, 14:30')
    expect(within(dates).getByRole('button', { name: 'Що таке «Програма вперше побачила»?' })).toHaveAccessibleDescription(
      GLOSSARY['listing.firstSeen'].short
    )
    // An active listing: "Останнє сканування", explained as such.
    expect(rowValue(dates, 'Останнє сканування')).toBe('05.10.2026, 14:30')
    expect(within(dates).getByRole('button', { name: 'Що таке «Останнє сканування»?' })).toHaveAccessibleDescription(
      GLOSSARY['listing.lastScan'].short
    )
  })

  it('a removed listing: "Востаннє був у магазині", with its own explanation', () => {
    const seen = new Date(2026, 9, 5, 14, 30).getTime()
    useStore.setState({ detailListing: mkListing(6, { lastSeenAt: seen, removedAt: seen + 86_400_000 }) })
    render(<ListingModal />)
    const dates = screen.getByTestId('listing-dates')
    expect(rowValue(dates, 'Останнє сканування')).toBeNull()
    expect(rowValue(dates, 'Востаннє був у магазині')).toBe('05.10.2026, 14:30')
    expect(within(dates).getByRole('button', { name: 'Що таке «Востаннє був у магазині»?' })).toHaveAccessibleDescription(
      GLOSSARY['listing.lastSeen'].short
    )
  })

  it('a pre-v2 listing (no details) shows no details section', () => {
    useStore.setState({ detailListing: mkListing(7, { details: null }) })
    render(<ListingModal />)
    expect(screen.queryByTestId('listing-details')).toBeNull()
  })

  it('the raw JSON viewer loads the stored API object only when opened', async () => {
    api.getListingRaw.mockResolvedValue('{"listing_id":8,"views":12}')
    useStore.setState({ detailListing: mkListing(8) })
    const { container } = render(<ListingModal />)
    expect(api.getListingRaw).not.toHaveBeenCalled()
    const details = container.querySelector('details.raw-json') as HTMLDetailsElement
    expect(screen.queryByTestId('raw-json')).toBeNull()
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(api.getListingRaw).toHaveBeenCalledWith(8)
    expect(await screen.findByTestId('raw-json')).toHaveTextContent('"views": 12')
    // The internal numbers are listed in one column.
    expect(screen.getByTestId('listing-advanced').querySelector('dl')).toHaveClass('lm-rows--ids')
  })

  it('technical data failing to load says so and retries (never stuck on "Завантаження…")', async () => {
    api.getListingRaw.mockRejectedValueOnce(new Error('ipc down')).mockResolvedValueOnce('{"views":3}')
    useStore.setState({ detailListing: mkListing(8) })
    const { container } = render(<ListingModal />)
    const details = container.querySelector('details.raw-json') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(await screen.findByTestId('raw-json-failed')).toHaveTextContent('Не вдалося завантажити технічні дані.')
    expect(screen.queryByTestId('raw-json')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }))
    })
    expect(await screen.findByTestId('raw-json')).toHaveTextContent('"views": 3')
    expect(screen.queryByTestId('raw-json-failed')).toBeNull()
    expect(api.getListingRaw).toHaveBeenCalledTimes(2)
  })

  it('the popularity history failing to load says so and retries', async () => {
    api.getListingStats.mockRejectedValueOnce(new Error('ipc down')).mockResolvedValueOnce([])
    useStore.setState({ detailListing: mkListing(9) })
    const { container } = render(<ListingModal />)
    const details = container.querySelector('details.stats-details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(await screen.findByTestId('stats-history-failed')).toHaveTextContent('Не вдалося завантажити історію популярності.')
    expect(screen.queryByText('Завантаження…')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }))
    })
    expect(await screen.findByText('Ще немає даних — вони з’являються після кожного сканування.')).toBeInTheDocument()
    expect(screen.queryByTestId('stats-history-failed')).toBeNull()
  })

  it('the popularity history (listing_stats per scan) loads only when opened, newest first', async () => {
    api.getListingStats.mockResolvedValue([
      { scanId: 1, at: null, views: 100, numFavorers: 5, featuredRank: -1, quantity: 3 },
      { scanId: 2, at: null, views: 140, numFavorers: 9, featuredRank: 2, quantity: 2 }
    ])
    useStore.setState({ detailListing: mkListing(9) })
    const { container } = render(<ListingModal />)
    expect(api.getListingStats).not.toHaveBeenCalled()
    const details = container.querySelector('details.stats-details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(api.getListingStats).toHaveBeenCalledWith(9)
    const rows = (await screen.findByTestId('stats-history')).querySelectorAll('tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('#2')
    expect(rows[0]).toHaveTextContent('140')
    expect(rows[0].children[3].textContent).toBe('№ 2')
    expect(rows[1]).toHaveTextContent('#1')
    expect(rows[1]).toHaveTextContent('—')
    // Every column explains itself.
    const table = screen.getByTestId('stats-history')
    expect(within(table).getByRole('button', { name: `Що таке «${GLOSSARY.featuredRank.term}»?` })).toHaveAccessibleDescription(
      GLOSSARY.featuredRank.short
    )
    expect(within(table).getByRole('button', { name: `Що таке «${GLOSSARY.views.term}»?` })).toHaveAccessibleDescription(GLOSSARY.views.short)
  })
})

describe('ListingModal: reviews', () => {
  const open = async (container: HTMLElement) => {
    const details = container.querySelector('details.reviews-details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
  }

  it('shows ⭐ avg (count) +N in the facts; the "Відгуки" section loads lazily, a page at a time', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) =>
      mkReview(100 - i, { text: `Text ${100 - i}`, language: 'de', origin: i === 0 ? 'new' : 'backfill' })
    )
    api.getListingReviews
      .mockResolvedValueOnce({ total: 25, offset: 0, reviews: page1 })
      .mockResolvedValueOnce({ total: 25, offset: 20, reviews: [mkReview(80, { text: 'Oldest one' })] })
    useStore.setState({ detailListing: mkListing(1, { reviewCount: 25, reviewAvg: 4.6, reviewsNew: 1 }) })
    const { container } = render(<ListingModal />)
    const reviews = tile('fact-reviews')
    expect(reviews.value).toBe('25')
    expect(reviews.delta).toHaveTextContent('+1 нових')
    expect(screen.getByTestId('fact-reviews')).toHaveTextContent('оцінка 4,6 з 5')
    // The section's summary: its count and average, and what it is.
    const summary = container.querySelector('details.reviews-details > summary')!
    expect(summary.querySelector('.feature-summary-label')).toHaveTextContent('Збережені відгуки')
    expect(summary.textContent!.replace(/\s+/g, ' ')).toContain('25 · 4,6')
    expect(summary).toHaveTextContent(GLOSSARY['listing.reviewsSection'].short)
    expect(api.getListingReviews).not.toHaveBeenCalled()
    await open(container)
    expect(api.getListingReviews).toHaveBeenCalledWith(1, 0, 20)
    const items = await screen.findAllByTestId('review-item')
    expect(items).toHaveLength(20)
    expect(items[0]).toHaveTextContent('Text 100')
    expect(items[0]).toHaveTextContent('німецька') // the language by name, not "de"
    expect(items[0]).toHaveTextContent('новий')
    await act(async () => {
      fireEvent.click(screen.getByText(/Показати ще \(5\)/))
    })
    expect(api.getListingReviews).toHaveBeenLastCalledWith(1, 20, 20)
    expect(screen.getAllByTestId('review-item')).toHaveLength(21)
    expect(screen.getByText('Oldest one')).toBeInTheDocument()
  })

  it('"Показати ще" skips reviews already shown (a sync inserted newer ones meanwhile)', async () => {
    const page1 = Array.from({ length: 20 }, (_, i) => mkReview(100 - i, { text: `Text ${100 - i}` }))
    // One new review arrived at the top: review 81 (the last shown) comes back first.
    const page2 = [mkReview(81, { text: 'Text 81' }), mkReview(80, { text: 'Text 80' })]
    api.getListingReviews
      .mockResolvedValueOnce({ total: 22, offset: 0, reviews: page1 })
      .mockResolvedValueOnce({ total: 23, offset: 20, reviews: page2 })
    useStore.setState({ detailListing: mkListing(1, { reviewCount: 22, reviewAvg: 4.6 }) })
    const { container } = render(<ListingModal />)
    await open(container)
    await screen.findAllByTestId('review-item')
    await act(async () => {
      fireEvent.click(screen.getByText(/Показати ще/))
    })
    const texts = screen.getAllByTestId('review-item').map((li) => li.querySelector('.review-text')!.textContent)
    expect(texts).toHaveLength(21)
    expect(new Set(texts).size).toBe(21)
    expect(texts.at(-1)).toBe('Text 80')
  })

  it('a failed reviews load says so and can be retried (never stuck on "Завантаження…")', async () => {
    api.getListingReviews
      .mockRejectedValueOnce(new Error('ipc failed'))
      .mockResolvedValueOnce({ total: 1, offset: 0, reviews: [mkReview(5, { text: 'Back again' })] })
    useStore.setState({ detailListing: mkListing(1, { reviewCount: 1, reviewAvg: 5 }) })
    const { container } = render(<ListingModal />)
    await open(container)
    expect(await screen.findByText(/Не вдалося завантажити відгуки/)).toBeInTheDocument()
    expect(screen.queryByText('Завантаження…')).toBeNull()
    await act(async () => {
      fireEvent.click(screen.getByText('Спробувати ще'))
    })
    expect(await screen.findByText('Back again')).toBeInTheDocument()
  })

  it('review text is plain text with its line breaks; the photo goes through etsyimg://review', async () => {
    const text = 'Great!\nSecond line <b>bold</b><img src=x onerror="alert(1)">'
    api.getListingReviews.mockResolvedValue({ total: 1, offset: 0, reviews: [mkReview(5, { text, hasImage: true, rating: 3 })] })
    useStore.setState({ detailListing: mkListing(2, { reviewCount: 1, reviewAvg: 3 }) })
    const { container } = render(<ListingModal />)
    await open(container)
    const item = await screen.findByTestId('review-item')
    const body = item.querySelector('.review-text')!
    expect(body.textContent).toBe(text)
    expect(body.querySelector('b')).toBeNull()
    expect(container.querySelector('img[src="x"]')).toBeNull()
    expect(item.querySelector('img.review-photo')!.getAttribute('src')).toBe('etsyimg://review/5/fullxfull')
    // The rating: five star icons, three of them filled, read as one image.
    const stars = within(item).getByRole('img', { name: 'Оцінка 3 з 5' })
    expect(stars.querySelectorAll('svg.is-on')).toHaveLength(3)
    expect(stars.querySelectorAll('svg.is-off')).toHaveLength(2)
  })

  it('a partial history says so; a never-synced shop has no reviews section', async () => {
    useStore.setState({ detailListing: mkListing(3, { reviewCount: 4, reviewAvg: 5, reviewsPartial: true }) })
    const { container, unmount } = render(<ListingModal />)
    expect(tile('fact-reviews').value).toBe('≥ 4')
    expect(within(screen.getByTestId('fact-reviews')).getByRole('button')).toHaveAccessibleDescription(GLOSSARY.reviewsPartial.short)
    await open(container)
    expect(await screen.findByText('Історія відгуків магазину ще завантажується — показано не всі.')).toBeInTheDocument()
    unmount()
    useStore.setState({ detailListing: mkListing(4, { reviewCount: null }) })
    const r2 = render(<ListingModal />)
    expect(r2.container.querySelector('details.reviews-details')).toBeNull()
    expect(screen.queryByTestId('fact-reviews')).toBeNull()
  })

  it('the popularity history has the review count per scan ("≥" while partial)', async () => {
    api.getListingStats.mockResolvedValue([
      { scanId: 1, at: null, views: 1, numFavorers: 1, featuredRank: null, quantity: 1, reviewCount: 10, reviewAvg: 4.5, reviewsComplete: false },
      { scanId: 2, at: null, views: 1, numFavorers: 1, featuredRank: null, quantity: 1, reviewCount: 14, reviewAvg: 4.75, reviewsComplete: true },
      { scanId: 3, at: null, views: 1, numFavorers: 1, featuredRank: null, quantity: 1, reviewCount: null, reviewAvg: null, reviewsComplete: null }
    ])
    useStore.setState({ detailListing: mkListing(9) })
    const { container } = render(<ListingModal />)
    const details = container.querySelector('details.stats-details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    const table = await screen.findByTestId('stats-history')
    const rows = table.querySelectorAll('tbody tr')
    expect(within(table).getByRole('columnheader', { name: 'Відгуки' })).toContainElement(
      within(table).getByRole('button', { name: `Що таке «${GLOSSARY.reviews.term}»?` })
    )
    expect(rows[0].lastElementChild!.textContent).toBe('—')
    // "14 · ★ 4,75" — the star says the second number is the average rating (spoken as "оцінка").
    expect(rows[1].lastElementChild!.textContent).toBe('14 · оцінка 4,75')
    expect(rows[1].lastElementChild!.querySelector('svg')).not.toBeNull()
    expect(rows[2].lastElementChild!.textContent).toBe('≥ 10 · оцінка 4,5')
  })
})

describe('ListingModal: price block (buyer price vs. seller base price)', () => {
  const usd = { priceAmount: 250, priceDivisor: 100, currency: 'USD' }

  it('a promotion: sale price, original struck through, −60 %, its dates, the base price and VAT note', () => {
    useStore.setState({ detailListing: mkListing(1, { ...usd, buyerPrice: mkBuyerPrice({ shipping: { amount: 450, divisor: 100 } }) }) })
    render(<ListingModal />)
    const block = screen.getByTestId('price-block')
    expect(block.querySelector('.price-now')).toHaveTextContent('1,20')
    expect(block.querySelector('s.price-was')).toHaveTextContent('3,00')
    expect(block.querySelector('.badge-discount')).toHaveTextContent('−60%')
    expect(screen.getByTestId('promo-line')).toHaveTextContent('Акція −60% з 01.10 до 31.10')
    expect(screen.getByTestId('price-note')).toHaveTextContent('Ціна для покупця: Україна (UA), з ПДВ (якщо він є в цій країні).')
    expect(screen.getByTestId('base-price')).toHaveTextContent(/2,50.*\(без ПДВ і знижок\)/)
    expect(block).toHaveTextContent('З ПДВ, до знижки')
    expect(block).toHaveTextContent('Знижка')
    expect(block).toHaveTextContent(/Доставка \(UA\).*4,50/)
    expect(block.querySelector('.listing-price')!.textContent!.replace(/\s+/g, ' ')).toBe(
      'ціна зі знижкою 1,20 USD стара ціна 3,00 USD−60%'
    )
  })

  it('no promotion: the VAT-inclusive price, no promo line; UK prices say shipping is included', () => {
    useStore.setState({ detailListing: mkListing(1, { ...usd, buyerPrice: mkBuyerPrice({ discount: false, country: 'GB', isFreeShipping: true }) }) })
    render(<ListingModal />)
    const block = screen.getByTestId('price-block')
    expect(block.querySelector('.listing-price')).toHaveTextContent('3,00')
    expect(block.querySelector('.badge-discount')).toBeNull()
    expect(screen.queryByTestId('promo-line')).toBeNull()
    expect(screen.getByTestId('price-note')).toHaveTextContent('Велика Британія (GB), з ПДВ (якщо він є в цій країні) і доставкою.')
    expect(rowValue(block, 'Доставка (GB)')).toBe('безкоштовно')
  })

  it('every price line explains itself: buyer price, base price, VAT, discount, shipping, the promotion dates', () => {
    useStore.setState({ detailListing: mkListing(1, { ...usd, buyerPrice: mkBuyerPrice({ shipping: { amount: 450, divisor: 100 } }) }) })
    render(<ListingModal />)
    const block = screen.getByTestId('price-block')
    const tip = (name: string) => within(block).getByRole('button', { name: `Що таке «${name}»?` })
    expect(tip(GLOSSARY.buyerPrice.term)).toHaveAccessibleDescription(GLOSSARY.buyerPrice.short)
    expect(tip(GLOSSARY.basePrice.term)).toHaveAccessibleDescription(GLOSSARY.basePrice.short)
    expect(tip(GLOSSARY['listing.priceWithVat'].term)).toHaveAccessibleDescription(GLOSSARY['listing.priceWithVat'].short)
    expect(tip(GLOSSARY['listing.discountAmount'].term)).toHaveAccessibleDescription(GLOSSARY['listing.discountAmount'].short)
    expect(tip(GLOSSARY.shippingCost.term)).toHaveAccessibleDescription(GLOSSARY.shippingCost.short)
    expect(within(screen.getByTestId('promo-line')).getByRole('button')).toHaveAccessibleDescription(GLOSSARY['listing.promoPeriod'].short)
  })

  it('buyer price unknown: the base price with a note, no duplicate base row', () => {
    useStore.setState({ detailListing: mkListing(1, { ...usd, buyerPrice: null }) })
    render(<ListingModal />)
    expect(screen.getByTestId('price-block').querySelector('.listing-price')).toHaveTextContent('2,50')
    expect(screen.getByTestId('price-note')).toHaveTextContent('Ціна для покупця невідома')
    expect(screen.queryByTestId('base-price')).toBeNull()
    expect(within(screen.getByTestId('price-block')).getByRole('button', { name: `Що таке «${GLOSSARY.basePrice.term}»?` })).toBeInTheDocument()
  })

  it('"Ціни та акції" loads the promotions and per-scan prices only when opened', async () => {
    api.getListingPromotions.mockResolvedValue([
      mkPromotion(2, { discountPercentage: 25, startKind: 'seen' }),
      mkPromotion(1, { startKind: 'running', endedAt: 1_759_400_000_000, endReason: 'ended' }),
      mkPromotion(3, { discountPercentage: null, startKind: 'country', endedAt: 1_759_500_000_000, endReason: 'country' })
    ])
    api.getListingStats.mockResolvedValue([
      { scanId: 1, at: null, views: 1, numFavorers: 1, featuredRank: null, quantity: 1, price: { amount: 250, divisor: 100, currency: 'USD' }, buyerPrice: mkBuyerPrice() },
      { scanId: 2, at: null, views: 1, numFavorers: 1, featuredRank: null, quantity: 1, price: { amount: 250, divisor: 100, currency: 'USD' }, buyerPrice: null },
      { scanId: 3, at: null, views: 1, numFavorers: 1, featuredRank: null, quantity: 1 } // before v4
    ])
    useStore.setState({ detailListing: mkListing(7, usd) })
    const { container } = render(<ListingModal />)
    expect(api.getListingPromotions).not.toHaveBeenCalled()
    const details = container.querySelector('details.price-details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(api.getListingPromotions).toHaveBeenCalledWith(7)
    const promos = (await screen.findByTestId('promotions-history')).querySelectorAll('tbody tr')
    expect(promos).toHaveLength(3)
    expect(promos[0]).toHaveTextContent('−25%')
    expect(promos[0]).toHaveTextContent('триває')
    expect(promos[1]).toHaveTextContent('(уже тривала)')
    expect(promos[1]).toHaveTextContent('закінчилась')
    expect(promos[2]).toHaveTextContent(/−1,80/)
    expect(promos[2]).toHaveTextContent('змінено країну покупця')
    // The columns are explained: the promotion's dates and when the app noticed it.
    const promoTable = screen.getByTestId('promotions-history')
    expect(within(promoTable).getByRole('button', { name: `Що таке «${GLOSSARY['listing.promoPeriod'].term}»?` })).toHaveAccessibleDescription(
      GLOSSARY['listing.promoPeriod'].short
    )
    expect(within(promoTable).getByRole('button', { name: `Що таке «${GLOSSARY['listing.promoSeen'].term}»?` })).toHaveAccessibleDescription(
      GLOSSARY['listing.promoSeen'].short
    )
    const prices = screen.getByTestId('price-history').querySelectorAll('tbody tr')
    expect(prices).toHaveLength(2) // the pre-v4 point has no price
    expect(prices[0]).toHaveTextContent('#2')
    expect(prices[0].children[2]).toHaveTextContent('—')
    expect(prices[1].children[2]).toHaveTextContent(/1,20.*\(UA\)/)
    expect(prices[1].children[3]).toHaveTextContent('−60%')
  })

  const openPrices = async (container: HTMLElement): Promise<void> => {
    const details = container.querySelector('details.price-details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
  }

  it('"Ціни та акції": scan dates, a buyer price without a discount, a promotion with neither % nor amount, the new end reasons', async () => {
    api.getListingPromotions.mockResolvedValue([
      mkPromotion(1, { discountPercentage: null, discountAmount: null, original: null }),
      mkPromotion(2, { endedAt: 1_759_400_000_000, endReason: 'removed' }),
      mkPromotion(3, { endedAt: 1_759_400_000_000, endReason: 'unknown' })
    ])
    const at = new Date(2026, 9, 5, 14, 30).getTime()
    api.getListingStats.mockResolvedValue([
      {
        scanId: 4, at, views: 1, numFavorers: 1, featuredRank: null, quantity: 1,
        price: { amount: 250, divisor: 100, currency: 'USD' },
        buyerPrice: mkBuyerPrice({ discount: false, country: 'DE', original: { amount: 298, divisor: 100 } })
      }
    ])
    useStore.setState({ detailListing: mkListing(7) })
    const { container } = render(<ListingModal />)
    await openPrices(container)
    const promos = (await screen.findByTestId('promotions-history')).querySelectorAll('tbody tr')
    expect(promos[0].children[0].textContent).toBe('—')
    expect(promos[0].querySelector('s.price-was')).toBeNull()
    expect(promos[1]).toHaveTextContent('товар зник з магазину')
    expect(promos[2]).toHaveTextContent('закінчилась (коли саме — невідомо)')
    expect(promos[1].querySelector('s.price-was')).toHaveTextContent('3,00')
    const row = screen.getByTestId('price-history').querySelector('tbody tr')!
    expect(row.children[0].textContent).toBe('05.10.2026, 14:30')
    expect(row.children[2]).toHaveTextContent(/2,98.*\(DE\)/)
    expect(row.children[3].textContent).toBe('—')
  })

  it('"Ціни та акції" failing to load says so and retries on "Спробувати ще"', async () => {
    api.getListingPromotions.mockRejectedValueOnce(new Error('ipc down'))
    useStore.setState({ detailListing: mkListing(7) })
    const { container } = render(<ListingModal />)
    await openPrices(container)
    expect(await screen.findByTestId('price-history-failed')).toHaveTextContent('Не вдалося завантажити історію цін.')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }))
    })
    expect(await screen.findByText('Акцій ще не було помічено.')).toBeInTheDocument()
    expect(screen.queryByTestId('price-history-failed')).toBeNull()
    expect(api.getListingPromotions).toHaveBeenCalledTimes(2)
  })

  it('"Ціни та акції": re-opening after a failure shows "Завантаження…" while it retries, not the old error', async () => {
    api.getListingPromotions.mockRejectedValueOnce(new Error('ipc down'))
    useStore.setState({ detailListing: mkListing(7) })
    const { container } = render(<ListingModal />)
    await openPrices(container)
    await screen.findByTestId('price-history-failed')
    const details = container.querySelector('details.price-details') as HTMLDetailsElement
    let resolve!: (v: never[]) => void
    api.getListingPromotions.mockReturnValueOnce(new Promise((r) => (resolve = r)))
    await act(async () => {
      details.open = false
      details.dispatchEvent(new Event('toggle'))
    })
    await openPrices(container)
    expect(screen.queryByTestId('price-history-failed')).toBeNull()
    expect(details).toHaveTextContent('Завантаження…')
    await act(async () => resolve([]))
    expect(await screen.findByText('Акцій ще не було помічено.')).toBeInTheDocument()
  })

  it('"Ціни та акції" starts over (closed, refetched) when another listing is shown', async () => {
    useStore.setState({ detailListing: mkListing(7) })
    const { container } = render(<ListingModal />)
    await openPrices(container)
    await screen.findByText('Акцій ще не було помічено.')
    await act(async () => {
      useStore.setState({ detailListing: mkListing(8) })
    })
    expect(screen.queryByText('Акцій ще не було помічено.')).toBeNull()
    await openPrices(container)
    await screen.findByText('Акцій ще не було помічено.')
    expect(api.getListingPromotions.mock.calls).toEqual([[7], [8]])
  })

  it('"Ціни та акції" without any promotion says so', async () => {
    useStore.setState({ detailListing: mkListing(7) })
    const { container } = render(<ListingModal />)
    const details = container.querySelector('details.price-details') as HTMLDetailsElement
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(await screen.findByText('Акцій ще не було помічено.')).toBeInTheDocument()
  })
})
