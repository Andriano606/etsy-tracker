// The Etsy calls of feature "media", each as the OAS defines it. Reads of
// images/videos are public (API key only); files and every write need OAuth.
// Errors of our own carry a Ukrainian message (the app) and an English one (MCP).

import type { ListingMedia, MediaFile, MediaKind, MediaPhoto, MediaVideo } from '../../../shared/features/media'
import { isEtsyCdnUrl } from '../../../shared/externalUrl'
import { decodeHtmlEntities } from '../../../shared/html'
import { MAX_DIGITAL_FILES, MAX_IMAGES } from '../../../shared/myShop'
import { EtsyApiError, type EtsyClient, type EtsyListingImage, type EtsyListingVideo, type Paged } from '../../etsyApi'
import { mimeOf } from '../../myShop'
import { FeatureError } from '../common'

/** OAS security of the reads that need a sign-in (getAllListingFiles, getListingFile). */
export const READ_SCOPES = ['listings_r'] as const
/**
 * A write: listings_w (the OAS security of every upload/delete here) +
 * listings_r — file writes read the files first and every write answers the
 * listing's media read afresh, files included.
 */
export const WRITE_SCOPES = ['listings_r', 'listings_w'] as const

/** OAS `ShopListingFile`. */
export interface EtsyListingFile {
  listing_file_id: number
  listing_id?: number
  rank?: number
  filename?: string
  filesize?: string
  size_bytes?: number
  filetype?: string
}

/** Bytes to send (from a picked file or an MCP media item). */
export interface Upload {
  data: Uint8Array<ArrayBuffer>
  name: string
  type: string
}

/**
 * A refused or half-done change: `message` in Ukrainian (the app), `en` for
 * MCP clients; `cause` = the failing Etsy call's error, if any.
 */
export class MediaError extends FeatureError {
  constructor(
    message: string,
    public en: string,
    public cause?: unknown
  ) {
    super(message)
  }
}

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska'
}

/** The content type an upload is sent with. */
export function mimeFor(kind: MediaKind, name: string): string {
  if (kind !== 'video') return mimeOf(name)
  return VIDEO_MIME[(/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()] ?? 'application/octet-stream'
}

const cdn = (u: unknown): string | null => (typeof u === 'string' && isEtsyCdnUrl(u) ? u : null)
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const why = (e: unknown): string => (e instanceof Error ? e.message : String(e))
const succeeds = (f: () => Promise<unknown>): Promise<boolean> => f().then(() => true, () => false)
/** Etsy's rank if it is a usable one (an integer ≥ 1), else `fallback`. */
const rankOr = (v: unknown, fallback: number): number => (Number.isInteger(v) && (v as number) >= 1 ? (v as number) : fallback)

export function toPhoto(i: EtsyListingImage, position: number): MediaPhoto {
  return {
    id: i.listing_image_id,
    position,
    rank: rankOr(i.rank, position),
    url75: cdn(i.url_75x75),
    url170: cdn(i.url_170x135),
    url570: cdn(i.url_570xN),
    urlFull: cdn(i.url_fullxfull),
    width: int(i.full_width),
    height: int(i.full_height),
    altText: i.alt_text ? decodeHtmlEntities(i.alt_text) : '',
    hexCode: typeof i.hex_code === 'string' && i.hex_code ? i.hex_code : null,
    isBlackAndWhite: typeof i.is_black_and_white === 'boolean' ? i.is_black_and_white : null
  }
}

export function toVideo(v: EtsyListingVideo): MediaVideo {
  return {
    id: v.video_id,
    width: int(v.width),
    height: int(v.height),
    thumbnailUrl: cdn(v.thumbnail_url),
    state: typeof v.video_state === 'string' ? v.video_state : null
  }
}

/** `fallback` = the rank to use when Etsy gives none (its index + 1 in a list). */
export function toFile(f: EtsyListingFile, fallback: number): MediaFile {
  return {
    id: f.listing_file_id,
    rank: rankOr(f.rank, fallback),
    name: f.filename ? decodeHtmlEntities(f.filename) : `#${f.listing_file_id}`,
    sizeBytes: int(f.size_bytes),
    sizeLabel: typeof f.filesize === 'string' && f.filesize ? f.filesize : null,
    type: typeof f.filetype === 'string' && f.filetype ? f.filetype : null
  }
}

const pub = (listingId: number): string => `/v3/application/listings/${listingId}`
const own = (shopId: number, listingId: number): string => `/v3/application/shops/${shopId}/listings/${listingId}`
const results = <T>(p: Paged<T> | undefined): T[] => (Array.isArray(p?.results) ? p.results : [])

const NO_PHOTO = () => new MediaError('У цього товару немає такого фото.', 'No such photo in this product.')

// ---------------------------------------------------------------- reads

/** getListingImages (public): in rank order, positions 1…n (`rank` keeps Etsy's own). */
export async function getPhotos(client: EtsyClient, listingId: number): Promise<MediaPhoto[]> {
  const page = await client.call<Paged<EtsyListingImage>>(`${pub(listingId)}/images`)
  return [...results(page)].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).map((i, n) => toPhoto(i, n + 1))
}

