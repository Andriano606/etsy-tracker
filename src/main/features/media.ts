// Feature "media": the photos, video and buyer files of one of the user's own
// listings — list, add, replace, re-order (photos), alt text, delete. Every
// write answers the listing's media read afresh (what Etsy has now).

import { MAX_ALT_TEXT, mediaProblemText, type ListingMedia, type MediaKind, type MediaProgress } from '../../shared/features/media'
import { MAX_IMAGES } from '../../shared/myShop'
import { FeatureError, idArg, ownShop, strArg } from './common'
import { mediaTools } from './media/mcp'
import {
  READ_SCOPES,
  WRITE_SCOPES,
  addFiles,
  addPhotos,
  deleteFile,
  deletePhoto,
  deleteVideo,
  getVideo,
  loadMedia,
  mimeFor,
  movePhotoUp,
  replaceFile,
  replacePhoto,
  replaceVideo,
  restorePhoto,
  setAltText,
  type Upload
} from './media/ops'
import type { Feature, FeatureCtx } from './types'

type Args = Record<string, unknown>

/** Picked-file tokens → lazy uploads, every file checked (type, size) before anything is sent. */
function pickedUploads(ctx: FeatureCtx, tokens: unknown, kind: MediaKind): Array<() => Promise<Upload>> {
  const list = Array.isArray(tokens) ? tokens : [tokens]
  if (!list.length) throw new FeatureError('Виберіть файл.')
  const files = list.map((t) => {
    const f = typeof t === 'string' ? ctx.files.get(t) : null
    if (!f) throw new FeatureError('Файл не знайдено — виберіть його ще раз.')
    const problem = mediaProblemText(kind, f.name, f.size)
    if (problem) throw new FeatureError(problem)
    return f
  })
  return files.map((f) => async () => ({ data: await ctx.readFile(f.path), name: f.name, type: mimeFor(kind, f.name) }))
}

const progress =
  (ctx: FeatureCtx, listingId: number, kind: MediaKind) =>
  (name: string, index: number, total: number): void =>
    ctx.emit('progress', { listingId, kind, name, index, total } satisfies MediaProgress)

const altArg = (a: Args): string => strArg(a, 'altText', { optional: true, max: MAX_ALT_TEXT })
/** Etsy can't tell whether a photo is watermarked: every upload/re-attach sends the user's choice. */
const watermarkArg = (a: Args): { watermarked: boolean } => ({ watermarked: a.watermarked === true })

function positionArg(a: Args, name: string): number {
  const n = idArg(a, name)
  if (n > MAX_IMAGES) throw new FeatureError(`Позиція фото — від 1 до ${MAX_IMAGES}.`)
  return n
}

/** An own-listing write: checks sign-in + scopes, runs `change`, answers the fresh media. */
function write(change: (ctx: FeatureCtx, shopId: number, listingId: number, a: Args) => Promise<void>) {
  return async (a: Args, ctx: FeatureCtx): Promise<ListingMedia> => {
    const listingId = idArg(a, 'listingId')
    const shopId = ownShop(ctx.authStatus, WRITE_SCOPES)
    await change(ctx, shopId, listingId, a)
    return loadMedia(ctx.client, shopId, listingId)
  }
}

export const mediaFeature: Feature = {
  id: 'media',
  actions: {
    load: (a, ctx) => loadMedia(ctx.client, ownShop(ctx.authStatus, READ_SCOPES), idArg(a, 'listingId')),
    video: (a, ctx) => {
      ownShop(ctx.authStatus)
      return getVideo(ctx.client, idArg(a, 'listingId'), idArg(a, 'videoId'))
    },
    addPhotos: write((ctx, shop, id, a) =>
      addPhotos(ctx.client, shop, id, pickedUploads(ctx, a.tokens, 'photo'), {
        ...watermarkArg(a),
        onEach: progress(ctx, id, 'photo')
      })
    ),
    replacePhoto: write(async (ctx, shop, id, a) => {
      const position = positionArg(a, 'position')
      const altText = altArg(a)
      const [read] = pickedUploads(ctx, a.token, 'photo')
      const image = await read()
      progress(ctx, id, 'photo')(image.name, 1, 1)
      await replacePhoto(ctx.client, shop, id, position, image, { altText, ...watermarkArg(a) })
    }),
    setAltText: write((ctx, shop, id, a) => setAltText(ctx.client, shop, id, idArg(a, 'imageId'), altArg(a), watermarkArg(a))),
    movePhoto: write((ctx, shop, id, a) =>
      movePhotoUp(ctx.client, shop, id, idArg(a, 'imageId'), positionArg(a, 'toPosition'), watermarkArg(a))
    ),
    deletePhoto: write((ctx, shop, id, a) => deletePhoto(ctx.client, shop, id, idArg(a, 'imageId'))),
    restorePhoto: write((ctx, shop, id, a) =>
      restorePhoto(ctx.client, shop, id, idArg(a, 'imageId'), positionArg(a, 'position'), { altText: altArg(a), ...watermarkArg(a) })
    ),
    uploadVideo: write(async (ctx, shop, id, a) => {
      const [read] = pickedUploads(ctx, a.token, 'video')
      const video = await read()
      progress(ctx, id, 'video')(video.name, 1, 1)
      await replaceVideo(ctx.client, shop, id, video)
    }),
    deleteVideo: write((ctx, shop, id, a) => deleteVideo(ctx.client, shop, id, idArg(a, 'videoId'))),
    addFiles: write((ctx, shop, id, a) => addFiles(ctx.client, shop, id, pickedUploads(ctx, a.tokens, 'file'), progress(ctx, id, 'file'))),
    replaceFile: write(async (ctx, shop, id, a) => {
      const fileId = idArg(a, 'fileId')
      const [read] = pickedUploads(ctx, a.token, 'file')
      const file = await read()
      progress(ctx, id, 'file')(file.name, 1, 1)
      await replaceFile(ctx.client, shop, id, fileId, file)
    }),
    deleteFile: write((ctx, shop, id, a) => deleteFile(ctx.client, shop, id, idArg(a, 'fileId')))
  },
  mcpTools: mediaTools
}
