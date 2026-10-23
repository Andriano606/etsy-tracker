// `etsyimg://img/{listing_image_id}/{size}` — how the renderer shows listing
// images (and `etsyimg://review/{review row id}/fullxfull` review photos). Main resolves the id in listing_images and streams the MinIO copy;
// when there is none (not synced yet, MinIO off or down) it fetches the Etsy
// CDN URL itself and passes it through. The renderer never sees MinIO
// credentials or object keys, and CSP only has to allow `etsyimg:`.

import { Readable } from 'stream'
import type { ImageSize } from '../shared/types'
import { type Db, type ImageRow, type ReviewImageRow, getImageRow, getReviewImageRow } from './db'
import type { ImageStore } from './imageStore'
import { getDraftMediaData } from './drafts'
import { isEtsyCdnUrl } from '../shared/externalUrl'

export const IMAGE_SCHEME = 'etsyimg'

const SIZES: readonly ImageSize[] = ['75x75', '170x135', '570xN', 'fullxfull']

/** `etsyimg://img/123/570xN` → {imageId: 123, size: '570xN'}; null for anything else. */
export function parseImageUrl(url: string): { imageId: number; size: ImageSize } | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${IMAGE_SCHEME}:` || u.hostname !== 'img') return null
  const m = u.pathname.match(/^\/(\d{1,20})\/([A-Za-z0-9]+)$/)
  if (!m) return null
  const size = m[2] as ImageSize
  if (!SIZES.includes(size)) return null
  const imageId = Number(m[1])
  return Number.isSafeInteger(imageId) && imageId > 0 ? { imageId, size } : null
}

/** `etsyimg://review/42/fullxfull` → 42 (review photos exist only in fullxfull); null otherwise. */
export function parseReviewImageUrl(url: string): number | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${IMAGE_SCHEME}:` || u.hostname !== 'review') return null
  const m = u.pathname.match(/^\/(\d{1,20})\/fullxfull$/)
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** `etsyimg://draft/7` → 7 (a photo of a listing draft kept in the app); null otherwise. */
export function parseDraftImageUrl(url: string): number | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== `${IMAGE_SCHEME}:` || u.hostname !== 'draft') return null
  const m = u.pathname.match(/^\/(\d{1,20})$/)
  if (!m) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/** Where to read a review photo from (pure): the MinIO copy, else its Etsy CDN URL. */
export function resolveReviewImageSource(row: ReviewImageRow | null, storeAvailable: boolean): ImageSource {
  if (!row) return { kind: 'none' }
  const url = row.image_url_fullxfull && isEtsyCdnUrl(row.image_url_fullxfull) ? row.image_url_fullxfull : null
  if (storeAvailable && row.image_sync_status === 'stored' && row.image_key) {
    return { kind: 'store', key: row.image_key, fallbackUrl: url }
  }
  return url ? { kind: 'cdn', url } : { kind: 'none' }
}

export type ImageSource =
  | { kind: 'store'; key: string; fallbackUrl: string | null }
  | { kind: 'cdn'; url: string }
  | { kind: 'none' }

/** The CDN URL for a size (else 570xN, else the original) — only https etsystatic.com URLs. */
function cdnUrl(row: ImageRow, size: ImageSize): string | null {
  const u =
    size === '75x75'
      ? row.url_75x75
      : size === '170x135'
        ? row.url_170x135
        : size === '570xN'
          ? row.url_570xN
          : row.url_fullxfull
  return [u, row.url_570xN, row.url_fullxfull].find((x) => isEtsyCdnUrl(x)) ?? null
}

/**
 * Where to read an image from (pure). The store has `fullxfull` and `570xN`:
 * small sizes are served from the 570xN copy (else the original), 570xN from
 * its copy (else the original). Without a stored object — or with the store
 * unavailable — the Etsy CDN URL of the requested size.
 */
