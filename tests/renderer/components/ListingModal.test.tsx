// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ListingModal } from '../../../src/renderer/src/components/ListingModal'
import { useStore } from '../../../src/renderer/src/store'
import { mkListing, mkReview, setupRenderer, type Api } from '../helpers'
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
