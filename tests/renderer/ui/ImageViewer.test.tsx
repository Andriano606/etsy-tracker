// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImageViewer, Modal, ZoomButton, ZoomImage } from '../../../src/renderer/src/ui'
import { ListingModal } from '../../../src/renderer/src/components/ListingModal'
import { useStore, type ViewerImage } from '../../../src/renderer/src/store'
import { mkListing, setupRenderer } from '../helpers'

beforeEach(() => {
  setupRenderer()
})

const A: ViewerImage = { src: 'etsyimg://img/1/fullxfull', alt: 'Чашка', caption: 'Фото 1' }
const B: ViewerImage = { src: 'etsyimg://img/2/fullxfull', alt: 'Чашка збоку' }
const C: ViewerImage = { src: 'etsyimg://img/3/fullxfull' }

const viewer = () => screen.getByRole('dialog', { name: 'Перегляд зображення' })
const queryViewer = () => screen.queryByRole('dialog', { name: 'Перегляд зображення' })
const shown = () => viewer().querySelector('img.ui-viewer-img')!
const open = (images: ViewerImage | ViewerImage[], index?: number) => act(() => useStore.getState().openImage(images, index))
const key = (target: Element | Document, k: string, opts: object = {}) => act(() => void fireEvent.keyDown(target, { key: k, ...opts }))
const loaded = () => act(() => void fireEvent.load(shown()))
const actualBtn = () => within(viewer()).getByRole('button', { name: /Справжній розмір|Вмістити у вікно/ })