/** getListingImage (public) — alone it can't count positions: `position` = Etsy's rank. */
export async function getPhoto(client: EtsyClient, listingId: number, imageId: number): Promise<MediaPhoto> {
  const i = await client.call<EtsyListingImage>(`${pub(listingId)}/images/${imageId}`)
  if (!i?.listing_image_id) throw NO_PHOTO()
  return toPhoto(i, rankOr(i.rank, 1))
}

/** getListingVideos (public). */
export async function getVideos(client: EtsyClient, listingId: number): Promise<MediaVideo[]> {
  return results(await client.call<Paged<EtsyListingVideo>>(`${pub(listingId)}/videos`)).map(toVideo)
}

/** getListingVideo (public) — e.g. whether Etsy finished processing an upload. */
export async function getVideo(client: EtsyClient, listingId: number, videoId: number): Promise<MediaVideo> {
  const v = await client.call<EtsyListingVideo>(`${pub(listingId)}/videos/${videoId}`)
  if (!v?.video_id) throw new MediaError('У цього товару немає такого відео.', 'No such video in this product.')
  return toVideo(v)
}

/** getAllListingFiles (OAuth listings_r), by rank. A physical listing has none. */
export async function getFiles(client: EtsyClient, shopId: number, listingId: number): Promise<MediaFile[]> {
  const page = await client.call<Paged<EtsyListingFile>>(`${own(shopId, listingId)}/files`, { oauth: true })
  return results(page)
    .map((f, n) => toFile(f, n + 1))
    .sort((a, b) => a.rank - b.rank)
}

/** getListingFile (OAuth listings_r); an empty answer = no such file. */
export async function getFile(client: EtsyClient, shopId: number, listingId: number, fileId: number): Promise<MediaFile> {
  const f = await client.call<EtsyListingFile>(`${own(shopId, listingId)}/files/${fileId}`, { oauth: true })
  if (!f?.listing_file_id) throw new MediaError('У цього товару немає такого файлу.', 'No such file in this product.')
  return toFile(f, 1)
}

export type MediaPart = 'photos' | 'videos' | 'files'

const PART_UK: Record<MediaPart, string> = { photos: 'Фото', videos: 'Відео', files: 'Файли' }

/** Photos, videos and files of a listing — each read on its own (a refusal becomes a note). */
export async function loadMedia(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  describe: (part: MediaPart, e: unknown) => string = (part, e) => `${PART_UK[part]}: ${why(e)}`
): Promise<ListingMedia> {
  const out: ListingMedia = { listingId, photos: null, videos: null, files: null, notes: [] }
  const part = async <K extends MediaPart>(k: K, read: () => Promise<NonNullable<ListingMedia[K]>>): Promise<void> => {
    try {
      out[k] = await read()
    } catch (e) {
      out.notes.push(describe(k, e))
    }
  }
  await part('photos', () => getPhotos(client, listingId))
  await part('videos', () => getVideos(client, listingId))
  await part('files', () => getFiles(client, shopId, listingId))
  return out
}

// ---------------------------------------------------------------- photos

export interface ImagePost {
  image?: Upload
  /** Re-attach an image of this listing (also a deleted one) instead of uploading. */
  listingImageId?: number
  rank?: number
  /** Replace the image at `rank`. */
  overwrite?: boolean
  altText?: string
  watermarked?: boolean
}

const blob = (u: Upload): Blob => new Blob([u.data], { type: u.type })

/** uploadListingImage (OAuth listings_w, multipart). */
export async function postImage(client: EtsyClient, shopId: number, listingId: number, p: ImagePost): Promise<void> {
  const fd = new FormData()
  if (p.image) fd.set('image', blob(p.image), p.image.name)
  if (p.listingImageId != null) fd.set('listing_image_id', String(p.listingImageId))
  if (p.rank != null) fd.set('rank', String(p.rank))
  if (p.overwrite != null) fd.set('overwrite', String(p.overwrite))
  if (p.watermarked != null) fd.set('is_watermarked', String(p.watermarked))
  // The OAS default alt_text is "" — re-attaching without it would clear it.
  if (p.altText != null) fd.set('alt_text', p.altText)
  await client.call(`${own(shopId, listingId)}/images`, { method: 'POST', oauth: true, multipart: fd })
}

