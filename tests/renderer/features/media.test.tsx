// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { ui } from '../../../src/renderer/src/features/media'
import { ConfirmModal } from '../../../src/renderer/src/components/ConfirmModal'
import type { ListingMedia, MediaPhoto } from '../../../src/shared/features/media'
import type { MyListing } from '../../../src/shared/types'
import { mockFeature, setupRenderer, type Api } from '../helpers'

let api: Api
beforeEach(() => {
  api = setupRenderer()
})

const Section = ui.ownListingSections![0].Component
const L = 4242

const listing = (over: Partial<MyListing> = {}): MyListing => ({
  listingId: L,
  state: 'draft',
  title: 'Planner',
  description: '',
  tags: [],
  materials: [],
  shouldAutoRenew: true,
  type: 'download',
  priceAmount: 500,
  priceDivisor: 100,
  currency: 'USD',
  quantity: 999,
  url: null,
  imageUrl: null,
  updatedAt: null,
  endingAt: null,
  ...over
})

const cdn = (id: number, size: string) => `https://i.etsystatic.com/1/r/il/a/${id}/il_${size}.jpg`
const photo = (id: number, position: number, over: Partial<MediaPhoto> = {}): MediaPhoto => ({
  id,
  position,
  rank: position,
  url75: cdn(id, '75x75'),
  url170: cdn(id, '170x135'),
  url570: cdn(id, '570xN'),
  urlFull: cdn(id, 'fullxfull'),
  width: 1500,
  height: 2000,
  altText: `Alt ${id}`,
  hexCode: 'E8E2DA',
  isBlackAndWhite: false,
  ...over
})

const media = (over: Partial<ListingMedia> = {}): ListingMedia => ({
  listingId: L,
  photos: [photo(11, 1), photo(12, 2), photo(13, 3)],
  videos: [{ id: 31, width: 1920, height: 1080, thumbnailUrl: 'https://v.etsystatic.com/video/31/thumb.jpg', state: 'inactive' }],
  files: [
    { id: 51, rank: 1, name: 'planner.pdf', sizeBytes: 1_258_291, sizeLabel: '1.2 MB', type: 'application/pdf' },
    { id: 52, rank: 2, name: 'bonus.zip', sizeBytes: null, sizeLabel: '20 KB', type: null }
  ],
  notes: [],
  ...over
})

async function show(l: MyListing = listing(), onChanged = vi.fn()) {
  await act(async () => {
    render(
      <>
        <Section listing={l} onChanged={onChanged} />
        <ConfirmModal />
      </>
    )
  })
  return onChanged
}

const calls = (action: string) => api.featureCall.mock.calls.filter((c) => c[0] === 'media' && c[1] === action)
const click = (el: HTMLElement) => act(async () => void fireEvent.click(el))
const confirm = () => click(screen.getByRole('button', { name: 'Підтвердити' }))
const cancel = () => click(screen.getByRole('button', { name: 'Скасувати' }))
const inPhoto = (id: number) => within(screen.getByTestId(`media-photo-${id}`))
const picks = (...files: Array<[string, number?]>) =>
  api.pickListingFiles.mockResolvedValueOnce(files.map(([name, size = 1000], i) => ({ token: `t${i + 1}`, name, size })))