export function resolveImageSource(
  row: ImageRow | null,
  size: ImageSize,
  storeAvailable: boolean
): ImageSource {
  if (!row) return { kind: 'none' }
  const fallback = cdnUrl(row, size)
  if (storeAvailable && row.sync_status === 'stored') {
    const key = size === 'fullxfull' ? row.key_full : (row.key_570 ?? row.key_full)
    if (key) return { kind: 'store', key, fallbackUrl: fallback }
  }
  return fallback ? { kind: 'cdn', url: fallback } : { kind: 'none' }
}

export interface ImageProtocolDeps {
  db: Db
  /** null = MinIO disabled. Errors count as "store unavailable". */
  getStore: () => Promise<ImageStore | null>
  /** For the CDN fallback (Electron's net.fetch in the app). */
  fetch: typeof fetch
  /**
   * A 'stored' row's object is not in MinIO (bucket switched, volume wiped…):
   * the app marks it pending and queues a sync. The image is still served from the CDN.
   */
  onMissing?: (row: ImageRow) => void
  /** The same for a stored review photo. */
  onReviewMissing?: (row: ReviewImageRow) => void
}

const CACHE = 'private, max-age=86400'

/** The `protocol.handle(IMAGE_SCHEME, …)` handler. */
export function createImageProtocolHandler(deps: ImageProtocolDeps): (req: Request) => Promise<Response> {
  async function fromCdn(url: string): Promise<Response> {
    if (!isEtsyCdnUrl(url)) return new Response(null, { status: 404 })
    try {
      const res = await deps.fetch(url)
      if (!res.ok) return new Response(null, { status: res.status === 404 ? 404 : 502 })
      const contentType = res.headers.get('content-type') ?? ''
      if (!/^image\//i.test(contentType)) {
        await res.body?.cancel().catch(() => undefined)
        return new Response(null, { status: 502 })
      }
      return new Response(res.body, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': CACHE
        }
      })
    } catch {
      return new Response(null, { status: 502 })
    }
  }

  async function storeIfStored(stored: boolean): Promise<ImageStore | null> {
    if (!stored) return null
    try {
      return await deps.getStore()
    } catch {
      return null
    }
  }

  return async (req) => {
    // A draft's photo lives in the db (no CDN, no MinIO).
    const draftMedia = parseDraftImageUrl(req.url)
    if (draftMedia != null) {
      const row = getDraftMediaData(deps.db, draftMedia)
      if (!row || row.kind !== 'photo') return new Response(null, { status: 404 })
      return new Response(new Uint8Array(row.data), {
        status: 200,
        headers: { 'content-type': row.mime, 'cache-control': 'no-store' }
      })
    }
    let src: ImageSource
    let onMissing: (() => void) | undefined
    let store: ImageStore | null
    const reviewId = parseReviewImageUrl(req.url)
    if (reviewId != null) {
      const row = getReviewImageRow(deps.db, reviewId)
      store = await storeIfStored(row?.image_sync_status === 'stored')
      src = resolveReviewImageSource(row, store != null)
      onMissing = row ? () => deps.onReviewMissing?.(row) : undefined
    } else {
      const parsed = parseImageUrl(req.url)
      if (!parsed) return new Response(null, { status: 400 })
      const row = getImageRow(deps.db, parsed.imageId)
      store = await storeIfStored(row?.sync_status === 'stored')
      src = resolveImageSource(row, parsed.size, store != null)
      onMissing = row ? () => deps.onMissing?.(row) : undefined
    }
    if (src.kind === 'none') return new Response(null, { status: 404 })
    if (src.kind === 'cdn') return fromCdn(src.url)

    try {
      const obj = await store!.get(src.key)
      if (obj) {
        return new Response(Readable.toWeb(obj.body) as ReadableStream, {
          status: 200,
          headers: {
            'content-type': obj.contentType ?? 'image/jpeg',
            'content-length': String(obj.size),
            'cache-control': CACHE
          }
        })
      }
      // The store answered but has no such object: re-queue the copy.
      onMissing?.()
    } catch {
      // MinIO went away between sync and display — fall through to the CDN.
    }
    return src.fallbackUrl ? fromCdn(src.fallbackUrl) : new Response(null, { status: 404 })
  }
}