/** deleteListingImage (OAuth listings_w). Etsy keeps a copy: postImage({listingImageId}) brings it back. */
export async function deletePhoto(client: EtsyClient, shopId: number, listingId: number, imageId: number): Promise<void> {
  await client.call(`${own(shopId, listingId)}/images/${imageId}`, { method: 'DELETE', oauth: true })
}

/** A file of a batch is about to be sent (1-based index). */
export type OnEach = (name: string, index: number, total: number) => void

/** Append photos after the existing ones (explicit ranks: the OAS default rank is 1 = first). */
export async function addPhotos(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  uploads: Array<() => Promise<Upload>>,
  opts: { watermarked?: boolean; onEach?: OnEach } = {}
): Promise<void> {
  const have = (await getPhotos(client, listingId)).length
  if (have + uploads.length > MAX_IMAGES) {
    throw new MediaError(
      `У товару може бути до ${MAX_IMAGES} фото: зараз ${have}, можна додати ще ${Math.max(0, MAX_IMAGES - have)}.`,
      `A product can have at most ${MAX_IMAGES} photos: it has ${have}.`
    )
  }
  for (const [i, read] of uploads.entries()) {
    const image = await read()
    opts.onEach?.(image.name, i + 1, uploads.length)
    try {
      await postImage(client, shopId, listingId, { image, rank: have + i + 1, watermarked: opts.watermarked })
    } catch (e) {
      throw new MediaError(
        `Додано ${i} з ${uploads.length} фото; «${image.name}» не завантажено: ${why(e)}`,
        `${i} of ${uploads.length} photos added; "${image.name}" failed`,
        e
      )
    }
  }
}

/**
 * The OAS ListingImage has no is_watermarked, so a re-attach can't keep the
 * flag: it sends what the caller says (default false = the OAS default).
 */
export interface Reattach {
  watermarked?: boolean
}

/**
 * Replace the photo at `position` (uploadListingImage at that photo's own
 * Etsy rank + overwrite). The new photo gets `altText` (default empty — the
 * old photo's description doesn't describe it).
 */
export async function replacePhoto(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  position: number,
  image: Upload,
  opts: { altText?: string; watermarked?: boolean } = {}
): Promise<void> {
  const photos = await getPhotos(client, listingId)
  const target = photos[position - 1]
  if (!target) {
    throw new MediaError(
      `На позиції ${position} фото немає (у товару ${photos.length} фото).`,
      `There is no photo at position ${position} (the product has ${photos.length}).`
    )
  }
  const { altText = '', watermarked = false } = opts
  await postImage(client, shopId, listingId, { image, rank: target.rank, overwrite: true, altText, watermarked })
}

/**
 * New alt text for a photo: the OAS has no image update, so the photo is
 * re-attached at its own rank (getListingImage) with overwrite + alt_text.
 */
export async function setAltText(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  imageId: number,
  altText: string,
  { watermarked = false }: Reattach = {}
): Promise<void> {
  const p = await getPhoto(client, listingId, imageId)
  await postImage(client, shopId, listingId, { listingImageId: imageId, rank: p.rank, overwrite: true, altText, watermarked })
}

/** Re-attach a deleted photo (Etsy keeps a copy) at `position` — before the photo there now, or last. */
export async function restorePhoto(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  imageId: number,
  position: number,
  { altText = '', watermarked = false }: Reattach & { altText?: string } = {}
): Promise<void> {
  const photos = await getPhotos(client, listingId)
  if (photos.length >= MAX_IMAGES) {
    throw new MediaError(`У товару вже ${MAX_IMAGES} фото.`, `The product already has ${MAX_IMAGES} photos.`)
  }
  const rank = photos[position - 1]?.rank ?? (photos.at(-1)?.rank ?? 0) + 1
  await postImage(client, shopId, listingId, { listingImageId: imageId, rank, altText, watermarked })
}

/**
 * Move a photo up to `toPosition` (1 = main). The OAS has no reorder call:
 * the photo is re-attached at the Etsy rank of the photo there with overwrite
 * (which takes that photo off the listing), then that one is re-attached
 * right after it.
 */
