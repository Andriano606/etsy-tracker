// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ListingModal } from '../../../src/renderer/src/components/ListingModal'
import { useStore } from '../../../src/renderer/src/store'
import { mkBuyerPrice, mkListing, mkPromotion, mkReview, setupRenderer, type Api } from '../helpers'
import { mkDetails } from '../../helpers/db'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

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

describe('ListingModal: popularity, details, raw JSON', () => {
  it('shows favorers / views with growth and the featured rank', () => {
    useStore.setState({
      detailListing: mkListing(5, { numFavorers: 1530, favorersDelta: 12, views: 20000, viewsDelta: -1, featuredRank: 2 })
    })
    render(<ListingModal />)
    expect(screen.getByTestId('fact-favorers').textContent!.replace(/\s/g, ' ')).toBe('❤ 1 530 (+12)')
    expect(screen.getByTestId('fact-views').textContent!.replace(/\s/g, ' ')).toBe('👁 20 000 (−1)')
    expect(screen.getByText('★ позиція 2')).toBeInTheDocument()
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
    expect(d).toHaveTextContent('Матеріалиstoneware, glaze')
    expect(d).toHaveTextContent('Хто виготовивпродавець')
    expect(d).toHaveTextContent('Коли виготовленона замовлення')
    expect(d).toHaveTextContent('Час виготовлення1–3 дн.')
    expect(d).toHaveTextContent('Вага0.4 kg')
    expect(d).toHaveTextContent('Розміри12 × 9 × ? cm')
    expect(d).toHaveTextContent('Персоналізаціятак')
    expect(d).toHaveTextContent('Name to engrave (обовʼязково)')
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
    await act(async () => {
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    })
    expect(api.getListingRaw).toHaveBeenCalledWith(8)
    expect(await screen.findByTestId('raw-json')).toHaveTextContent('"views": 12')
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
    expect(rows[1]).toHaveTextContent('#1')
    expect(rows[1]).toHaveTextContent('—')
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
    expect(screen.getByTestId('fact-reviews').textContent!.replace(/\s/g, ' ')).toBe('⭐ 4,6 (25) (+1 нових)')
    expect(api.getListingReviews).not.toHaveBeenCalled()
    await open(container)
    expect(api.getListingReviews).toHaveBeenCalledWith(1, 0, 20)
    const items = await screen.findAllByTestId('review-item')
    expect(items).toHaveLength(20)
    expect(items[0]).toHaveTextContent('Text 100')
    expect(items[0]).toHaveTextContent('de')
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
    expect(item).toHaveTextContent('★★★☆☆')
  })

  it('a partial history says so; a never-synced shop has no reviews section', async () => {
    useStore.setState({ detailListing: mkListing(3, { reviewCount: 4, reviewAvg: 5, reviewsPartial: true }) })
    const { container, unmount } = render(<ListingModal />)
    expect(screen.getByTestId('fact-reviews')).toHaveTextContent('(≥ 4)')
    await open(container)
    expect(await screen.findByText(/ще завантажується/)).toBeInTheDocument()
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
    const rows = (await screen.findByTestId('stats-history')).querySelectorAll('tbody tr')
    expect(screen.getByText('⭐ відгуки')).toBeInTheDocument()
    expect(rows[0].lastElementChild!.textContent).toBe('—')
    expect(rows[1].lastElementChild!.textContent).toBe('14 (4,75)')
    expect(rows[2].lastElementChild!.textContent).toBe('≥ 10 (4,5)')
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
    expect(block).toHaveTextContent(/Доставка \(GB\)безкоштовно/)
  })

  it('buyer price unknown: the base price with a note, no duplicate base row', () => {
    useStore.setState({ detailListing: mkListing(1, { ...usd, buyerPrice: null }) })
    render(<ListingModal />)
    expect(screen.getByTestId('price-block').querySelector('.listing-price')).toHaveTextContent('2,50')
    expect(screen.getByTestId('price-note')).toHaveTextContent('Ціна для покупця невідома')
    expect(screen.queryByTestId('base-price')).toBeNull()
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
