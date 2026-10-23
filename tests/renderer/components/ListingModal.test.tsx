// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ListingModal } from '../../../src/renderer/src/components/ListingModal'
import { useStore } from '../../../src/renderer/src/store'
import { mkListing, setupRenderer, type Api } from '../helpers'
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