describe('Фото, відео й файли — loading', () => {
  it('is registered as an own-listing section', () => {
    expect(ui.ownListingSections!.map((s) => [s.id, s.label])).toEqual([['media', 'Фото, відео й файли']])
  })

  it('loads the media of the listing on mount and shows photos, video and files', async () => {
    let resolve: (v: ListingMedia) => void = () => {}
    mockFeature({ 'media.load': () => new Promise((r) => (resolve = r)) })
    await show()
    expect(screen.getByText('Завантаження…')).toBeInTheDocument()
    expect(api.featureCall).toHaveBeenCalledWith('media', 'load', { listingId: L })
    await act(async () => resolve(media()))
    const sec = screen.getByTestId('media-section')
    expect(within(sec).getByText('Фото: 3 з 10')).toBeInTheDocument()
    expect(inPhoto(11).getByRole('img')).toHaveAttribute('src', cdn(11, '170x135'))
    expect(inPhoto(11).getByRole('img')).toHaveAttribute('alt', 'Alt 11')
    expect(screen.getByTestId('media-photo-11')).toHaveTextContent('№1 · головне · 1500×2000')
    expect(inPhoto(12).getByLabelText('Alt-текст фото №2')).toHaveValue('Alt 12')
    expect(inPhoto(11).getByRole('button', { name: '↑ Вище' })).toBeDisabled()
    expect(inPhoto(11).getByRole('button', { name: 'Зробити головним' })).toBeDisabled()
    expect(inPhoto(12).getByRole('button', { name: '↑ Вище' })).toBeEnabled()
    const video = screen.getByTestId('media-video')
    expect(video).toHaveTextContent('Стан: неактивне (ще обробляється або вимкнене)')
    expect(within(video).getByRole('img')).toHaveAttribute('src', 'https://v.etsystatic.com/video/31/thumb.jpg')
    expect(within(video).getByRole('button', { name: 'Замінити відео' })).toBeInTheDocument()
    const files = screen.getByTestId('media-files')
    expect(files).toHaveTextContent('Файли для покупця: 2 з 5')
    expect(files).toHaveTextContent('planner.pdf')
    expect(files).toHaveTextContent('1,2 МБ')
    expect(files).toHaveTextContent('20 KB')
  })

  it('a refused part is hidden with its note; a load error has "Спробувати ще"', async () => {
    let n = 0
    mockFeature({
      'media.load': () => (++n === 1 ? { ok: false, error: 'Увійдіть в Etsy' } : media({ files: null, videos: [], notes: ['Файли: HTTP 403'] }))
    })
    await show()
    expect(screen.getByRole('alert')).toHaveTextContent('Увійдіть в Etsy')
    await click(screen.getByRole('button', { name: 'Спробувати ще' }))
    expect(screen.getByText('Файли: HTTP 403')).toBeInTheDocument()
    expect(screen.queryByTestId('media-files')).toBeNull()
    expect(screen.getByTestId('media-video')).toHaveTextContent('Відео немає.')
    expect(screen.getByRole('button', { name: 'Завантажити відео' })).toBeInTheDocument()
  })
})

