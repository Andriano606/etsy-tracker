// In-memory stand-ins for MinIO (`ImageStore`) and Etsy's image CDN, for the
// image-sync and protocol tests. Never touches the network.

import { Readable } from 'stream'
import { vi } from 'vitest'
import { type ImageStore, ImageStoreError, type StoredObjectInfo } from '../../src/main/imageStore'

interface Obj {
  body: Buffer
  contentType: string | null
  etag: string
}

export class FakeImageStore implements ImageStore {
  objects = new Map<string, Obj>()
  bucketReady = false
  /** Simulate MinIO being down: every call throws like the real client does. */
  down = false
  /** Fail every put after this many successful ones (a mid-sync outage). */
  failPutsAfter: number | null = null
  puts = 0
  removed: string[] = []

  private check(): void {
    if (this.down) throw new ImageStoreError('MinIO недоступний (ECONNREFUSED). Запустіть: docker compose up -d')
  }

  async ensureBucket(): Promise<void> {
    this.check()
    this.bucketReady = true
  }
  async ping(): Promise<void> {
    this.check()
  }
  async put(key: string, body: Buffer, contentType: string | null): Promise<{ etag: string }> {
    this.check()
    if (this.failPutsAfter != null && this.puts >= this.failPutsAfter) {
      throw new ImageStoreError('MinIO недоступний (ECONNRESET). Запустіть: docker compose up -d')
    }
    this.puts++
    const etag = `etag-${body.length}-${this.puts}`
    this.objects.set(key, { body: Buffer.from(body), contentType, etag })
    return { etag }
  }
  async stat(key: string): Promise<StoredObjectInfo | null> {
    this.check()
    const o = this.objects.get(key)
    return o ? { size: o.body.length, contentType: o.contentType, etag: o.etag } : null
  }
  async get(key: string) {
    this.check()
    const o = this.objects.get(key)
    return o
      ? { size: o.body.length, contentType: o.contentType, etag: o.etag, body: Readable.from([o.body]) }
      : null
  }
  async remove(key: string): Promise<void> {
    this.check()
    this.removed.push(key)
    this.objects.delete(key)
  }
}

export interface FakeCdnOptions {
  /** HTTP status per URL substring (e.g. {'il_fullxfull.12': 404}). */
  status?: Record<string, number>
  /** Throw a network error for URLs containing any of these. */
  failing?: string[]
  contentType?: string
}

/** Bytes the fake CDN serves for a URL — tests compare stored objects with it. */
export const cdnBytes = (url: string): Buffer => Buffer.from(`JPEG:${url}`)

/** A fetch for i.etsystatic.com: answers every URL with `cdnBytes(url)`. */
export function fakeCdn(opts: FakeCdnOptions = {}) {
  const calls: string[] = []
  const fn = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    if (opts.failing?.some((f) => url.includes(f))) throw new TypeError('fetch failed')
    for (const [part, status] of Object.entries(opts.status ?? {})) {
      if (url.includes(part)) return new Response('nope', { status })
    }
    return new Response(cdnBytes(url), {
      status: 200,
      headers: { 'content-type': opts.contentType ?? 'image/jpeg' }
    })
  })
  return Object.assign(fn as unknown as typeof fetch, { calls, opts })
}