describe('ImageViewer', () => {
  it('renders nothing while closed; one image: src, alt, caption, no counter or arrows', () => {
    render(<ImageViewer />)
    expect(queryViewer()).toBeNull()
    open(A)
    expect(viewer()).toHaveAttribute('aria-modal', 'true')
    expect(shown()).toHaveAttribute('src', A.src)
    expect(shown()).toHaveAttribute('alt', 'Чашка')
    expect(within(viewer()).getByText('Фото 1')).toBeInTheDocument()
    expect(within(viewer()).queryByText(/\/ /)).toBeNull()
    expect(within(viewer()).queryByRole('button', { name: /Наступне/ })).toBeNull()
  })

  it('a gallery opens at the index; side buttons, ←/→ and the counter wrap around', () => {
    render(<ImageViewer />)
    open([A, B, C], 1)
    const v = viewer()
    expect(shown()).toHaveAttribute('src', B.src)
    expect(within(v).getByText('2 / 3')).toBeInTheDocument()
    fireEvent.click(within(v).getByRole('button', { name: 'Наступне (→)' }))
    expect(shown()).toHaveAttribute('src', C.src)
    expect(within(v).getByText('3 / 3')).toBeInTheDocument()
    fireEvent.click(within(v).getByRole('button', { name: 'Наступне (→)' }))
    expect(shown()).toHaveAttribute('src', A.src)
    fireEvent.click(within(v).getByRole('button', { name: 'Попереднє (←)' }))
    expect(shown()).toHaveAttribute('src', C.src)
    key(v, 'ArrowRight')
    expect(within(v).getByText('1 / 3')).toBeInTheDocument()
    key(v, 'ArrowLeft')
    key(v, 'ArrowLeft')
    expect(within(v).getByText('2 / 3')).toBeInTheDocument()
    // Works wherever focus is (e.g. dropped to <body>), modifiers do nothing.
    key(document.body, 'ArrowRight')
    expect(within(v).getByText('3 / 3')).toBeInTheDocument()
    key(v, 'ArrowRight', { ctrlKey: true })
    expect(within(v).getByText('3 / 3')).toBeInTheDocument()
    // An image without alt/caption still has a name.
    expect(shown()).toHaveAttribute('alt', 'Зображення 3 з 3')
  })

  it('a gallery with the same src twice still loads the next one (a fresh <img>)', () => {
    render(<ImageViewer />)
    open([A, A])
    loaded()
    const first = shown()
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Наступне (→)' }))
    expect(shown()).not.toBe(first)
    expect(within(viewer()).getByText('Завантаження…')).toBeInTheDocument()
    expect(actualBtn()).toBeDisabled()
    loaded()
    expect(actualBtn()).toBeEnabled()
  })

  it('loading → onLoad → 1:1 by the button and by clicking the image; stepping resets to fit', () => {
    render(<ImageViewer />)
    open([A, B])
    const stage = screen.getByTestId('viewer-stage')
    expect(within(viewer()).getByText('Завантаження…')).toBeInTheDocument()
    expect(actualBtn()).toBeDisabled()
    // A click on a loading image does nothing.
    fireEvent.click(shown())
    expect(stage).not.toHaveClass('is-actual')
    loaded()
    expect(within(viewer()).queryByText('Завантаження…')).toBeNull()
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Справжній розмір (1:1)' }))
    expect(stage).toHaveClass('is-actual')
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Вмістити у вікно' }))
    expect(stage).not.toHaveClass('is-actual')
    fireEvent.click(shown())
    expect(stage).toHaveClass('is-actual')
    expect(queryViewer()).not.toBeNull() // the image click doesn't close
    fireEvent.click(shown())
    expect(stage).not.toHaveClass('is-actual')
    fireEvent.click(shown())
    key(viewer(), 'ArrowRight')
    expect(stage).not.toHaveClass('is-actual')
    expect(actualBtn()).toBeDisabled()
  })

  it('a failed image says so, hides the <img> and disables 1:1', () => {
    render(<ImageViewer />)
    open(A)
    act(() => void fireEvent.error(shown()))
    expect(within(viewer()).getByRole('alert')).toHaveTextContent('Не вдалося завантажити зображення.')
    expect(shown()).not.toBeVisible()
    expect(actualBtn()).toBeDisabled()
    expect(within(viewer()).queryByText('Завантаження…')).toBeNull()
  })

  it('closes with ×, a click on the dark backdrop — not on the image, not a drag ending on the backdrop', () => {
    render(<ImageViewer />)
    open(A)
    loaded()
    const stage = screen.getByTestId('viewer-stage')
    fireEvent.mouseDown(shown())
    fireEvent.click(stage)
    expect(queryViewer()).not.toBeNull()
    fireEvent.mouseDown(shown())
    fireEvent.click(shown())
    expect(queryViewer()).not.toBeNull()
    fireEvent.mouseDown(stage)
    fireEvent.click(stage)
    expect(queryViewer()).toBeNull()
    open(A)
    fireEvent.click(within(viewer()).getByRole('button', { name: 'Закрити (Esc)' }))
    expect(useStore.getState().viewer).toBeNull()
  })

  it('Escape closes only the viewer when a Modal is open under it; the next Escape closes the Modal', () => {
    const onClose = vi.fn()
    render(
      <>
        <Modal title="Товар" onClose={onClose}>
          <p>тіло</p>
        </Modal>
        <ImageViewer />
      </>
    )
    open(A)
    key(viewer(), 'Escape')
    expect(queryViewer()).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    key(document.body, 'Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('focus moves into the viewer, Tab cycles inside it, and focus returns to the opener', async () => {
    render(
      <>
        <ZoomImage src="thumb.jpg" full={A.src} alt="Чашка" />
        <button type="button">інша</button>
        <ImageViewer />
      </>
    )
    const opener = screen.getByRole('button', { name: /Відкрити на весь розмір/ })
    opener.focus()
    await act(async () => {
      opener.click()
    })
    expect(viewer()).toHaveFocus()
    loaded()
    const close = within(viewer()).getByRole('button', { name: 'Закрити (Esc)' })
    const actual = actualBtn()
    await userEvent.tab()
    expect(actual).toHaveFocus()
    await userEvent.tab()
    expect(close).toHaveFocus()
    await userEvent.tab()
    expect(actual).toHaveFocus() // wrapped, never reached "інша"
    await userEvent.tab({ shift: true })
    expect(close).toHaveFocus()
    // Focus that somehow left the viewer is pulled back in by Tab.
    screen.getByRole('button', { name: 'інша' }).focus()
    await userEvent.tab()
    expect(actual).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(queryViewer()).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('a different image set opening resets the index, 1:1 and the loading state', () => {
    render(<ImageViewer />)
    open([A, B, C], 2)
    loaded()
    fireEvent.click(shown())
    expect(screen.getByTestId('viewer-stage')).toHaveClass('is-actual')
    open([B, C], 0)
    expect(shown()).toHaveAttribute('src', B.src)
    expect(within(viewer()).getByText('1 / 2')).toBeInTheDocument()
    expect(screen.getByTestId('viewer-stage')).not.toHaveClass('is-actual')
    expect(within(viewer()).getByText('Завантаження…')).toBeInTheDocument()
    // The same set opened at another image starts there.
    open([B, C], 1)
    expect(shown()).toHaveAttribute('src', C.src)
  })
})

describe('ZoomImage / ZoomButton', () => {
  it('ZoomImage inside a clickable parent opens the biggest URL and never triggers the parent (click or Enter)', async () => {
    const parentClick = vi.fn()
    const parentKey = vi.fn()
    render(
      <>
        <div onClick={parentClick} onKeyDown={parentKey} role="presentation">
          <ZoomImage src="etsyimg://img/7/570xN" full="etsyimg://img/7/fullxfull" alt="Чашка" caption="Чашка — фото 1" />
        </div>
        <ImageViewer />
      </>
    )
    const btn = screen.getByRole('button', { name: 'Відкрити на весь розмір: Чашка' })
    expect(btn.querySelector('img')).toHaveAttribute('src', 'etsyimg://img/7/570xN')
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(parentClick).not.toHaveBeenCalled()
    expect(useStore.getState().viewer).toEqual({
      images: [{ src: 'etsyimg://img/7/fullxfull', alt: 'Чашка', caption: 'Чашка — фото 1' }],
      index: 0
    })
    expect(shown()).toHaveAttribute('src', 'etsyimg://img/7/fullxfull')
    act(() => useStore.getState().closeImage())
    fireEvent.keyDown(btn, { key: 'Enter' })
    expect(parentKey).not.toHaveBeenCalled()
    fireEvent.keyDown(btn, { key: 'a' })
    expect(parentKey).toHaveBeenCalledTimes(1)
  })

  it('ZoomImage with a gallery opens it at its index; without `full` it opens `src`', async () => {
    render(
      <>
        <ZoomImage src="t2.jpg" alt="друге" gallery={[A, B, C]} index={1} />
        <ZoomImage src="only.jpg" alt="одне" />
        <ImageViewer />
      </>
    )
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /друге/ }))
    })
    expect(shown()).toHaveAttribute('src', B.src)
    expect(within(viewer()).getByText('2 / 3')).toBeInTheDocument()
    act(() => useStore.getState().closeImage())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /одне/ }))
    })
    expect(shown()).toHaveAttribute('src', 'only.jpg')
  })

  it('ZoomButton next to a clickable card opens the viewer without the card action (click or Enter)', async () => {
    const cardClick = vi.fn()
    const hostClick = vi.fn()
    render(
      <>
        <div className="ui-zoom-host" onClick={hostClick} onKeyDown={hostClick}>
          <button type="button" onClick={cardClick}>
            <img src="etsyimg://img/5/570xN" alt="" />
            Картка
          </button>
          <ZoomButton images={[A, B]} index={1} label="Відкрити фото на весь розмір" className="ui-zoom-corner" />
        </div>
        <ImageViewer />
      </>
    )
    const zoom = screen.getByRole('button', { name: 'Відкрити фото на весь розмір' })
    expect(zoom).toHaveClass('ui-zoom-btn', 'ui-zoom-corner')
    await act(async () => {
      fireEvent.click(zoom)
    })
    expect(cardClick).not.toHaveBeenCalled()
    expect(hostClick).not.toHaveBeenCalled()
    expect(useStore.getState().viewer).toEqual({ images: [A, B], index: 1 })
    expect(shown()).toHaveAttribute('src', B.src)
    act(() => useStore.getState().closeImage())
    fireEvent.keyDown(zoom, { key: ' ' })
    expect(hostClick).not.toHaveBeenCalled()
    // The card itself still works.
    fireEvent.click(screen.getByRole('button', { name: /Картка/ }))
    expect(cardClick).toHaveBeenCalledTimes(1)
  })
})

