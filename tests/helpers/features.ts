// Test helpers for main/features: a real Etsy client over a routed fake fetch,
// a signed-in FeatureCtx / FeatureMcpDeps, and calling a feature's MCP tool.

import { vi } from 'vitest'
import { createEtsyClient, type EtsyClient } from '../../src/main/etsyApi'
import { createFileRegistry } from '../../src/main/myShop'
import { type McpToolResult, handleMcpMessage } from '../../src/main/mcpProtocol'
import type { Feature, FeatureCtx, FeatureMcpDeps } from '../../src/main/features/types'
import type { EtsyAuthStatus } from '../../src/shared/types'
import { memDb } from './db'
import { fakeFetch, type FakeCall, type FakeReply } from './fakeFetch'

export const OWN_SHOP = 68736507
export const OWN_USER = 555

/** Every scope the app asks for. */
export const ALL_SCOPES = [
  'listings_r', 'listings_w', 'listings_d', 'shops_r', 'shops_w', 'transactions_r', 'transactions_w', 'email_r', 'address_r'
]

export const signedIn = (over: Partial<EtsyAuthStatus> = {}): EtsyAuthStatus => ({
  loggedIn: true,
  redirectUri: 'https://localhost:3003/callback',
  pending: false,
  encrypted: true,
  userId: OWN_USER,
  shopId: OWN_SHOP,
  shopName: 'TidyFoxSheets',
  scopes: ALL_SCOPES,
  ...over
})

export const signedOut: EtsyAuthStatus = { loggedIn: false, redirectUri: '', pending: false, encrypted: false }

type Handler = FakeReply | ((url: URL, init?: RequestInit) => FakeReply)

/**
 * A fake Etsy: routes like "GET /v3/application/shops/{id}/sections" ({…} matches
 * one path segment). Unrouted requests answer 404 {error: "no route"}. `calls`
 * records every request (method, url, headers, body, rawBody).
 */
export function routedFetch(routes: Record<string, Handler>) {
  const compiled = Object.entries(routes).map(([key, h]) => {
    const [method, path] = key.split(' ')
    const re = new RegExp('^' + path.replace(/\{[^}]+\}/g, '[^/]+') + '$')
    return { method, re, h }
  })
  const f = fakeFetch((url, init) => {
    const method = init?.method ?? 'GET'
    const hit = compiled.find((c) => c.method === method && c.re.test(url.pathname))
    if (!hit) return { status: 404, body: { error: `no route ${method} ${url.pathname}` } }
    return typeof hit.h === 'function' ? hit.h(url, init) : hit.h
  })
  return f as typeof f & { calls: FakeCall[] }
}

export function testClient(fetch: typeof globalThis.fetch, token: string | null = 'tok'): EtsyClient {
  return createEtsyClient({
    getApiKey: () => 'keystring:secret',
    fetch,
    sleep: async () => {},
    random: () => 0,
    minIntervalMs: 0,
    maxRetries: 1,
    getAccessToken: async () => token,
    refreshAccessToken: async () => null
  })
}

/** A FeatureCtx over a routed fake Etsy; signed in with every scope unless `status` says otherwise. */
export function featureCtx(routes: Record<string, Handler>, over: Partial<FeatureCtx> & { status?: EtsyAuthStatus } = {}) {
  const fetch = routedFetch(routes)
  const events: Array<{ type: string; payload: unknown }> = []
  const files = createFileRegistry()
  const ctx: FeatureCtx = {
    db: memDb(),
    client: testClient(fetch),
    authStatus: () => over.status ?? signedIn(),
    files,
    readFile: vi.fn(async (p: string) => new Uint8Array(Buffer.from(`BYTES:${p}`)) as Uint8Array<ArrayBuffer>),
    emit: (type, payload) => events.push({ type, payload }),
    taxonomy: async () => [
      { id: 1, path: 'Paper & Party Supplies' },
      { id: 2, path: 'Paper & Party Supplies › Paper › Calendars & Planners' }
    ],
    accessToken: async () => 'tok',
    now: () => 1_760_000_000_000,
    ...over
  }
  return { ctx, fetch, events, files }
}

/** FeatureMcpDeps over a routed fake Etsy (signed in, changes allowed unless said). */
export function mcpDeps(
  routes: Record<string, Handler>,
  over: Partial<FeatureMcpDeps> & { status?: EtsyAuthStatus; writes?: boolean } = {}
) {
  const fetch = routedFetch(routes)
  const deps: FeatureMcpDeps = {
    db: memDb(),
    client: testClient(fetch),
    authStatus: () => over.status ?? signedIn(),
    writesAllowed: () => over.writes ?? true,
    taxonomy: async () => [{ id: 2, path: 'Paper & Party Supplies › Paper › Calendars & Planners' }],
    accessToken: async () => 'tok',
    now: () => 1_760_000_000_000,
    ...over
  }
  return { deps, fetch }
}

/** Run an action of a feature like `feature:call` does (throws → {ok: false}). */
export async function runAction(feature: Feature, action: string, args: Record<string, unknown>, ctx: FeatureCtx) {
  return feature.actions[action](args, ctx)
}

/** Call a feature's MCP tool through the protocol; `text` is the first text block, `json` it parsed (if JSON). */
export async function callTool(feature: Feature, deps: FeatureMcpDeps, name: string, args: Record<string, unknown> = {}) {
  const tools = feature.mcpTools?.(deps) ?? []
  const res = await handleMcpMessage(
    { info: { name: 'etsy-tracker', title: 'Etsy Tracker', version: '0.1.0', instructions: '' }, tools },
    { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }
  )
  if (!res || res.error) throw new Error(`rpc error: ${JSON.stringify(res)}`)
  const r = res.result as McpToolResult
  const text = r.content.find((c) => c.type === 'text') as { text: string } | undefined
  let json: any = null
  try {
    json = text ? JSON.parse(text.text) : null
  } catch {
    json = null
  }
  return { result: r, isError: !!r.isError, text: text?.text ?? '', json }
}