export async function movePhotoUp(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  imageId: number,
  toPosition: number,
  { watermarked = false }: Reattach = {}
): Promise<void> {
  const photos = await getPhotos(client, listingId)
  const me = photos.find((p) => p.id === imageId)
  if (!me) throw NO_PHOTO()
  if (toPosition >= me.position) throw new MediaError('Фото можна пересунути лише вище.', 'A photo can only move up.')
  const displaced = photos[toPosition - 1]
  await postImage(client, shopId, listingId, {
    listingImageId: me.id,
    rank: displaced.rank,
    overwrite: true,
    altText: me.altText,
    watermarked
  })
  try {
    await postImage(client, shopId, listingId, {
      listingImageId: displaced.id,
      rank: displaced.rank + 1,
      altText: displaced.altText,
      watermarked
    })
  } catch (e) {
    throw new MediaError(
      `Фото пересунуто, але фото #${displaced.id}, що стояло на позиції ${toPosition}, не вдалося повернути в товар: ${why(e)}`,
      `The photo moved, but photo ${displaced.id} that was at position ${toPosition} could not be put back`,
      e
    )
  }
}

// ---------------------------------------------------------------- video

/** uploadListingVideo (OAuth listings_w, multipart `video` + `name`, or `video_id` to re-attach). */
export async function postVideo(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  p: { video: Upload } | { videoId: number }
): Promise<void> {
  const fd = new FormData()
  if ('video' in p) {
    fd.set('video', blob(p.video), p.video.name)
    fd.set('name', p.video.name)
  } else fd.set('video_id', String(p.videoId))
  await client.call(`${own(shopId, listingId)}/videos`, { method: 'POST', oauth: true, multipart: fd })
}

/** deleteListingVideo (OAuth listings_w). Etsy keeps a copy (re-attachable by video_id). */
export async function deleteVideo(client: EtsyClient, shopId: number, listingId: number, videoId: number): Promise<void> {
  await client.call(`${own(shopId, listingId)}/videos/${videoId}`, { method: 'DELETE', oauth: true })
}

const VIDEO_QUOTA = 'Etsy дозволяє не більше 10 завантажень відео на товар за добу — спробуйте завтра.'
const VIDEO_QUOTA_EN = 'At most 10 video uploads per product per day — try again tomorrow'
const isStatus = (e: unknown, status: number): boolean => e instanceof EtsyApiError && e.status === status
const isQuota = (e: unknown): boolean => isStatus(e, 429)

/**
 * Upload a listing's video (one per listing). The new video goes up first,
 * so a refusal — the daily limit (429) included — leaves the current video
 * as it is; after it, the previous video still on the listing is taken off.
 * Only when Etsy refuses a second video (409) is the current one taken off
 * first, and re-attached by its video_id if the upload then fails.
 */
export async function replaceVideo(client: EtsyClient, shopId: number, listingId: number, video: Upload): Promise<void> {
  const old = (await getVideos(client, listingId)).filter((v) => v.state !== 'deleted')
  try {
    await postVideo(client, shopId, listingId, { video })
  } catch (e) {
    if (old.length && isStatus(e, 409)) return swapVideo(client, shopId, listingId, video, old)
    if (isQuota(e)) {
      const kept = old.length ? ' Поточне відео лишилося.' : ''
      throw new MediaError(`${VIDEO_QUOTA}${kept}`, `${VIDEO_QUOTA_EN}${old.length ? '; the current video was kept' : ''}`, e)
    }
    if (!old.length) throw e
    throw new MediaError(`Нове відео не завантажено, поточне лишилося: ${why(e)}`, 'The new video was not uploaded; the current video was kept', e)
  }
  if (!old.length) return
  const ids = new Set(old.map((v) => v.id))
  const still = (await getVideos(client, listingId)).filter((v) => v.state !== 'deleted' && ids.has(v.id))
  try {
    for (const v of still) await deleteVideo(client, shopId, listingId, v.id)
  } catch (e) {
    const list = still.map((v) => v.id).join(', ')
    throw new MediaError(
      `Нове відео завантажено, але попереднє (#${list}) не вдалося зняти: ${why(e)}`,
      `The new video was uploaded, but the previous video (${list}) could not be removed`,
      e
    )
  }
}