describe('Фото', () => {
  it('delete asks first (cancel = nothing), then deletes; "Повернути" re-attaches it at its place', async () => {
    mockFeature({
      'media.load': media(),
      'media.deletePhoto': media({ photos: [photo(11, 1), photo(13, 2)] }),
      'media.restorePhoto': media()
    })
    await show()
    await click(inPhoto(12).getByRole('button', { name: 'Видалити' }))
    expect(screen.getByText('Видалити фото №2 з лістингу?')).toBeInTheDocument()
    await cancel()
    expect(calls('deletePhoto')).toHaveLength(0)
    await click(inPhoto(12).getByRole('button', { name: 'Видалити' }))
    await confirm()
    expect(calls('deletePhoto')[0][2]).toEqual({ listingId: L, imageId: 12 })
    expect(screen.getByRole('status')).toHaveTextContent('Фото №2 видалено.')
    expect(screen.queryByTestId('media-photo-12')).toBeNull()
    await click(screen.getByRole('button', { name: 'Повернути' }))
    expect(calls('restorePhoto')[0][2]).toEqual({ listingId: L, imageId: 12, position: 2, altText: 'Alt 12', watermarked: false })
    expect(screen.getByRole('status')).toHaveTextContent('Фото повернуто.')
    expect(screen.queryByRole('button', { name: 'Повернути' })).toBeNull()
  })

  it('alt text: saved without asking on a draft; an active listing asks first', async () => {
    mockFeature({ 'media.load': media(), 'media.setAltText': media({ photos: [photo(11, 1), photo(12, 2, { altText: 'Лисиця' }), photo(13, 3)] }) })
    await show()
    const input = inPhoto(12).getByLabelText('Alt-текст фото №2')
    expect(input).toHaveAttribute('maxLength', '500')
    expect(inPhoto(12).getByRole('button', { name: 'Зберегти' })).toBeDisabled()
    fireEvent.change(input, { target: { value: 'Лисиця' } })
    await click(inPhoto(12).getByRole('button', { name: 'Зберегти' }))
    expect(calls('setAltText')[0][2]).toEqual({ listingId: L, imageId: 12, altText: 'Лисиця', watermarked: false })
    expect(screen.getByRole('status')).toHaveTextContent('Alt-текст фото №2 збережено.')
    expect(inPhoto(12).getByLabelText('Alt-текст фото №2')).toHaveValue('Лисиця')
  })

  it('alt text on an active listing: confirm mentions buyers; cancel sends nothing', async () => {
    mockFeature({ 'media.load': media(), 'media.setAltText': media() })
    await show(listing({ state: 'active' }))
    fireEvent.change(inPhoto(11).getByLabelText('Alt-текст фото №1'), { target: { value: 'New' } })
    await click(inPhoto(11).getByRole('button', { name: 'Зберегти' }))
    expect(screen.getByText(/Змінити alt-текст фото №1\?\s+Лістинг активний — покупці побачать зміну одразу\./)).toBeInTheDocument()
    await cancel()
    expect(calls('setAltText')).toHaveLength(0)
  })

  it('replace: pick → confirm → replacePhoto at its position with an empty alt text (the old one describes the old photo); the new main photo goes to onChanged', async () => {
    mockFeature({ 'media.load': media(), 'media.replacePhoto': media({ photos: [photo(99, 1), photo(12, 2), photo(13, 3)] }) })
    const onChanged = await show()
    picks(['new.jpg'])
    await click(inPhoto(11).getByRole('button', { name: 'Замінити' }))
    expect(api.pickListingFiles).toHaveBeenCalledWith('images')
    expect(
      screen.getByText('Замінити фото №1 на «new.jpg»? Старе фото буде знято з лістингу, а alt-текст нового буде порожнім.')
    ).toBeInTheDocument()
    await confirm()
    expect(calls('replacePhoto')[0][2]).toEqual({ listingId: L, position: 1, token: 't1', altText: '', watermarked: false })
    expect(screen.getByRole('status')).toHaveTextContent('Фото №1 замінено. Додайте alt-текст для нового фото.')
    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ listingId: L, imageUrl: cdn(99, '170x135') }))
  })

  it('a picked file of the wrong type is refused in place; a cancelled pick does nothing', async () => {
    mockFeature({ 'media.load': media() })
    await show()
    picks(['scan.webp'])
    await click(inPhoto(11).getByRole('button', { name: 'Замінити' }))
    expect(screen.getByRole('alert')).toHaveTextContent('«scan.webp»: фото має бути JPG, JPEG, PNG, GIF.')
    await click(inPhoto(11).getByRole('button', { name: 'Замінити' }))
    expect(screen.queryByText(/Замінити фото №1/)).toBeNull()
    expect(api.featureCall.mock.calls.filter((c) => c[1] !== 'load')).toHaveLength(0)
  })

  it('add: appends the picked photos (watermark flag), no confirm on a draft', async () => {
    mockFeature({ 'media.load': media(), 'media.addPhotos': media() })
    await show()
    fireEvent.click(screen.getByLabelText('З водяним знаком'))
    picks(['a.jpg'], ['b.png'])
    await click(screen.getByRole('button', { name: '+ Додати фото' }))
    expect(calls('addPhotos')[0][2]).toEqual({ listingId: L, tokens: ['t1', 't2'], watermarked: true })
    expect(screen.getByRole('status')).toHaveTextContent('Додано фото: 2.')
  })

  it('add: more than 10 photos is refused before sending; at 10 the button is off', async () => {
    const nine = Array.from({ length: 9 }, (_, i) => photo(i + 1, i + 1))
    mockFeature({ 'media.load': media({ photos: nine }) })
    await show()
    picks(['a.jpg'], ['b.jpg'])
    await click(screen.getByRole('button', { name: '+ Додати фото' }))
    expect(screen.getByRole('alert')).toHaveTextContent('до 10 фото: зараз 9, можна додати ще 1')
    expect(calls('addPhotos')).toHaveLength(0)
  })

  it('at 10 photos "+ Додати фото" is disabled', async () => {
    mockFeature({ 'media.load': media({ photos: Array.from({ length: 10 }, (_, i) => photo(i + 1, i + 1)) }) })
    await show()
    expect(screen.getByRole('button', { name: '+ Додати фото' })).toBeDisabled()
  })

  it('move: "Зробити головним" and "↑ Вище"', async () => {
    mockFeature({ 'media.load': media(), 'media.movePhoto': media() })
    await show()
    await click(inPhoto(13).getByRole('button', { name: 'Зробити головним' }))
    expect(calls('movePhoto')[0][2]).toEqual({ listingId: L, imageId: 13, toPosition: 1, watermarked: false })
    expect(screen.getByRole('status')).toHaveTextContent('Фото стало головним.')
    await click(inPhoto(13).getByRole('button', { name: '↑ Вище' }))
    expect(calls('movePhoto')[1][2]).toEqual({ listingId: L, imageId: 13, toPosition: 2, watermarked: false })
  })

  it('the watermark switch goes with every re-save (alt text, move, restore) — Etsy does not report the mark', async () => {
    mockFeature({
      'media.load': media(),
      'media.setAltText': media(),
      'media.movePhoto': media(),
      'media.deletePhoto': media({ photos: [photo(11, 1), photo(13, 2)] }),
      'media.restorePhoto': media()
    })
    await show()
    expect(screen.getByText(/Etsy не повідомляє, чи фото позначене «з водяним\s+знаком»/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('З водяним знаком'))
    fireEvent.change(inPhoto(12).getByLabelText('Alt-текст фото №2'), { target: { value: 'Лисиця' } })
    await click(inPhoto(12).getByRole('button', { name: 'Зберегти' }))
    expect(calls('setAltText')[0][2]).toMatchObject({ imageId: 12, watermarked: true })
    await click(inPhoto(13).getByRole('button', { name: 'Зробити головним' }))
    expect(calls('movePhoto')[0][2]).toMatchObject({ imageId: 13, watermarked: true })
    await click(inPhoto(12).getByRole('button', { name: 'Видалити' }))
    await confirm()
    await click(screen.getByRole('button', { name: 'Повернути' }))
    expect(calls('restorePhoto')[0][2]).toMatchObject({ imageId: 12, watermarked: true })
  })

  it('a failed write shows the error and re-reads what Etsy has now', async () => {
    mockFeature({
      'media.load': media(),
      'media.movePhoto': { ok: false, error: 'Фото пересунуто, але фото #11 … не вдалося повернути' }
    })
    await show()
    await click(inPhoto(12).getByRole('button', { name: 'Зробити головним' }))
    expect(screen.getByRole('alert')).toHaveTextContent('не вдалося повернути')
    expect(calls('load')).toHaveLength(2)
  })
})