describe('ImageViewer over ListingModal', () => {
  it('←/→ step only the viewer, never the listing gallery under it; Escape closes only the viewer', () => {
    const base = mkListing(2).images[0]
    const listing = mkListing(2, { images: [1, 2, 3].map((id, i) => ({ ...base, id, rank: i + 1 })) })
    useStore.setState({ detailListing: listing })
    render(
      <>
        <ListingModal />
        <ImageViewer />
      </>
    )
    const modal = screen.getByRole('dialog', { name: listing.title })
    const galleryCount = () => within(modal).getByText(/^\d \/ 3$/).textContent
    expect(galleryCount()).toBe('1 / 3')
    open([A, B, C])
    const v = viewer()
    expect(v).toHaveFocus()
    key(v, 'ArrowRight')
    expect(within(v).getByText('2 / 3')).toBeInTheDocument()
    expect(galleryCount()).toBe('1 / 3')
    // Even a key aimed at the listing window (focus left behind) only moves the viewer.
    key(modal, 'ArrowRight')
    expect(within(v).getByText('3 / 3')).toBeInTheDocument()
    expect(galleryCount()).toBe('1 / 3')
    // A single image: arrows still don't reach the gallery.
    open(A)
    key(modal, 'ArrowRight')
    expect(galleryCount()).toBe('1 / 3')
    key(viewer(), 'Escape')
    expect(queryViewer()).toBeNull()
    expect(useStore.getState().detailListing).not.toBeNull()
    // With the viewer closed the gallery's arrows work again.
    key(modal, 'ArrowRight')
    expect(galleryCount()).toBe('2 / 3')
  })
})
