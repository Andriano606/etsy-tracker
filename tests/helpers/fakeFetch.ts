import { vi } from 'vitest'

/** What a fake endpoint answers. `throws` simulates a network failure. */
export interface FakeReply {
  status?: number
  body?: unknown
  headers?: Record<string, string>
  throws?: Error
}

export type Handler = (url: URL, init?: RequestInit) => FakeReply | Promise<FakeReply>

export interface FakeCall {
  url: URL
  headers: Record<string, string>
}

/** A `fetch` stand-in that routes every request through `handler` and records it. */
export function fakeFetch(handler: Handler) {
  const calls: FakeCall[] = []
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input))
    calls.push({ url, headers: { ...((init?.headers as Record<string, string>) ?? {}) } })
    const r = await handler(url, init)
    if (r.throws) throw r.throws
    const body = r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)
    return new Response(body, {
      status: r.status ?? 200,
      headers: { 'content-type': 'application/json', ...(r.headers ?? {}) }
    })
  })
  return Object.assign(fn as unknown as typeof fetch, { calls })
}

/** A fake fetch answering with `replies` in order (the last one repeats). */
export function queuedFetch(replies: FakeReply[]) {
  let i = 0
  return fakeFetch(() => replies[Math.min(i++, replies.length - 1)])
}
