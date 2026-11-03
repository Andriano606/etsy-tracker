// Limits on what the app keeps on disk besides its own data.

/**
 * Chromium's HTTP disk cache (`<userData>/Cache`). Without a cap Chromium sizes
 * it from the free disk space (it had grown to 1.3 GB); the only things worth
 * caching are the shop icons and CDN photos shown before they reach MinIO.
 */
export const DISK_CACHE_BYTES = 200 * 1024 * 1024

/**
 * A fetch that never reads or writes the HTTP cache — for downloads whose bytes
 * are kept elsewhere anyway (photos copied to MinIO, a draft's photos/video
 * stored in the db). Through the cache every copied photo was stored twice.
 */
export function noStoreFetch(f: typeof fetch): typeof fetch {
  return (input, init) => f(input, { ...init, cache: 'no-store' })
}
