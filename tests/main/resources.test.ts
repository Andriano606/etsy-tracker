import { describe, expect, it, vi } from 'vitest'
import { DISK_CACHE_BYTES, noStoreFetch } from '../../src/main/resources'

describe('resource limits', () => {
  it('caps the HTTP disk cache at a few hundred MB', () => {
    expect(DISK_CACHE_BYTES).toBe(200 * 1024 * 1024)
  })

  it('downloads skip the HTTP cache and keep every other option', async () => {
    const inner = vi.fn(async () => new Response('x'))
    const f = noStoreFetch(inner as unknown as typeof fetch)
    const signal = new AbortController().signal
    await f('https://i.etsystatic.com/a.jpg', { signal, headers: { a: '1' } })
    expect(inner).toHaveBeenCalledWith('https://i.etsystatic.com/a.jpg', {
      signal,
      headers: { a: '1' },
      cache: 'no-store'
    })
    await f('https://i.etsystatic.com/b.jpg')
    expect(inner).toHaveBeenLastCalledWith('https://i.etsystatic.com/b.jpg', { cache: 'no-store' })
  })
})
