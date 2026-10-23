// Object storage for listing images. `ImageStore` is the seam: the app uses the
// MinIO implementation below (official `minio` npm client — pure JS, CJS entry,
// externalized by electron-vite and shipped in node_modules by
// electron-builder), tests use an in-memory fake (tests/helpers/fakeImageStore.ts).

import { Client } from 'minio'
import { Readable } from 'stream'
import type { ImageSize } from '../shared/types'

export interface StoredObjectInfo {
  size: number
  contentType: string | null
  etag: string | null
}

export interface StoredObject extends StoredObjectInfo {
  body: Readable
}

export interface ImageStore {
  /** Create the bucket if it does not exist (idempotent). */
  ensureBucket(): Promise<void>
  /** Throws (with a Ukrainian message) when the server is unreachable or the credentials are wrong. */
  ping(): Promise<void>
  put(key: string, body: Buffer, contentType: string | null): Promise<{ etag: string | null }>
  /** null when the object does not exist. */
  stat(key: string): Promise<StoredObjectInfo | null>
  /** null when the object does not exist. */
  get(key: string): Promise<StoredObject | null>
  /** Removing a missing object is not an error. */
  remove(key: string): Promise<void>
}

/** Sizes copied into the store: the original and the grid thumbnail. */
export const STORED_SIZES = ['fullxfull', '570xN'] as const satisfies readonly ImageSize[]

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif'
}

/** File extension from the response content-type, else from the URL, else `jpg`. */
export function imageExt(contentType: string | null | undefined, url?: string): string {
  const ct = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (EXT_BY_TYPE[ct]) return EXT_BY_TYPE[ct]
  let e = url?.match(/\.([a-z0-9]{3,4})(?:$|[?#])/i)?.[1].toLowerCase()
  if (e === 'jpeg') e = 'jpg'
  return e && Object.values(EXT_BY_TYPE).includes(e) ? e : 'jpg'
}

/** `shops/{shop_id}/listings/{listing_id}/{listing_image_id}/{size}.{ext}` */
export function imageObjectKey(
  shopId: number,
  listingId: number,
  imageId: number,
  size: ImageSize,
  ext: string
): string {
  return `shops/${shopId}/listings/${listingId}/${imageId}/${size}.${ext}`
}

export class ImageStoreError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message)
    this.name = 'ImageStoreError'
  }
}

export interface MinioStoreOptions {
  endpoint: string
  accessKey: string
  secretKey: string
  bucket: string
  /** Per-operation timeout. Default 15 s. */
  timeoutMs?: number
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ImageStoreError(`MinIO не відповідає (${what}, ${Math.round(ms / 1000)} с).`)), ms)
  })
  return Promise.race([p, t]).finally(() => clearTimeout(timer))
}

function isNotFound(e: unknown): boolean {
  const code = (e as { code?: string })?.code
  return code === 'NoSuchKey' || code === 'NotFound' || code === 'NoSuchBucket'
}

/** A human (Ukrainian) message for a MinIO client error. */
export function describeStoreError(e: unknown): string {
  if (e instanceof ImageStoreError) return e.message
  const err = e as { code?: string; message?: string }
  switch (err?.code) {
    case 'ECONNREFUSED':
    case 'ENOTFOUND':
    case 'EHOSTUNREACH':
    case 'ECONNRESET':
      return `MinIO недоступний (${err.code}). Запустіть: docker compose up -d`
    case 'InvalidAccessKeyId':
    case 'SignatureDoesNotMatch':
    case 'AccessDenied':
      return `MinIO відхилив облікові дані (${err.code}). Перевірте Access key і Secret key.`
    default:
      return `Помилка MinIO: ${err?.code ? `${err.code}: ` : ''}${err?.message ?? String(e)}`
  }
}

/** Parse `http(s)://host[:port]` into the minio client's options. */
export function minioClientOptions(endpoint: string): { endPoint: string; port: number; useSSL: boolean } {
  const u = new URL(endpoint)
  const useSSL = u.protocol === 'https:'
  return {
    endPoint: u.hostname.replace(/^\[|\]$/g, ''),
    port: u.port ? Number(u.port) : useSSL ? 443 : 80,
    useSSL
  }
}

/** The real store: one MinIO bucket via the official `minio` client. */
export async function createMinioImageStore(opts: MinioStoreOptions): Promise<ImageStore> {
  // A static import on purpose: the CJS main bundle then does require('minio'),
  // which resolves the package's `require` export (dist/main), not its ESM build.
  const client = new Client({
    ...minioClientOptions(opts.endpoint),
    accessKey: opts.accessKey,
    secretKey: opts.secretKey,
    region: 'us-east-1'
  })
  const bucket = opts.bucket
  const ms = opts.timeoutMs ?? 15_000

  async function guard<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await withTimeout(fn(), ms, what)
    } catch (e) {
      if (e instanceof ImageStoreError) throw e
      throw new ImageStoreError(describeStoreError(e), e)
    }
  }

  async function stat(key: string): Promise<StoredObjectInfo | null> {
    try {
      const s = await withTimeout(client.statObject(bucket, key), ms, 'stat')
      const meta = (s.metaData ?? {}) as Record<string, string>
      return {
        size: s.size,
        contentType: meta['content-type'] ?? meta['Content-Type'] ?? null,
        etag: s.etag ?? null
      }
    } catch (e) {
      if (isNotFound(e)) return null
      if (e instanceof ImageStoreError) throw e
      throw new ImageStoreError(describeStoreError(e), e)
    }
  }

  return {
    ensureBucket: () =>
      guard('bucket', async () => {
        if (!(await client.bucketExists(bucket))) {
          try {
            await client.makeBucket(bucket, 'us-east-1')
          } catch (e) {
            // Created concurrently by someone else — fine.
            const code = (e as { code?: string })?.code
            if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') throw e
          }
        }
      }),
    ping: () =>
      guard('ping', async () => {
        // Signed request: fails on wrong credentials as well as on a dead server.
        await client.listBuckets()
      }),
    put: (key, body, contentType) =>
      guard('upload', async () => {
        const r = await client.putObject(bucket, key, body, body.length, {
          'Content-Type': contentType ?? 'application/octet-stream'
        })
        return { etag: r?.etag ?? null }
      }),
    stat,
    async get(key) {
      const info = await stat(key)
      if (!info) return null
      try {
        const body = await withTimeout(client.getObject(bucket, key), ms, 'download')
        return { ...info, body: body as Readable }
      } catch (e) {
        if (isNotFound(e)) return null
        if (e instanceof ImageStoreError) throw e
        throw new ImageStoreError(describeStoreError(e), e)
      }
    },
    remove: (key) =>
      guard('remove', async () => {
        try {
          await client.removeObject(bucket, key)
        } catch (e) {
          if (!isNotFound(e)) throw e
        }
      })
  }
}