describe('Відео', () => {
  it('"Перевірити стан" re-reads the video', async () => {
    mockFeature({ 'media.load': media(), 'media.video': { id: 31, width: 1920, height: 1080, thumbnailUrl: null, state: 'active' } })
    await show()
    await click(screen.getByRole('button', { name: 'Перевірити стан' }))
    expect(calls('video')[0][2]).toEqual({ listingId: L, videoId: 31 })
    expect(screen.getByTestId('media-video')).toHaveTextContent('Стан: активне')
  })

  it('"Перевірити стан" failing shows the error', async () => {
    mockFeature({ 'media.load': media(), 'media.video': { ok: false, error: 'Такого відео в цьому лістингу немає.' } })
    await show()
    await click(screen.getByRole('button', { name: 'Перевірити стан' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Такого відео')
  })

  it('replace: confirm, progress from feature:event while uploading, then the note', async () => {
    let emit: (e: { feature: string; type: string; payload: unknown }) => void = () => {}
    api.onFeatureEvent.mockImplementation((cb) => {
      emit = cb
      return () => {}
    })
    let finish: (v: ListingMedia) => void = () => {}
    mockFeature({ 'media.load': media(), 'media.uploadVideo': () => new Promise((r) => (finish = r)) })
    await show()
    picks(['clip.mp4'])
    await click(screen.getByRole('button', { name: 'Замінити відео' }))
    expect(api.pickListingFiles).toHaveBeenCalledWith('videos')
    expect(screen.getByText('Замінити відео лістингу на «clip.mp4»? Поточне відео буде знято після того, як нове завантажиться.')).toBeInTheDocument()
    await confirm()
    expect(calls('uploadVideo')[0][2]).toEqual({ listingId: L, token: 't1' })
    expect(screen.getByText('Зачекайте…')).toBeInTheDocument()
    await act(async () => {
      emit({ feature: 'media', type: 'progress', payload: { listingId: L, kind: 'video', name: 'clip.mp4', index: 1, total: 1 } })
      emit({ feature: 'media', type: 'progress', payload: { listingId: 1, kind: 'photo', name: 'other.jpg', index: 1, total: 1 } })
    })
    expect(screen.getByText('Відео: «clip.mp4» — завантаження…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Видалити відео' })).toBeDisabled()
    await act(async () => finish(media()))
    expect(screen.getByRole('status')).toHaveTextContent('Відео «clip.mp4» завантажено.')
    expect(screen.queryByText(/завантаження…/)).toBeNull()
  })

  it('first upload on a draft needs no confirm; too big a video is refused in place', async () => {
    mockFeature({ 'media.load': media({ videos: [] }), 'media.uploadVideo': media() })
    await show()
    picks(['huge.mp4', 101 * 1024 * 1024])
    await click(screen.getByRole('button', { name: 'Завантажити відео' }))
    expect(screen.getByRole('alert')).toHaveTextContent('«huge.mp4» більший за 100 МБ.')
    picks(['clip.mov'])
    await click(screen.getByRole('button', { name: 'Завантажити відео' }))
    expect(calls('uploadVideo')[0][2]).toEqual({ listingId: L, token: 't1' })
  })

  it('delete asks first', async () => {
    mockFeature({ 'media.load': media(), 'media.deleteVideo': media({ videos: [] }) })
    await show()
    await click(screen.getByRole('button', { name: 'Видалити відео' }))
    expect(screen.getByText('Видалити відео з лістингу?')).toBeInTheDocument()
    await confirm()
    expect(calls('deleteVideo')[0][2]).toEqual({ listingId: L, videoId: 31 })
    expect(screen.getByTestId('media-video')).toHaveTextContent('Відео немає.')
  })
})

describe('Файли для покупця', () => {
  it('delete: confirm; the last file warns that the listing becomes physical', async () => {
    mockFeature({ 'media.load': media(), 'media.deleteFile': media({ files: [media().files![0]] }) })
    await show()
    await click(within(screen.getByTestId('media-files')).getAllByRole('button', { name: 'Видалити' })[1])
    expect(screen.getByText('Видалити файл «bonus.zip»?')).toBeInTheDocument()
    await confirm()
    expect(calls('deleteFile')[0][2]).toEqual({ listingId: L, fileId: 52 })
    await click(within(screen.getByTestId('media-files')).getByRole('button', { name: 'Видалити' }))
    expect(screen.getByText(/Видалити файл «planner\.pdf»\?\s+Це останній файл: після видалення Etsy зробить лістинг фізичним/)).toBeInTheDocument()
    await cancel()
    expect(calls('deleteFile')).toHaveLength(1)
  })

  it('replace: pick → confirm → replaceFile', async () => {
    mockFeature({ 'media.load': media(), 'media.replaceFile': media() })
    await show()
    picks(['planner-v2.pdf'])
    await click(within(screen.getByTestId('media-files')).getAllByRole('button', { name: 'Замінити' })[0])
    expect(api.pickListingFiles).toHaveBeenCalledWith('files')
    expect(screen.getByText('Замінити «planner.pdf» на «planner-v2.pdf»? Покупці отримуватимуть новий файл.')).toBeInTheDocument()
    await confirm()
    expect(calls('replaceFile')[0][2]).toEqual({ listingId: L, fileId: 51, token: 't1' })
    expect(screen.getByRole('status')).toHaveTextContent('Файл «planner.pdf» замінено на «planner-v2.pdf».')
  })

  it('adding the first file to a physical listing warns it becomes digital', async () => {
    mockFeature({ 'media.load': media({ files: [] }), 'media.addFiles': media() })
    await show(listing({ type: 'physical' }))
    expect(screen.getByTestId('media-files')).toHaveTextContent('Файлів немає (фізичний товар).')
    picks(['guide.pdf'])
    await click(screen.getByRole('button', { name: '+ Додати файли' }))
    expect(screen.getByText(/Лістинг стане цифровим/)).toBeInTheDocument()
    await confirm()
    expect(calls('addFiles')[0][2]).toEqual({ listingId: L, tokens: ['t1'] })
    expect(screen.getByRole('status')).toHaveTextContent('Додано файлів: 1.')
  })

  it('add: over 5 files refused in place; at 5 the button is off; an error from main is shown', async () => {
    const four = [1, 2, 3, 4].map((r) => ({ id: 50 + r, rank: r, name: `f${r}.pdf`, sizeBytes: 10, sizeLabel: null, type: null }))
    mockFeature({ 'media.load': media({ files: four }), 'media.addFiles': { ok: false, error: 'Etsy відхилив запит (HTTP 400).' } })
    await show()
    picks(['a.pdf'], ['b.pdf'])
    await click(screen.getByRole('button', { name: '+ Додати файли' }))
    expect(screen.getByRole('alert')).toHaveTextContent('до 5 файлів: зараз 4, можна додати ще 1')
    picks(['a.pdf'])
    await click(screen.getByRole('button', { name: '+ Додати файли' }))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTP 400')
  })

  it('at 5 files "+ Додати файли" is disabled', async () => {
    const five = [1, 2, 3, 4, 5].map((r) => ({ id: 50 + r, rank: r, name: `f${r}.pdf`, sizeBytes: 10, sizeLabel: null, type: null }))
    mockFeature({ 'media.load': media({ files: five }) })
    await show()
    expect(screen.getByRole('button', { name: '+ Додати файли' })).toBeDisabled()
  })
})
