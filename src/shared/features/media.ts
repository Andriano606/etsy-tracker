// Feature "media": the photos, video and buyer files of one of the user's OWN
// listings (Мій магазин → Лістинги → Редагувати → "Фото, відео й файли").
// OAS: getListingImages/getListingImage/uploadListingImage/deleteListingImage,
// getListingVideos/getListingVideo/uploadListingVideo/deleteListingVideo,
// getAllListingFiles/getListingFile/uploadListingFile/deleteListingFile.

import { IMAGE_EXTENSIONS, MAX_DIGITAL_FILE_BYTES, MAX_IMAGE_BYTES, VIDEO_EXTENSIONS } from '../myShop'

/** OAS ListingImage.alt_text: "Max length 500 characters". */
export const MAX_ALT_TEXT = 500
/** Etsy shows one video per listing. */
export const MAX_VIDEOS = 1
/** Etsy's help center: listing videos up to 100 MB (5–15 s); the OAS documents no size. */
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024
/** OAS uploadListingVideo: "rate limiting to perform 10 uploads per listing per day". */
export const VIDEO_UPLOADS_PER_DAY = 10

export interface MediaPhoto {
  /** listing_image_id */
  id: number
  /** 1 = the main photo (position in rank order, not Etsy's raw rank). */
  position: number
  /** Etsy's own rank (may have gaps) — what a replace/re-attach at this photo's place sends. */
  rank: number
  /** Etsy CDN URLs (validated; null when missing or not a CDN URL). */
  url75: string | null
  url170: string | null
  url570: string | null
  urlFull: string | null
  width: number | null
  height: number | null
  altText: string
  /** The average colour, e.g. "E8E2DA"; null while Etsy still processes a new upload. */
  hexCode: string | null
  isBlackAndWhite: boolean | null
}

export type VideoState = 'active' | 'inactive' | 'deleted' | 'flagged'

export interface MediaVideo {
  id: number
  width: number | null
  height: number | null
  /** The thumbnail on the Etsy CDN (validated), or null. */
  thumbnailUrl: string | null
  /** OAS enum active|inactive|deleted|flagged; null when Etsy didn't say. */
  state: string | null
}

export interface MediaFile {
  /** listing_file_id */
  id: number
  /** Etsy's rank (1 = first; its place in the list when Etsy gives none). */
  rank: number
  name: string
  sizeBytes: number | null
  /** Etsy's human-readable size ("1.2 MB"). */
  sizeLabel: string | null
  /** MIME type. */
  type: string | null
}

/** Everything of one listing; a part Etsy refused is null with a note. */
export interface ListingMedia {
  listingId: number
  photos: MediaPhoto[] | null
  videos: MediaVideo[] | null
  files: MediaFile[] | null
  /** Parts that couldn't be read, in Ukrainian. */
  notes: string[]
}

export type MediaKind = 'photo' | 'video' | 'file'

/** `feature:event` type "progress" of feature "media". */
export interface MediaProgress {
  listingId: number
  kind: MediaKind
  name: string
  /** 1-based index of this file among the ones being sent. */
  index: number
  total: number
}

const LIMITS: Record<MediaKind, { exts: readonly string[] | null; max: number }> = {
  photo: { exts: IMAGE_EXTENSIONS, max: MAX_IMAGE_BYTES },
  video: { exts: VIDEO_EXTENSIONS, max: MAX_VIDEO_BYTES },
  file: { exts: null, max: MAX_DIGITAL_FILE_BYTES }
}

const extOf = (name: string): string => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()

/** Why a file can't be sent as `kind`: a wrong type, too big, or null = fine. */
export function mediaProblem(kind: MediaKind, name: string, size: number): 'type' | 'size' | null {
  const l = LIMITS[kind]
  if (l.exts && !l.exts.includes(extOf(name))) return 'type'
  if (size > l.max) return 'size'
  return null
}

const MB = (bytes: number): number => bytes / 1024 / 1024

/** The Ukrainian text of a mediaProblem. */
export function mediaProblemText(kind: MediaKind, name: string, size: number): string | null {
  const p = mediaProblem(kind, name, size)
  if (!p) return null
  const l = LIMITS[kind]
  if (p === 'type') return `«${name}»: ${kind === 'photo' ? 'фото' : 'відео'} має бути ${l.exts!.map((e) => e.toUpperCase()).join(', ')}.`
  return `«${name}» більший за ${MB(l.max)} МБ.`
}

/** The English text of a mediaProblem (MCP). */
export function mediaProblemEnglish(kind: MediaKind, name: string, size: number): string | null {
  const p = mediaProblem(kind, name, size)
  if (!p) return null
  const l = LIMITS[kind]
  if (p === 'type') return `"${name}": a ${kind} must be ${l.exts!.map((e) => e.toUpperCase()).join(', ')}.`
  return `"${name}" is larger than ${MB(l.max)} MB.`
}

export const VIDEO_STATE_LABEL: Record<VideoState, string> = {
  active: 'активне',
  inactive: 'неактивне (ще обробляється або вимкнене)',
  deleted: 'видалене',
  flagged: 'заблоковане модерацією'
}

/** A file size for people: "834 Б", "12,5 КБ", "3,4 МБ". */
export function formatBytes(n: number | null): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} Б`
  const fmt = (v: number): string => v.toLocaleString('uk-UA', { maximumFractionDigits: 1 })
  if (n < 1024 * 1024) return `${fmt(n / 1024)} КБ`
  return `${fmt(MB(n))} МБ`
}

/** The MCP tools of this feature, in Ukrainian for the MCP modal (same order as the tools). */
export const MEDIA_TOOL_SUMMARY: ReadonlyArray<{ name: string; text: string; write?: boolean }> = [
  { name: 'list_my_product_media', text: 'фото, відео й файли мого лістингу (позиції, розміри, alt-текст, кольори)' },
  { name: 'delete_my_product_photo', text: 'видалити фото мого лістингу', write: true },
  { name: 'replace_my_product_photo', text: 'замінити фото на позиції в моєму лістингу', write: true },
  { name: 'set_my_photo_alt_text', text: 'змінити alt-текст фото мого лістингу', write: true },
  { name: 'upload_my_product_video', text: 'завантажити або замінити відео мого лістингу', write: true },
  { name: 'delete_my_product_video', text: 'видалити відео мого лістингу', write: true },
  { name: 'delete_my_product_file', text: 'видалити файл для покупця з мого лістингу', write: true },
  { name: 'replace_my_product_file', text: 'замінити файл для покупця в моєму лістингу', write: true }
]