/** Etsy refused a second video: take the current one off, upload, re-attach it if that fails. */
async function swapVideo(client: EtsyClient, shopId: number, listingId: number, video: Upload, old: MediaVideo[]): Promise<void> {
  for (const v of old) await deleteVideo(client, shopId, listingId, v.id)
  try {
    await postVideo(client, shopId, listingId, { video })
  } catch (e) {
    const reason = isQuota(e) ? VIDEO_QUOTA : why(e)
    const ids = old.map((v) => v.id).join(', ')
    const back = await succeeds(async () => {
      for (const v of old) await postVideo(client, shopId, listingId, { videoId: v.id })
    })
    throw new MediaError(
      back
        ? `Нове відео не завантажено, попереднє повернуто: ${reason}`
        : `Нове відео не завантажено, а попереднє (#${ids}) не вдалося повернути: ${reason}`,
      back
        ? `${isQuota(e) ? VIDEO_QUOTA_EN : 'The new video was not uploaded'}; the previous video was put back`
        : `The new video was not uploaded and the previous video (${ids}) could not be put back`,
      e
    )
  }
}

// ---------------------------------------------------------------- files

/** uploadListingFile (OAuth listings_w, multipart `file` + `name` + `rank`, or `listing_file_id` to re-attach). */
export async function postFile(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  p: { file: Upload; rank: number } | { listingFileId: number; rank: number }
): Promise<void> {
  const fd = new FormData()
  if ('file' in p) {
    fd.set('file', blob(p.file), p.file.name)
    fd.set('name', p.file.name)
  } else fd.set('listing_file_id', String(p.listingFileId))
  fd.set('rank', String(p.rank))
  await client.call(`${own(shopId, listingId)}/files`, { method: 'POST', oauth: true, multipart: fd })
}

/** deleteListingFile (OAuth listings_w). Deleting the last file makes the listing physical. */
export async function deleteFile(client: EtsyClient, shopId: number, listingId: number, fileId: number): Promise<void> {
  await client.call(`${own(shopId, listingId)}/files/${fileId}`, { method: 'DELETE', oauth: true })
}

/** Append buyer files after the existing ones (at most MAX_DIGITAL_FILES). */
export async function addFiles(
  client: EtsyClient,
  shopId: number,
  listingId: number,
  uploads: Array<() => Promise<Upload>>,
  onEach?: OnEach
): Promise<void> {
  const files = await getFiles(client, shopId, listingId)
  if (files.length + uploads.length > MAX_DIGITAL_FILES) {
    throw new MediaError(
      `У товару може бути до ${MAX_DIGITAL_FILES} файлів: зараз ${files.length}, можна додати ще ${Math.max(0, MAX_DIGITAL_FILES - files.length)}.`,
      `A product can have at most ${MAX_DIGITAL_FILES} files: it has ${files.length}.`
    )
  }
  const last = files.reduce((m, f) => Math.max(m, f.rank), files.length)
  for (const [i, read] of uploads.entries()) {
    const file = await read()
    onEach?.(file.name, i + 1, uploads.length)
    try {
      await postFile(client, shopId, listingId, { file, rank: last + i + 1 })
    } catch (e) {
      throw new MediaError(
        `Додано ${i} з ${uploads.length} файлів; «${file.name}» не завантажено: ${why(e)}`,
        `${i} of ${uploads.length} files added; "${file.name}" failed`,
        e
      )
    }
  }
}

/**
 * Replace a buyer file at its rank. Below the file limit the new file goes in
 * first (a listing must never drop to zero files — that makes it physical);
 * at the limit the old one goes first and is re-attached (listing_file_id)
 * if the upload fails.
 */
export async function replaceFile(client: EtsyClient, shopId: number, listingId: number, fileId: number, file: Upload): Promise<void> {
  const old = await getFile(client, shopId, listingId, fileId)
  const count = (await getFiles(client, shopId, listingId)).length
  if (count < MAX_DIGITAL_FILES) {
    await postFile(client, shopId, listingId, { file, rank: old.rank })
    try {
      await deleteFile(client, shopId, listingId, old.id)
    } catch (e) {
      throw new MediaError(
        `Новий файл додано, але старий «${old.name}» не вдалося видалити: ${why(e)}`,
        `The new file was added, but the old file ${old.id} could not be deleted`,
        e
      )
    }
    return
  }
  await deleteFile(client, shopId, listingId, old.id)
  try {
    await postFile(client, shopId, listingId, { file, rank: old.rank })
  } catch (e) {
    const back = await succeeds(() => postFile(client, shopId, listingId, { listingFileId: old.id, rank: old.rank }))
    throw new MediaError(
      back
        ? `Новий файл не завантажено, старий «${old.name}» повернуто: ${why(e)}`
        : `Новий файл не завантажено, а старий «${old.name}» не вдалося повернути: ${why(e)}`,
      back
        ? `The new file was not uploaded; the old file ${old.id} was put back`
        : `The new file was not uploaded and the old file ${old.id} could not be put back`,
      e
    )
  }
}
