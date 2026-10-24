import { describe, expect, it } from 'vitest'
import { mediaFeature } from '../../../src/main/features/media'
import { MEDIA_TOOL_SUMMARY } from '../../../src/shared/features/media'
import { NOT_SIGNED_IN, WRITES_OFF } from '../../../src/main/mcpStoreTools'
import { OWN_SHOP, callTool, featureCtx, mcpDeps, runAction, signedIn, signedOut } from '../../helpers/features'
import type { FakeCall } from '../../helpers/fakeFetch'

const L = 4242
const PUB = `/v3/application/listings/${L}`
const OWN = `/v3/application/shops/${OWN_SHOP}/listings/${L}`

const img = (id: number, rank: number, over: Record<string, unknown> = {}) => ({
  listing_id: L,
  listing_image_id: id,
  hex_code: 'E8E2DA',
  red: 232,
  green: 226,
  blue: 218,
  hue: 34,
  saturation: 6,
  brightness: 91,
  is_black_and_white: false,
  creation_tsz: 1_700_000_000,
  created_timestamp: 1_700_000_000,
  rank,
  url_75x75: `https://i.etsystatic.com/1/r/il/a/${id}/il_75x75.${id}.jpg`,
  url_170x135: `https://i.etsystatic.com/1/r/il/a/${id}/il_170x135.${id}.jpg`,
  url_570xN: `https://i.etsystatic.com/1/r/il/a/${id}/il_570xN.${id}.jpg`,
  url_fullxfull: `https://i.etsystatic.com/1/r/il/a/${id}/il_fullxfull.${id}.jpg`,
  full_height: 2000,
  full_width: 1500,
  alt_text: `Alt ${id}`,
  ...over
})

const vid = (id: number, over: Record<string, unknown> = {}) => ({
  video_id: id,
  height: 1080,
  width: 1920,
  thumbnail_url: `https://v.etsystatic.com/video/upload/${id}/thumb.jpg`,
  video_url: `https://v.etsystatic.com/video/upload/${id}/v.mp4`,
  video_state: 'active',
  ...over
})

const file = (id: number, rank: number, over: Record<string, unknown> = {}) => ({
  listing_file_id: id,
  listing_id: L,
  rank,
  filename: `planner-${id}.pdf`,
  filesize: '1.2 MB',
  size_bytes: 1_258_291,
  filetype: 'application/pdf',
  create_timestamp: 1_700_000_000,
  created_timestamp: 1_700_000_000,
  ...over
})

const paged = (results: unknown[]) => ({ body: { count: results.length, results } })

function mediaRoutes(over: Record<string, unknown> = {}) {
  return {
    [`GET ${PUB}/images`]: paged([img(12, 2), img(11, 1), img(13, 3)]),
    [`GET ${PUB}/images/{id}`]: (url: URL) => ({ body: img(Number(url.pathname.split('/').pop()), 2) }),
    [`GET ${PUB}/videos`]: paged([vid(31)]),
    [`GET ${PUB}/videos/{id}`]: { body: vid(31, { video_state: 'inactive' }) },
    [`GET ${OWN}/files`]: paged([file(52, 2), file(51, 1)]),
    [`GET ${OWN}/files/{id}`]: { body: file(51, 1) },
    [`POST ${OWN}/images`]: { status: 201, body: img(99, 1) },
    [`DELETE ${OWN}/images/{id}`]: { status: 200 },
    [`POST ${OWN}/videos`]: { status: 201, body: vid(32) },
    [`DELETE ${OWN}/videos/{id}`]: { status: 200 },
    [`POST ${OWN}/files`]: { status: 201, body: file(53, 3) },
    [`DELETE ${OWN}/files/{id}`]: { status: 200 },
    ...over
  } as Record<string, never>
}

/** The multipart fields of an upload: strings as is, files as {name, type, text}. */
async function parts(c: FakeCall): Promise<Record<string, unknown>> {
  const fd = c.rawBody as FormData
  expect(fd).toBeInstanceOf(FormData)
  const out: Record<string, unknown> = {}
  for (const [k, v] of fd.entries()) {
    out[k] = typeof v === 'string' ? v : { name: (v as File).name, type: (v as File).type, text: await (v as File).text() }
  }
  return out
}

const writes = (calls: FakeCall[]) => calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url.pathname}`)

function setup(over: Record<string, unknown> = {}, status = signedIn()) {
  const s = featureCtx(mediaRoutes(over), { status })
  const pick = (name: string, size = 1000) => s.files.add(`/home/me/${name}`, name, size).token
  return { ...s, pick }
}

describe('media: load', () => {
  it('photos (rank order, CDN-only URLs, decoded alt), video, files — images/videos public, files with OAuth', async () => {
    const { ctx, fetch } = setup({
      [`GET ${PUB}/images`]: paged([
        img(12, 2, { alt_text: 'Fox &amp; planner', url_75x75: 'https://evil.example/x.jpg', hex_code: null }),
        img(11, 1)
      ]),
      [`GET ${OWN}/files`]: paged([file(52, 2, { filename: 'A &amp; B.pdf' }), file(51, 1)])
    })
    const m = await runAction(mediaFeature, 'load', { listingId: L }, ctx)
    expect(m).toEqual({
      listingId: L,
      photos: [
        {
          id: 11,
          position: 1,
          rank: 1,
          url75: img(11, 1).url_75x75,
          url170: img(11, 1).url_170x135,
          url570: img(11, 1).url_570xN,
          urlFull: img(11, 1).url_fullxfull,
          width: 1500,
          height: 2000,
          altText: 'Alt 11',
          hexCode: 'E8E2DA',
          isBlackAndWhite: false
        },
        expect.objectContaining({ id: 12, position: 2, url75: null, altText: 'Fox & planner', hexCode: null })
      ],
      videos: [{ id: 31, width: 1920, height: 1080, thumbnailUrl: vid(31).thumbnail_url, state: 'active' }],
      files: [
        { id: 51, rank: 1, name: 'planner-51.pdf', sizeBytes: 1_258_291, sizeLabel: '1.2 MB', type: 'application/pdf' },
        expect.objectContaining({ id: 52, rank: 2, name: 'A & B.pdf' })
      ],
      notes: []
    })
    const by = (p: string) => fetch.calls.find((c) => c.url.pathname === p)!
    expect(by(`${PUB}/images`).headers.authorization).toBeUndefined()
    expect(by(`${PUB}/videos`).headers.authorization).toBeUndefined()
    expect(by(`${OWN}/files`).headers.authorization).toBe('Bearer tok')
    expect(fetch.calls.every((c) => c.method === 'GET' && c.url.search === '')).toBe(true)
  })

  it('photos keep Etsy\'s own rank next to their position; a file without a usable rank gets its place', async () => {
    const { ctx } = setup({
      [`GET ${PUB}/images`]: paged([img(15, 5), img(11, 1), img(13, 3)]),
      [`GET ${OWN}/files`]: paged([file(51, 0), file(52, undefined as never)])
    })
    const m = (await runAction(mediaFeature, 'load', { listingId: L }, ctx)) as {
      photos: Array<{ id: number; position: number; rank: number }>
      files: Array<{ id: number; rank: number }>
    }
    expect(m.photos.map((p) => [p.id, p.position, p.rank])).toEqual([
      [11, 1, 1],
      [13, 2, 3],
      [15, 3, 5]
    ])
    expect(m.files.map((f) => [f.id, f.rank])).toEqual([
      [51, 1],
      [52, 2]
    ])
  })

  it('a video thumbnail off the CDN is dropped', async () => {
    const { ctx } = setup({ [`GET ${PUB}/videos`]: paged([vid(31, { thumbnail_url: 'http://v.etsystatic.com/t.jpg' })]) })
    const m = (await runAction(mediaFeature, 'load', { listingId: L }, ctx)) as { videos: Array<{ thumbnailUrl: unknown }> }
    expect(m.videos[0].thumbnailUrl).toBeNull()
  })

  it('a part Etsy refuses is null with a note; the rest still answers', async () => {
    const { ctx } = setup({ [`GET ${PUB}/videos`]: { status: 500 }, [`GET ${OWN}/files`]: { status: 403, body: { error: 'no' } } })
    const m = (await runAction(mediaFeature, 'load', { listingId: L }, ctx)) as { photos: unknown[]; videos: unknown; files: unknown; notes: string[] }
    expect(m.photos).toHaveLength(3)
    expect(m.videos).toBeNull()
    expect(m.files).toBeNull()
    expect(m.notes[0]).toMatch(/^Відео: Сервер Etsy повернув помилку \(HTTP 500\)/)
    expect(m.notes[1]).toMatch(/^Файли: Etsy не дозволив цю дію \(HTTP 403\)/)
  })

  it('signed out, no listings_r, a bad id: refused before any request', async () => {
    const out = setup({}, signedOut)
    await expect(runAction(mediaFeature, 'load', { listingId: L }, out.ctx)).rejects.toThrow('Увійдіть в Etsy')
    const noRead = setup({}, signedIn({ scopes: ['listings_w'] }))
    await expect(runAction(mediaFeature, 'load', { listingId: L }, noRead.ctx)).rejects.toThrow('читання товарів')
    const bad = setup()
    await expect(runAction(mediaFeature, 'load', { listingId: 'x' }, bad.ctx)).rejects.toThrow('Некоректний listingId')
    expect([...out.fetch.calls, ...noRead.fetch.calls, ...bad.fetch.calls]).toHaveLength(0)
  })
})

describe('media: video state (getListingVideo)', () => {
  it('reads one video publicly', async () => {
    const { ctx, fetch } = setup()
    const v = await runAction(mediaFeature, 'video', { listingId: L, videoId: 31 }, ctx)
    expect(v).toEqual({ id: 31, width: 1920, height: 1080, thumbnailUrl: vid(31).thumbnail_url, state: 'inactive' })
    expect(fetch.calls[0].url.pathname).toBe(`${PUB}/videos/31`)
    expect(fetch.calls[0].headers.authorization).toBeUndefined()
  })

  it('an empty answer = no such video; a bad id is refused', async () => {
    const { ctx } = setup({ [`GET ${PUB}/videos/{id}`]: { status: 200 } })
    await expect(runAction(mediaFeature, 'video', { listingId: L, videoId: 31 }, ctx)).rejects.toThrow('немає такого відео')
    await expect(runAction(mediaFeature, 'video', { listingId: L, videoId: 0 }, ctx)).rejects.toThrow('Некоректний videoId')
  })
})

describe('media: photos', () => {
  it('addPhotos appends after the existing ones with explicit ranks, OAuth multipart, progress events', async () => {
    const { ctx, fetch, events, pick } = setup()
    const tokens = [pick('a.jpg'), pick('b.PNG')]
    const m = (await runAction(mediaFeature, 'addPhotos', { listingId: L, tokens, watermarked: true }, ctx)) as { photos: unknown[] }
    expect(m.photos).toHaveLength(3)
    const posts = fetch.calls.filter((c) => c.method === 'POST')
    expect(posts.map((c) => c.url.pathname)).toEqual([`${OWN}/images`, `${OWN}/images`])
    expect(posts[0].headers.authorization).toBe('Bearer tok')
    expect(await parts(posts[0])).toEqual({
      image: { name: 'a.jpg', type: 'image/jpeg', text: 'BYTES:/home/me/a.jpg' },
      rank: '4',
      is_watermarked: 'true'
    })
    expect(await parts(posts[1])).toEqual({
      image: { name: 'b.PNG', type: 'image/png', text: 'BYTES:/home/me/b.PNG' },
      rank: '5',
      is_watermarked: 'true'
    })
    expect(events).toEqual([
      { type: 'progress', payload: { listingId: L, kind: 'photo', name: 'a.jpg', index: 1, total: 2 } },
      { type: 'progress', payload: { listingId: L, kind: 'photo', name: 'b.PNG', index: 2, total: 2 } }
    ])
  })

  it('addPhotos refuses: over 10 photos, a wrong type, a huge file, an unknown token, no listings_w — nothing sent', async () => {
    const nine = setup({ [`GET ${PUB}/images`]: paged(Array.from({ length: 9 }, (_, i) => img(i + 1, i + 1))) })
    await expect(
      runAction(mediaFeature, 'addPhotos', { listingId: L, tokens: [nine.pick('a.jpg'), nine.pick('b.jpg')] }, nine.ctx)
    ).rejects.toThrow('до 10 фото: зараз 9, можна додати ще 1')
    expect(writes(nine.fetch.calls)).toEqual([])

    const s = setup()
    await expect(runAction(mediaFeature, 'addPhotos', { listingId: L, tokens: [s.pick('a.webp')] }, s.ctx)).rejects.toThrow(
      '«a.webp»: фото має бути JPG, JPEG, PNG, GIF.'
    )
    await expect(
      runAction(mediaFeature, 'addPhotos', { listingId: L, tokens: [s.pick('a.jpg', 21 * 1024 * 1024)] }, s.ctx)
    ).rejects.toThrow('більший за 20 МБ')
    await expect(runAction(mediaFeature, 'addPhotos', { listingId: L, tokens: ['nope'] }, s.ctx)).rejects.toThrow('виберіть його ще раз')
    await expect(runAction(mediaFeature, 'addPhotos', { listingId: L, tokens: [] }, s.ctx)).rejects.toThrow('Виберіть файл.')
    expect(s.fetch.calls).toHaveLength(0)

    const ro = setup({}, signedIn({ scopes: ['listings_r'] }))
    await expect(runAction(mediaFeature, 'addPhotos', { listingId: L, tokens: [ro.pick('a.jpg')] }, ro.ctx)).rejects.toThrow(
      'редагування товарів'
    )
    expect(ro.fetch.calls).toHaveLength(0)
  })

  it('addPhotos failing half-way says how many went in', async () => {
    let n = 0
    const { ctx, pick } = setup({
      [`POST ${OWN}/images`]: () => (++n === 2 ? { status: 400, body: { error: 'Image too small' } } : { status: 201, body: img(99, 4) })
    })
    await expect(runAction(mediaFeature, 'addPhotos', { listingId: L, tokens: [pick('a.jpg'), pick('b.jpg')] }, ctx)).rejects.toThrow(
      'Додано 1 з 2 фото; «b.jpg» не завантажено: Etsy відхилив запит як некоректний (HTTP 400). (Image too small)'
    )
  })

  it('replacePhoto uploads at the position with overwrite and alt text', async () => {
    const { ctx, fetch, pick, events } = setup()
    await runAction(mediaFeature, 'replacePhoto', { listingId: L, position: 2, token: pick('new.gif'), altText: 'Нове фото' }, ctx)
    const post = fetch.calls.find((c) => c.method === 'POST')!
    expect(post.url.pathname).toBe(`${OWN}/images`)
    expect(await parts(post)).toEqual({
      image: { name: 'new.gif', type: 'image/gif', text: 'BYTES:/home/me/new.gif' },
      rank: '2',
      overwrite: 'true',
      is_watermarked: 'false',
      alt_text: 'Нове фото'
    })
    expect(events[0].payload).toMatchObject({ kind: 'photo', name: 'new.gif', index: 1, total: 1 })
  })

  it('replacePhoto sends the Etsy rank of the photo at that position (ranks with gaps); alt text empty unless given', async () => {
    const { ctx, fetch, pick } = setup({ [`GET ${PUB}/images`]: paged([img(11, 1), img(13, 3), img(15, 5)]) })
    await runAction(mediaFeature, 'replacePhoto', { listingId: L, position: 2, token: pick('new.jpg'), watermarked: true }, ctx)
    expect(await parts(fetch.calls.find((c) => c.method === 'POST')!)).toEqual({
      image: { name: 'new.jpg', type: 'image/jpeg', text: 'BYTES:/home/me/new.jpg' },
      rank: '3',
      overwrite: 'true',
      is_watermarked: 'true',
      alt_text: ''
    })
  })

  it('replacePhoto refuses a position without a photo, beyond 10, or a too long alt text', async () => {
    const s = setup()
    await expect(runAction(mediaFeature, 'replacePhoto', { listingId: L, position: 4, token: s.pick('a.jpg') }, s.ctx)).rejects.toThrow(
      'На позиції 4 фото немає (у товару 3 фото).'
    )
    await expect(runAction(mediaFeature, 'replacePhoto', { listingId: L, position: 11, token: s.pick('a.jpg') }, s.ctx)).rejects.toThrow(
      'від 1 до 10'
    )
    await expect(
      runAction(mediaFeature, 'replacePhoto', { listingId: L, position: 1, token: s.pick('a.jpg'), altText: 'x'.repeat(501) }, s.ctx)
    ).rejects.toThrow('довше за 500')
    expect(writes(s.fetch.calls)).toEqual([])
  })

  it('setAltText re-attaches the photo at its own rank (getListingImage) with overwrite + alt_text', async () => {
    const { ctx, fetch } = setup()
    await runAction(mediaFeature, 'setAltText', { listingId: L, imageId: 12, altText: 'Лисиця з планером' }, ctx)
    expect(fetch.calls[0].url.pathname).toBe(`${PUB}/images/12`)
    expect(fetch.calls[0].headers.authorization).toBeUndefined()
    const post = fetch.calls.find((c) => c.method === 'POST')!
    expect(await parts(post)).toEqual({
      listing_image_id: '12',
      rank: '2',
      overwrite: 'true',
      is_watermarked: 'false',
      alt_text: 'Лисиця з планером'
    })
  })

  it('setAltText sends the watermark flag it is given (ListingImage does not report it)', async () => {
    const { ctx, fetch } = setup()
    await runAction(mediaFeature, 'setAltText', { listingId: L, imageId: 12, altText: 'x', watermarked: true }, ctx)
    expect(await parts(fetch.calls.find((c) => c.method === 'POST')!)).toMatchObject({ is_watermarked: 'true' })
  })

  it('setAltText: an empty answer = no such photo', async () => {
    const { ctx, fetch } = setup({ [`GET ${PUB}/images/{id}`]: { status: 200 } })
    await expect(runAction(mediaFeature, 'setAltText', { listingId: L, imageId: 12, altText: '' }, ctx)).rejects.toThrow('немає такого фото')
    expect(writes(fetch.calls)).toEqual([])
  })

  it('movePhoto: re-attach at the target with overwrite, then the displaced photo right after it', async () => {
    const { ctx, fetch } = setup()
    await runAction(mediaFeature, 'movePhoto', { listingId: L, imageId: 13, toPosition: 1 }, ctx)
    const posts = fetch.calls.filter((c) => c.method === 'POST')
    expect(await parts(posts[0])).toEqual({
      listing_image_id: '13',
      rank: '1',
      overwrite: 'true',
      is_watermarked: 'false',
      alt_text: 'Alt 13'
    })
    expect(await parts(posts[1])).toEqual({ listing_image_id: '11', rank: '2', is_watermarked: 'false', alt_text: 'Alt 11' })
  })

  it('movePhoto with gaps in the ranks: the Etsy rank of the target, the displaced photo right after it', async () => {
    const { ctx, fetch } = setup({ [`GET ${PUB}/images`]: paged([img(11, 1), img(13, 4), img(15, 7)]) })
    await runAction(mediaFeature, 'movePhoto', { listingId: L, imageId: 15, toPosition: 2, watermarked: true }, ctx)
    const posts = fetch.calls.filter((c) => c.method === 'POST')
    expect(await parts(posts[0])).toMatchObject({ listing_image_id: '15', rank: '4', overwrite: 'true', is_watermarked: 'true' })
    expect(await parts(posts[1])).toMatchObject({ listing_image_id: '13', rank: '5', is_watermarked: 'true' })
  })

  it('movePhoto: only up; a failing second step says which photo is off the listing', async () => {
    const s = setup()
    await expect(runAction(mediaFeature, 'movePhoto', { listingId: L, imageId: 11, toPosition: 2 }, s.ctx)).rejects.toThrow('лише вище')
    await expect(runAction(mediaFeature, 'movePhoto', { listingId: L, imageId: 77, toPosition: 1 }, s.ctx)).rejects.toThrow('немає такого фото')
    expect(writes(s.fetch.calls)).toEqual([])
    let n = 0
    const f = setup({ [`POST ${OWN}/images`]: () => (++n === 2 ? { status: 500 } : { status: 201, body: img(12, 1) }) })
    await expect(runAction(mediaFeature, 'movePhoto', { listingId: L, imageId: 12, toPosition: 1 }, f.ctx)).rejects.toThrow(
      'фото #11, що стояло на позиції 1, не вдалося повернути'
    )
  })

  it('deletePhoto (DELETE with OAuth) and restorePhoto (re-attach by listing_image_id)', async () => {
    const { ctx, fetch } = setup()
    const m = (await runAction(mediaFeature, 'deletePhoto', { listingId: L, imageId: 12 }, ctx)) as { listingId: number }
    expect(m.listingId).toBe(L)
    const del = fetch.calls.find((c) => c.method === 'DELETE')!
    expect(del.url.pathname).toBe(`${OWN}/images/12`)
    expect(del.headers.authorization).toBe('Bearer tok')
    await runAction(mediaFeature, 'restorePhoto', { listingId: L, imageId: 12, position: 2, altText: 'Alt 12' }, ctx)
    const post = fetch.calls.find((c) => c.method === 'POST')!
    expect(await parts(post)).toEqual({ listing_image_id: '12', rank: '2', is_watermarked: 'false', alt_text: 'Alt 12' })
  })

  it('restorePhoto: at the Etsy rank of the photo at that position, else after the last; refused at 10 photos', async () => {
    const g = setup({ [`GET ${PUB}/images`]: paged([img(11, 1), img(13, 4)]) })
    await runAction(mediaFeature, 'restorePhoto', { listingId: L, imageId: 12, position: 2 }, g.ctx)
    await runAction(mediaFeature, 'restorePhoto', { listingId: L, imageId: 12, position: 3, watermarked: true }, g.ctx)
    const posts = g.fetch.calls.filter((c) => c.method === 'POST')
    expect(await parts(posts[0])).toEqual({ listing_image_id: '12', rank: '4', is_watermarked: 'false', alt_text: '' })
    expect(await parts(posts[1])).toEqual({ listing_image_id: '12', rank: '5', is_watermarked: 'true', alt_text: '' })
    const full = setup({ [`GET ${PUB}/images`]: paged(Array.from({ length: 10 }, (_, i) => img(i + 1, i + 1))) })
    await expect(runAction(mediaFeature, 'restorePhoto', { listingId: L, imageId: 12, position: 2 }, full.ctx)).rejects.toThrow(
      'У товару вже 10 фото.'
    )
    expect(writes(full.fetch.calls)).toEqual([])
  })

  it('an Etsy error on a write is the Ukrainian message', async () => {
    const { ctx } = setup({ [`DELETE ${OWN}/images/{id}`]: { status: 404, body: { error: 'Listing image not found' } } })
    await expect(runAction(mediaFeature, 'deletePhoto', { listingId: L, imageId: 12 }, ctx)).rejects.toThrow(
      'Etsy не знайшов цей магазин або товар (HTTP 404). (Listing image not found)'
    )
  })
})

describe('media: video', () => {
  it('uploadVideo uploads `video` + `name` first, then takes the previous video (still on the listing) off', async () => {
    const { ctx, fetch, pick, events } = setup()
    await runAction(mediaFeature, 'uploadVideo', { listingId: L, token: pick('clip.mp4') }, ctx)
    expect(writes(fetch.calls)).toEqual([`POST ${OWN}/videos`, `DELETE ${OWN}/videos/31`])
    const post = fetch.calls.find((c) => c.method === 'POST')!
    expect(post.headers.authorization).toBe('Bearer tok')
    expect(await parts(post)).toEqual({ video: { name: 'clip.mp4', type: 'video/mp4', text: 'BYTES:/home/me/clip.mp4' }, name: 'clip.mp4' })
    expect(events).toEqual([{ type: 'progress', payload: { listingId: L, kind: 'video', name: 'clip.mp4', index: 1, total: 1 } }])
  })

  it('uploadVideo: a previous video Etsy already took off itself is not deleted again', async () => {
    let n = 0
    const { ctx, fetch, pick } = setup({
      [`GET ${PUB}/videos`]: () => (++n === 1 ? paged([vid(31)]) : paged([vid(31, { video_state: 'deleted' }), vid(32)]))
    })
    await runAction(mediaFeature, 'uploadVideo', { listingId: L, token: pick('clip.mp4') }, ctx)
    expect(writes(fetch.calls)).toEqual([`POST ${OWN}/videos`])
  })

  it('uploadVideo: the previous video not taken off after a good upload is reported', async () => {
    const { ctx, pick } = setup({ [`DELETE ${OWN}/videos/{id}`]: { status: 404, body: { error: 'gone' } } })
    await expect(runAction(mediaFeature, 'uploadVideo', { listingId: L, token: pick('clip.mp4') }, ctx)).rejects.toThrow(
      'Нове відео завантажено, але попереднє (#31) не вдалося зняти'
    )
  })

  it('uploadVideo with no video yet only uploads; refuses a wrong type and > 100 MB', async () => {
    const s = setup({ [`GET ${PUB}/videos`]: paged([]) })
    await runAction(mediaFeature, 'uploadVideo', { listingId: L, token: s.pick('c.mov') }, s.ctx)
    expect(writes(s.fetch.calls)).toEqual([`POST ${OWN}/videos`])
    expect((await parts(s.fetch.calls.find((c) => c.method === 'POST')!)).video).toMatchObject({ type: 'video/quicktime' })
    await expect(runAction(mediaFeature, 'uploadVideo', { listingId: L, token: s.pick('c.txt') }, s.ctx)).rejects.toThrow(
      'відео має бути MP4'
    )
    await expect(runAction(mediaFeature, 'uploadVideo', { listingId: L, token: s.pick('c.mp4', 101 * 1024 * 1024) }, s.ctx)).rejects.toThrow(
      'більший за 100 МБ'
    )
  })

  it('a refused upload leaves the current video alone', async () => {
    const { ctx, fetch, pick } = setup({ [`POST ${OWN}/videos`]: { status: 400, body: { error: 'Video too long' } } })
    await expect(runAction(mediaFeature, 'uploadVideo', { listingId: L, token: pick('clip.mp4') }, ctx)).rejects.toThrow(
      'Нове відео не завантажено, поточне лишилося: Etsy відхилив запит як некоректний (HTTP 400). (Video too long)'
    )
    expect(writes(fetch.calls)).toEqual([`POST ${OWN}/videos`])
  })

  it('the daily upload limit (429) with a current video: nothing is deleted, the video stays', async () => {
    const { ctx, fetch, pick } = setup({ [`POST ${OWN}/videos`]: { status: 429, headers: { 'retry-after': '3600' } } })
    await expect(runAction(mediaFeature, 'uploadVideo', { listingId: L, token: pick('clip.mp4') }, ctx)).rejects.toThrow(
      'не більше 10 завантажень відео на товар за добу — спробуйте завтра. Поточне відео лишилося.'
    )
    expect(writes(fetch.calls)).toEqual([`POST ${OWN}/videos`])
    const q = setup({ [`GET ${PUB}/videos`]: paged([]), [`POST ${OWN}/videos`]: { status: 429, headers: { 'retry-after': '3600' } } })
    await expect(runAction(mediaFeature, 'uploadVideo', { listingId: L, token: q.pick('clip.mp4') }, q.ctx)).rejects.toThrow(
      /за добу — спробуйте завтра\.$/
    )
  })

  it('Etsy refusing a second video (409): the current one goes off first and is put back by video_id if the upload fails', async () => {
    const calls: string[] = []
    const { ctx, fetch, pick } = setup({
      [`POST ${OWN}/videos`]: (_u: URL, init?: RequestInit) => {
        const fd = init!.body as FormData
        calls.push(fd.has('video') ? 'upload' : `reattach ${fd.get('video_id')}`)
        if (!fd.has('video')) return { status: 201, body: vid(31) }
        return calls.length === 1 ? { status: 409, body: { error: 'Listing already has a video' } } : { status: 400, body: { error: 'Video too long' } }
      }
    })
    await expect(runAction(mediaFeature, 'uploadVideo', { listingId: L, token: pick('clip.mp4') }, ctx)).rejects.toThrow(
      'Нове відео не завантажено, попереднє повернуто: Etsy відхилив запит як некоректний (HTTP 400). (Video too long)'
    )
    expect(calls).toEqual(['upload', 'upload', 'reattach 31'])
    expect(writes(fetch.calls)).toEqual([`POST ${OWN}/videos`, `DELETE ${OWN}/videos/31`, `POST ${OWN}/videos`, `POST ${OWN}/videos`])
  })

  it('409 then a good upload: delete-first swap; a failed put-back names the video', async () => {
    let n = 0
    const ok = setup({ [`POST ${OWN}/videos`]: () => (++n === 1 ? { status: 409 } : { status: 201, body: vid(32) }) })
    await runAction(mediaFeature, 'uploadVideo', { listingId: L, token: ok.pick('clip.mp4') }, ok.ctx)
    expect(writes(ok.fetch.calls)).toEqual([`POST ${OWN}/videos`, `DELETE ${OWN}/videos/31`, `POST ${OWN}/videos`])
    let m = 0
    const f = setup({ [`POST ${OWN}/videos`]: () => (++m === 1 ? { status: 409 } : { status: 400 }) })
    await expect(runAction(mediaFeature, 'uploadVideo', { listingId: L, token: f.pick('clip.mp4') }, f.ctx)).rejects.toThrow(
      'а попереднє (#31) не вдалося повернути'
    )
  })

  it('deleteVideo', async () => {
    const { ctx, fetch } = setup()
    await runAction(mediaFeature, 'deleteVideo', { listingId: L, videoId: 31 }, ctx)
    expect(writes(fetch.calls)).toEqual([`DELETE ${OWN}/videos/31`])
    expect(fetch.calls.find((c) => c.method === 'DELETE')!.headers.authorization).toBe('Bearer tok')
  })
})

describe('media: buyer files', () => {
  it('addFiles appends with `file`, `name`, `rank` after the last rank', async () => {
    const { ctx, fetch, pick, events } = setup()
    await runAction(mediaFeature, 'addFiles', { listingId: L, tokens: [pick('bonus.zip')] }, ctx)
    const post = fetch.calls.find((c) => c.method === 'POST')!
    expect(post.url.pathname).toBe(`${OWN}/files`)
    expect(post.headers.authorization).toBe('Bearer tok')
    expect(await parts(post)).toEqual({
      file: { name: 'bonus.zip', type: 'application/zip', text: 'BYTES:/home/me/bonus.zip' },
      name: 'bonus.zip',
      rank: '3'
    })
    expect(events[0].payload).toMatchObject({ kind: 'file', name: 'bonus.zip' })
  })

  it('file writes need listings_r too (they read the files first): refused before any request', async () => {
    for (const [action, args] of [
      ['addFiles', { tokens: ['x'] }],
      ['replaceFile', { fileId: 51, token: 'x' }],
      ['deleteFile', { fileId: 51 }]
    ] as const) {
      const s = setup({}, signedIn({ scopes: ['listings_w'] }))
      await expect(runAction(mediaFeature, action, { listingId: L, ...args }, s.ctx)).rejects.toThrow('читання товарів')
      expect(s.fetch.calls).toHaveLength(0)
    }
  })

  it('addFiles: at most 5 files, 20 MB each', async () => {
    const s = setup({ [`GET ${OWN}/files`]: paged([1, 2, 3, 4, 5].map((r) => file(50 + r, r))) })
    await expect(runAction(mediaFeature, 'addFiles', { listingId: L, tokens: [s.pick('x.pdf')] }, s.ctx)).rejects.toThrow(
      'до 5 файлів: зараз 5, можна додати ще 0'
    )
    await expect(runAction(mediaFeature, 'addFiles', { listingId: L, tokens: [s.pick('x.pdf', 21 * 1024 * 1024)] }, s.ctx)).rejects.toThrow(
      'більший за 20 МБ'
    )
    expect(writes(s.fetch.calls)).toEqual([])
  })

  it('replaceFile below the limit: getListingFile, upload at its rank, then delete the old one', async () => {
    const { ctx, fetch, pick } = setup()
    await runAction(mediaFeature, 'replaceFile', { listingId: L, fileId: 51, token: pick('v2.pdf') }, ctx)
    expect(fetch.calls[0].url.pathname).toBe(`${OWN}/files/51`)
    expect(fetch.calls[0].headers.authorization).toBe('Bearer tok')
    expect(writes(fetch.calls)).toEqual([`POST ${OWN}/files`, `DELETE ${OWN}/files/51`])
    expect(await parts(fetch.calls.find((c) => c.method === 'POST')!)).toEqual({
      file: { name: 'v2.pdf', type: 'application/pdf', text: 'BYTES:/home/me/v2.pdf' },
      name: 'v2.pdf',
      rank: '1'
    })
  })

  it('replaceFile: a file without a rank goes back at rank 1 (the OAS minimum), never 0', async () => {
    const { ctx, fetch, pick } = setup({ [`GET ${OWN}/files/{id}`]: { body: file(51, 0) } })
    await runAction(mediaFeature, 'replaceFile', { listingId: L, fileId: 51, token: pick('v2.pdf') }, ctx)
    expect(await parts(fetch.calls.find((c) => c.method === 'POST')!)).toMatchObject({ rank: '1' })
  })

  it('replaceFile: the old file not deleted is reported; an empty getListingFile = no such file', async () => {
    const d = setup({ [`DELETE ${OWN}/files/{id}`]: { status: 409, body: { error: 'conflict' } } })
    await expect(runAction(mediaFeature, 'replaceFile', { listingId: L, fileId: 51, token: d.pick('v2.pdf') }, d.ctx)).rejects.toThrow(
      'Новий файл додано, але старий «planner-51.pdf» не вдалося видалити'
    )
    const e = setup({ [`GET ${OWN}/files/{id}`]: { status: 200 } })
    await expect(runAction(mediaFeature, 'replaceFile', { listingId: L, fileId: 51, token: e.pick('v2.pdf') }, e.ctx)).rejects.toThrow(
      'немає такого файлу'
    )
    expect(writes(e.fetch.calls)).toEqual([])
  })

  it('replaceFile at the 5-file limit deletes first and re-attaches the old file (listing_file_id) if the upload fails', async () => {
    const bodies: Array<Record<string, unknown>> = []
    const { ctx, fetch, pick } = setup({
      [`GET ${OWN}/files`]: paged([1, 2, 3, 4, 5].map((r) => file(50 + r, r))),
      [`GET ${OWN}/files/{id}`]: { body: file(53, 3) },
      [`POST ${OWN}/files`]: (_u: URL, init?: RequestInit) => {
        const fd = init!.body as FormData
        bodies.push(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : 'FILE'])))
        return fd.has('file') ? { status: 400, body: { error: 'bad file' } } : { status: 201, body: file(53, 3) }
      }
    })
    await expect(runAction(mediaFeature, 'replaceFile', { listingId: L, fileId: 53, token: pick('v2.pdf') }, ctx)).rejects.toThrow(
      'Новий файл не завантажено, старий «planner-53.pdf» повернуто'
    )
    expect(writes(fetch.calls)).toEqual([`DELETE ${OWN}/files/53`, `POST ${OWN}/files`, `POST ${OWN}/files`])
    expect(bodies).toEqual([
      { file: 'FILE', name: 'v2.pdf', rank: '3' },
      { listing_file_id: '53', rank: '3' }
    ])
  })

  it('deleteFile', async () => {
    const { ctx, fetch } = setup()
    await runAction(mediaFeature, 'deleteFile', { listingId: L, fileId: 52 }, ctx)
    expect(writes(fetch.calls)).toEqual([`DELETE ${OWN}/files/52`])
  })

  it('a 5xx on a write is retried once, then the Ukrainian server error', async () => {
    const { ctx, fetch } = setup({ [`DELETE ${OWN}/files/{id}`]: { status: 503 } })
    await expect(runAction(mediaFeature, 'deleteFile', { listingId: L, fileId: 52 }, ctx)).rejects.toThrow('HTTP 503')
    expect(writes(fetch.calls)).toHaveLength(2)
  })
})

// ------------------------------------------------------------------ MCP

const b64 = (s: string) => Buffer.from(s).toString('base64')

function mcp(over: Record<string, unknown> = {}, opts: Parameters<typeof mcpDeps>[1] = {}) {
  return mcpDeps(mediaRoutes(over), opts)
}

describe('media: MCP tools', () => {
  it('the tools match MEDIA_TOOL_SUMMARY (names, order, write flags); writes are destructive except alt text', () => {
    const tools = mediaFeature.mcpTools!(mcp().deps)
    expect(tools.map((t) => t.name)).toEqual(MEDIA_TOOL_SUMMARY.map((t) => t.name))
    expect(tools.map((t) => t.readOnly === false)).toEqual(MEDIA_TOOL_SUMMARY.map((t) => !!t.write))
    expect(tools.filter((t) => t.readOnly === false && !t.destructive).map((t) => t.name)).toEqual(['set_my_photo_alt_text'])
    for (const t of tools) {
      expect(t.inputSchema.additionalProperties).toBe(false)
      if (t.readOnly === false) expect(t.description).toContain("Changes the user's live store — only call it when the user asked")
    }
  })

  it('list_my_product_media: photos, video, files — no URLs', async () => {
    const { deps, fetch } = mcp()
    const r = await callTool(mediaFeature, deps, 'list_my_product_media', { product_id: L })
    expect(r.isError).toBe(false)
    expect(r.json.photos[0]).toEqual({
      id: 11,
      position: 1,
      width: 1500,
      height: 2000,
      sizes: ['thumbnail_75', 'thumbnail_170', 'medium_570', 'full'],
      alt_text: 'Alt 11',
      average_color_hex: 'E8E2DA',
      black_and_white: false
    })
    expect(r.json.video).toEqual({ id: 31, state: 'active', width: 1920, height: 1080 })
    expect(r.json.files[0]).toEqual({ id: 51, position: 1, name: 'planner-51.pdf', size_bytes: 1_258_291, size: '1.2 MB', type: 'application/pdf' })
    expect(r.json).toMatchObject({ product_id: L, max_photos: 10, max_files: 5, notes: [] })
    expect(r.text).not.toMatch(/https?:\/\//)
    expect(fetch.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it('list_my_product_media: a refused part is null with a neutral English note; signed out / no permission', async () => {
    const { deps } = mcp({ [`GET ${OWN}/files`]: { status: 403, body: { error: 'Etsy says no: https://www.etsy.com/x' } } })
    const r = await callTool(mediaFeature, deps, 'list_my_product_media', { product_id: L })
    expect(r.json.files).toBeNull()
    expect(r.json.notes).toEqual(['The files could not be read: The store refused this action (HTTP 403): marketplace says no: [link].'])
    const out = await callTool(mediaFeature, mcp({}, { status: signedOut }).deps, 'list_my_product_media', { product_id: L })
    expect(out.isError).toBe(true)
    expect(out.text).toBe(NOT_SIGNED_IN)
    const scope = await callTool(mediaFeature, mcp({}, { status: signedIn({ scopes: ['listings_w'] }) }).deps, 'list_my_product_media', {
      product_id: L
    })
    expect(scope.text).toContain('lacks a permission this needs (listings_r)')
  })

  it('delete_my_product_photo: DELETE, then the fresh media', async () => {
    const { deps, fetch } = mcp()
    const r = await callTool(mediaFeature, deps, 'delete_my_product_photo', { product_id: L, photo_id: 12 })
    expect(r.isError).toBe(false)
    expect(r.json.done).toBe('photo 12 deleted')
    expect(r.json.photos).toHaveLength(3)
    expect(writes(fetch.calls)).toEqual([`DELETE ${OWN}/images/12`])
  })

  it('replace_my_product_photo: base64 content → image at rank with overwrite + alt_text', async () => {
    const { deps, fetch } = mcp()
    const r = await callTool(mediaFeature, deps, 'replace_my_product_photo', {
      product_id: L,
      position: 1,
      photo: { data_base64: b64('PNGDATA'), name: 'cover.png' },
      alt_text: 'Cover'
    })
    expect(r.isError).toBe(false)
    expect(await parts(fetch.calls.find((c) => c.method === 'POST')!)).toEqual({
      image: { name: 'cover.png', type: 'image/png', text: 'PNGDATA' },
      rank: '1',
      overwrite: 'true',
      is_watermarked: 'false',
      alt_text: 'Cover'
    })
  })

  it('replace_my_product_photo: a local path (read through deps), a wrong type, a missing position', async () => {
    const { deps, fetch } = mcp(
      {},
      {
        statFile: async () => ({ size: 10, isFile: true }),
        readFile: async (p: string) => new Uint8Array(Buffer.from(`FILE:${p}`)) as Uint8Array<ArrayBuffer>
      }
    )
    const ok = await callTool(mediaFeature, deps, 'replace_my_product_photo', { product_id: L, position: 2, photo: { path: '/tmp/x.jpg' } })
    expect(ok.isError).toBe(false)
    expect(await parts(fetch.calls.find((c) => c.method === 'POST')!)).toEqual({
      image: { name: 'x.jpg', type: 'image/jpeg', text: 'FILE:/tmp/x.jpg' },
      rank: '2',
      overwrite: 'true',
      is_watermarked: 'false',
      alt_text: ''
    })
    const type = await callTool(mediaFeature, deps, 'replace_my_product_photo', { product_id: L, position: 2, photo: { path: '/tmp/x.bmp' } })
    expect(type.text).toBe('"x.bmp": a photo must be JPG, JPEG, PNG, GIF.')
    const far = await callTool(mediaFeature, deps, 'replace_my_product_photo', { product_id: L, position: 5, photo: { path: '/tmp/x.jpg' } })
    expect(far.text).toBe('There is no photo at position 5 (the product has 3).')
    const big = await callTool(mediaFeature, deps, 'replace_my_product_photo', { product_id: L, position: 11, photo: { path: '/tmp/x.jpg' } })
    expect(big.text).toContain('must be ≤ 10')
    const none = await callTool(mediaFeature, deps, 'replace_my_product_photo', { product_id: L, position: 1, photo: {} })
    expect(none.text).toBe('Each photo needs "path" or "data_base64".')
  })

  it('set_my_photo_alt_text: re-attach at its rank with overwrite + alt_text; a too long text is refused', async () => {
    const { deps, fetch } = mcp()
    const r = await callTool(mediaFeature, deps, 'set_my_photo_alt_text', { product_id: L, photo_id: 13, alt_text: 'Fox' })
    expect(r.json.done).toBe('alt text of photo 13 set')
    expect(await parts(fetch.calls.find((c) => c.method === 'POST')!)).toEqual({
      listing_image_id: '13',
      rank: '2',
      overwrite: 'true',
      is_watermarked: 'false',
      alt_text: 'Fox'
    })
    const wm = mcp()
    await callTool(mediaFeature, wm.deps, 'set_my_photo_alt_text', { product_id: L, photo_id: 13, alt_text: 'Fox', watermarked: true })
    expect(await parts(wm.fetch.calls.find((c) => c.method === 'POST')!)).toMatchObject({ is_watermarked: 'true' })
    const long = await callTool(mediaFeature, deps, 'set_my_photo_alt_text', { product_id: L, photo_id: 13, alt_text: 'x'.repeat(501) })
    expect(long.text).toContain('at most 500 characters')
  })

  it('upload_my_product_video: replaces the current video; the daily limit in English', async () => {
    const { deps, fetch } = mcp()
    const r = await callTool(mediaFeature, deps, 'upload_my_product_video', { product_id: L, video: { data_base64: b64('MP4'), name: 'clip.mp4' } })
    expect(r.json.done).toBe('video "clip.mp4" uploaded')
    expect(writes(fetch.calls)).toEqual([`POST ${OWN}/videos`, `DELETE ${OWN}/videos/31`])
    expect(await parts(fetch.calls.find((c) => c.method === 'POST')!)).toEqual({ video: { name: 'clip.mp4', type: 'video/mp4', text: 'MP4' }, name: 'clip.mp4' })
    const q = mcp({ [`GET ${PUB}/videos`]: paged([]), [`POST ${OWN}/videos`]: { status: 429, headers: { 'retry-after': '3600' } } })
    const quota = await callTool(mediaFeature, q.deps, 'upload_my_product_video', { product_id: L, video: { data_base64: b64('MP4'), name: 'clip.mp4' } })
    expect(quota.isError).toBe(true)
    expect(quota.text).toBe('At most 10 video uploads per product per day — try again tomorrow: Too many requests right now — try again in a minute.')
    const kept = mcp({ [`POST ${OWN}/videos`]: { status: 429, headers: { 'retry-after': '3600' } } })
    const k = await callTool(mediaFeature, kept.deps, 'upload_my_product_video', { product_id: L, video: { data_base64: b64('MP4'), name: 'clip.mp4' } })
    expect(k.text).toMatch(/^At most 10 video uploads per product per day — try again tomorrow; the current video was kept:/)
    expect(writes(kept.fetch.calls)).toEqual([`POST ${OWN}/videos`])
    const bad = await callTool(mediaFeature, deps, 'upload_my_product_video', { product_id: L, video: { data_base64: b64('x'), name: 'clip.gif' } })
    expect(bad.text).toBe('"clip.gif": a video must be MP4, MOV, M4V, WEBM, AVI, MKV.')
  })

  it('delete_my_product_video / delete_my_product_file', async () => {
    const { deps, fetch } = mcp()
    expect((await callTool(mediaFeature, deps, 'delete_my_product_video', { product_id: L, video_id: 31 })).json.done).toBe('video 31 deleted')
    expect((await callTool(mediaFeature, deps, 'delete_my_product_file', { product_id: L, file_id: 52 })).json.done).toBe('file 52 deleted')
    expect(writes(fetch.calls)).toEqual([`DELETE ${OWN}/videos/31`, `DELETE ${OWN}/files/52`])
  })

  it('replace_my_product_file: upload at the old rank, delete the old; a half-done failure in English', async () => {
    const { deps, fetch } = mcp()
    const r = await callTool(mediaFeature, deps, 'replace_my_product_file', { product_id: L, file_id: 51, file: { data_base64: b64('PDF'), name: 'v2.pdf' } })
    expect(r.json.done).toBe('file 51 replaced with "v2.pdf"')
    expect(writes(fetch.calls)).toEqual([`POST ${OWN}/files`, `DELETE ${OWN}/files/51`])
    expect(await parts(fetch.calls.find((c) => c.method === 'POST')!)).toEqual({ file: { name: 'v2.pdf', type: 'application/pdf', text: 'PDF' }, name: 'v2.pdf', rank: '1' })
    const f = mcp({ [`DELETE ${OWN}/files/{id}`]: { status: 404, body: { error: 'gone' } } })
    const half = await callTool(mediaFeature, f.deps, 'replace_my_product_file', { product_id: L, file_id: 51, file: { data_base64: b64('PDF'), name: 'v2.pdf' } })
    expect(half.text).toBe('The new file was added, but the old file 51 could not be deleted: Not found (HTTP 404): gone.')
  })

  it('every write: changes off → WRITES_OFF, signed out → NOT_SIGNED_IN, no request', async () => {
    const args: Record<string, Record<string, unknown>> = {
      delete_my_product_photo: { product_id: L, photo_id: 12 },
      replace_my_product_photo: { product_id: L, position: 1, photo: { data_base64: b64('x'), name: 'a.jpg' } },
      set_my_photo_alt_text: { product_id: L, photo_id: 12, alt_text: '' },
      upload_my_product_video: { product_id: L, video: { data_base64: b64('x'), name: 'a.mp4' } },
      delete_my_product_video: { product_id: L, video_id: 31 },
      delete_my_product_file: { product_id: L, file_id: 51 },
      replace_my_product_file: { product_id: L, file_id: 51, file: { data_base64: b64('x'), name: 'a.pdf' } }
    }
    expect(Object.keys(args)).toEqual(MEDIA_TOOL_SUMMARY.filter((t) => t.write).map((t) => t.name))
    for (const [name, a] of Object.entries(args)) {
      const off = mcp({}, { writes: false })
      expect((await callTool(mediaFeature, off.deps, name, a)).text).toBe(WRITES_OFF)
      const out = mcp({}, { status: signedOut })
      expect((await callTool(mediaFeature, out.deps, name, a)).text).toBe(NOT_SIGNED_IN)
      const ro = mcp({}, { status: signedIn({ scopes: ['listings_r'] }) })
      expect((await callTool(mediaFeature, ro.deps, name, a)).text).toContain('(listings_w)')
      const wo = mcp({}, { status: signedIn({ scopes: ['listings_w'] }) })
      expect((await callTool(mediaFeature, wo.deps, name, a)).text).toContain('(listings_r)')
      expect([...off.fetch.calls, ...out.fetch.calls, ...ro.fetch.calls, ...wo.fetch.calls]).toHaveLength(0)
    }
  })

  it('neutrality sweep: no marketplace name and no URL in anything a client gets', async () => {
    const etsyText = 'Etsy &amp; https://www.etsy.com/listing/1 i.etsystatic.com'
    const { deps } = mcp({
      [`GET ${PUB}/images`]: paged([img(11, 1, { alt_text: etsyText }), img(12, 2)]),
      [`GET ${PUB}/images/{id}`]: { body: img(11, 1, { alt_text: etsyText }) },
      [`GET ${OWN}/files`]: paged([file(51, 1, { filename: 'etsy-guide.pdf' })]),
      [`GET ${OWN}/files/{id}`]: { body: file(51, 1, { filename: 'etsy-guide.pdf' }) },
      [`POST ${OWN}/videos`]: { status: 400, body: { error: 'Etsy: see https://help.etsy.com' } },
      [`DELETE ${OWN}/images/{id}`]: { status: 403, body: { error: 'Not your Etsy shop' } }
    })
    const tools = mediaFeature.mcpTools!(deps)
    const texts: string[] = [JSON.stringify(tools.map((t) => ({ n: t.name, t: t.title, d: t.description, s: t.inputSchema })))]
    const calls: Array<[string, Record<string, unknown>]> = [
      ['list_my_product_media', { product_id: L }],
      ['delete_my_product_photo', { product_id: L, photo_id: 11 }],
      ['replace_my_product_photo', { product_id: L, position: 1, photo: { data_base64: b64('x'), name: 'etsy.jpg' } }],
      ['set_my_photo_alt_text', { product_id: L, photo_id: 11, alt_text: 'x' }],
      ['upload_my_product_video', { product_id: L, video: { data_base64: b64('x'), name: 'etsy.mp4' } }],
      ['delete_my_product_video', { product_id: L, video_id: 31 }],
      ['delete_my_product_file', { product_id: L, file_id: 51 }],
      ['replace_my_product_file', { product_id: L, file_id: 51, file: { data_base64: b64('x'), name: 'etsy-v2.pdf' } }]
    ]
    expect(calls.map(([n]) => n)).toEqual(tools.map((t) => t.name))
    for (const [name, a] of calls) texts.push((await callTool(mediaFeature, deps, name, a)).text)
    texts.push((await callTool(mediaFeature, mcp({}, { status: signedOut }).deps, 'list_my_product_media', { product_id: L })).text)
    // A refused upload names the user's file — which may name the marketplace.
    const badName = [
      ['replace_my_product_photo', { product_id: L, position: 1, photo: { data_base64: b64('x'), name: 'etsy-listing.bmp' } }],
      ['upload_my_product_video', { product_id: L, video: { data_base64: b64('x'), name: 'etsy-clip.gif' } }]
    ] as const
    for (const [name, a] of badName) {
      const r = await callTool(mediaFeature, deps, name, a)
      expect(r.isError).toBe(true)
      expect(r.text).toContain('marketplace-')
      texts.push(r.text)
    }
    for (const t of texts) {
      expect(t).not.toMatch(/etsy/i)
      expect(t).not.toMatch(/https?:\/\//)
    }
    expect(texts.join(' ')).toContain('marketplace & [link]')
  })
})
