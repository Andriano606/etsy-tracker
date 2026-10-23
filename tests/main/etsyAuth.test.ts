import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_REDIRECT_URI,
  ETSY_TOKEN_URL,
  EtsyAuthError,
  PENDING_TTL_MS,
  REFRESH_TOKEN_LIFE_MS,
  buildAuthorizeUrl,
  createEtsyAuth,
  normalizeRedirectUri,
  parseCallback,
  pkcePair
} from '../../src/main/etsyAuth'
import { createEtsyAuthStore, createKeyStore } from '../../src/main/settings'
import { fakeFetch, type FakeReply } from '../helpers/fakeFetch'
import { fakeSafeStorage } from '../helpers/safeStorage'

let dir: string
let file: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'etsy-auth-'))
  file = join(dir, 'settings.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('PKCE and URLs', () => {
  it('the challenge is base64url(sha256(verifier)); the verifier fits Etsy’s 43–128 [A-Za-z0-9._~-]', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
    expect(pkcePair().verifier).not.toBe(verifier)
  })

  it('the RFC 7636 example', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    const fixed = (): Buffer => Buffer.from(verifier, 'base64url')
    expect(pkcePair(fixed)).toEqual({ verifier, challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' })
  })

  it('the authorize URL carries every parameter Etsy requires', () => {
    const u = new URL(buildAuthorizeUrl({ clientId: 'ks', redirectUri: DEFAULT_REDIRECT_URI, state: 'st', challenge: 'ch' }))
    expect(u.origin + u.pathname).toBe('https://www.etsy.com/oauth/connect')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'ks',
      redirect_uri: 'https://localhost:3003/callback',
      scope: 'listings_r listings_w listings_d shops_r shops_w transactions_r transactions_w email_r address_r',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256'
    })
  })

  it('redirect URIs must be https, without credentials or a fragment', () => {
    expect(normalizeRedirectUri(' https://localhost:3003/callback ')).toBe('https://localhost:3003/callback')
    for (const bad of ['http://localhost:3003/callback', 'localhost:3003', '', 'https://u:p@localhost/cb', 'https://x.dev/cb#a']) {
      expect(() => normalizeRedirectUri(bad)).toThrow(EtsyAuthError)
    }
  })
})

describe('parseCallback (what the user pastes)', () => {
  it('the whole redirect URL, or only its query', () => {
    expect(parseCallback('https://localhost:3003/callback?code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' })
    expect(parseCallback('  ?code=abc&state=xyz ')).toEqual({ code: 'abc', state: 'xyz' })
    expect(parseCallback('code=abc&state=xyz')).toEqual({ code: 'abc', state: 'xyz' })
  })

  it('a refusal, a missing code, nothing at all', () => {
    expect(() => parseCallback('https://localhost:3003/callback?error=access_denied&state=x')).toThrow('Відмовити')
    expect(() => parseCallback('https://localhost:3003/callback?error=invalid_scope&error_description=bad')).toThrow('bad')
    expect(() => parseCallback('https://localhost:3003/callback?state=x')).toThrow('немає коду входу')
    expect(() => parseCallback('   ')).toThrow('Вставте адресу')
  })
})

/** A fake Etsy token endpoint; records the form bodies. */
function tokenServer(replies: Array<FakeReply | ((form: URLSearchParams) => FakeReply)>) {
  const forms: URLSearchParams[] = []
  let i = 0
  const fetch = fakeFetch((url, init) => {
    expect(url.toString()).toBe(ETSY_TOKEN_URL)
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/x-www-form-urlencoded')
    const form = new URLSearchParams(String(init?.body))
    forms.push(form)
    const r = replies[Math.min(i++, replies.length - 1)]
    return typeof r === 'function' ? r(form) : r
  })
  return { fetch, forms }
}

const tokens = (n: number, over: Record<string, unknown> = {}): FakeReply => ({
  body: {
    access_token: `555.access${n}`,
    refresh_token: `555.refresh${n}`,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'listings_r listings_w shops_r shops_w',
    ...over
  }
})

function setup(replies: Parameters<typeof tokenServer>[0] = [tokens(1)], opts: { key?: boolean } = {}) {
  const keys = createKeyStore(file, fakeSafeStorage())
  if (opts.key !== false) keys.setKey('ks123', 'secret')
  const store = createEtsyAuthStore(file, fakeSafeStorage())
  const server = tokenServer(replies)
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms: number) => (t += ms) }
  const changes = vi.fn()
  const whoAmI = vi.fn(async (_token: string) => ({ userId: 555, shopId: 68736507, shopName: 'TidyFoxSheets' }))
  const auth = createEtsyAuth({
    store,
    getClientId: () => keys.getKey()?.split(':')[0] ?? null,
    whoAmI,
    fetch: server.fetch,
    now: clock.now,
    onChange: changes
  })
  return { auth, store, server, clock, changes, whoAmI }
}

/** Begin, then paste back a redirect with the state Etsy would echo. */
async function signIn(s: ReturnType<typeof setup>) {
  const url = new URL(s.auth.begin())
  return s.auth.complete(`https://localhost:3003/callback?code=CODE1&state=${url.searchParams.get('state')}`)
}

describe('signing in', () => {
  it('begin → paste → token exchange with the PKCE verifier → who am I → signed in', async () => {
    const s = setup()
    const url = new URL(s.auth.begin())
    expect(s.auth.status()).toMatchObject({ loggedIn: false, pending: true, redirectUri: DEFAULT_REDIRECT_URI })
    const st = await s.auth.complete(`https://localhost:3003/callback?code=CODE1&state=${url.searchParams.get('state')}`)
    const form = Object.fromEntries(s.server.forms[0])
    expect(form).toEqual({
      grant_type: 'authorization_code',
      client_id: 'ks123',
      redirect_uri: DEFAULT_REDIRECT_URI,
      code: 'CODE1',
      code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)
    })
    expect(createHash('sha256').update(form.code_verifier).digest('base64url')).toBe(url.searchParams.get('code_challenge'))
    expect(s.whoAmI).toHaveBeenCalledWith('555.access1')
    expect(st).toMatchObject({
      loggedIn: true,
      pending: false,
      encrypted: true,
      userId: 555,
      shopId: 68736507,
      shopName: 'TidyFoxSheets',
      scopes: ['listings_r', 'listings_w', 'shops_r', 'shops_w'],
      signedInAt: 1_000_000,
      reloginBy: 1_000_000 + REFRESH_TOKEN_LIFE_MS
    })
    expect(s.changes).toHaveBeenCalled()
    // Tokens never in plain text, never in the status.
    expect(readFileSync(file, 'utf8')).not.toContain('555.access1')
    expect(JSON.stringify(st)).not.toContain('555.')
  })

  it('a custom redirect URI is remembered and used for the exchange', async () => {
    const s = setup()
    const url = new URL(s.auth.begin('https://localhost:4444/cb'))
    expect(url.searchParams.get('redirect_uri')).toBe('https://localhost:4444/cb')
    expect(s.auth.status().redirectUri).toBe('https://localhost:4444/cb')
    await s.auth.complete(`code=C&state=${url.searchParams.get('state')}`)
    expect(s.server.forms[0].get('redirect_uri')).toBe('https://localhost:4444/cb')
  })

  it('without an API key there is nothing to sign in with', () => {
    const s = setup([tokens(1)], { key: false })
    expect(() => s.auth.begin()).toThrow('Спершу збережіть API-ключ')
  })

  it('a pasted URL from another attempt (state mismatch) is refused, nothing is exchanged', async () => {
    const s = setup()
    s.auth.begin()
    await expect(s.auth.complete('https://localhost:3003/callback?code=C&state=forged')).rejects.toThrow('state не збігається')
    expect(s.server.forms).toHaveLength(0)
  })

  it('without a started sign-in, or after it went stale', async () => {
    const s = setup()
    await expect(s.auth.complete('code=C&state=S')).rejects.toThrow('не розпочато')
    const url = new URL(s.auth.begin())
    s.clock.advance(PENDING_TTL_MS)
    expect(s.auth.status().pending).toBe(false)
    await expect(s.auth.complete(`code=C&state=${url.searchParams.get('state')}`)).rejects.toThrow('застарів')
  })

  it('Etsy refuses the code (used, expired, redirect mismatch): a clear message, sign in again', async () => {
    const s = setup([{ status: 400, body: { error: 'invalid_grant', error_description: 'code expired' } }])
    const url = new URL(s.auth.begin())
    await expect(s.auth.complete(`code=C&state=${url.searchParams.get('state')}`)).rejects.toThrow(
      /не прийняв код входу.*invalid_grant: code expired/
    )
    await expect(s.auth.complete(`code=C&state=${url.searchParams.get('state')}`)).rejects.toThrow('не розпочато')
    expect(s.auth.status().loggedIn).toBe(false)
  })

  it('a network failure during the exchange keeps the attempt (paste again)', async () => {
    const s = setup([{ throws: new TypeError('fetch failed') }, tokens(1)])
    const url = new URL(s.auth.begin())
    const pasted = `code=C&state=${url.searchParams.get('state')}`
    await expect(s.auth.complete(pasted)).rejects.toThrow('Немає з’єднання')
    expect((await s.auth.complete(pasted)).loggedIn).toBe(true)
  })

  it('a token answer without tokens is refused', async () => {
    const s = setup([{ body: { token_type: 'Bearer' } }])
    const url = new URL(s.auth.begin())
    await expect(s.auth.complete(`code=C&state=${url.searchParams.get('state')}`)).rejects.toThrow('неочікувану відповідь')
  })

  it('who-am-I failing is reported and does not leave a half sign-in', async () => {
    const s = setup()
    s.whoAmI.mockRejectedValueOnce(new Error('HTTP 403'))
    await expect(signIn(s)).rejects.toThrow('не сказав, чий це магазин: HTTP 403')
    expect(s.auth.status().loggedIn).toBe(false)
  })

  it('logout forgets the tokens', async () => {
    const s = setup()
    await signIn(s)
    expect(s.auth.logout()).toMatchObject({ loggedIn: false })
    expect(await s.auth.getAccessToken()).toBeNull()
    expect(readFileSync(file, 'utf8')).not.toContain('tokens')
  })

  it('tokens that cannot be decrypted read as signed out + unreadable', () => {
    writeFileSync(file, JSON.stringify({ etsyAuth: { tokens: { data: 'garbage', encrypted: true } } }))
    const s = setup()
    expect(s.auth.status()).toMatchObject({ loggedIn: false, unreadable: true })
  })
})

describe('access tokens', () => {
  it('a fresh token is used as is', async () => {
    const s = setup()
    await signIn(s)
    expect(await s.auth.getAccessToken()).toBe('555.access1')
    expect(s.server.forms).toHaveLength(1)
  })

  it('near expiry it is refreshed with the refresh token, once for concurrent callers', async () => {
    const s = setup([tokens(1), tokens(2, { scope: undefined })])
    await signIn(s)
    s.clock.advance(3600_000 - 30_000)
    const [a, b] = await Promise.all([s.auth.getAccessToken(), s.auth.getAccessToken()])
    expect([a, b]).toEqual(['555.access2', '555.access2'])
    expect(s.server.forms).toHaveLength(2)
    expect(Object.fromEntries(s.server.forms[1])).toEqual({
      grant_type: 'refresh_token',
      client_id: 'ks123',
      refresh_token: '555.refresh1'
    })
    expect(s.auth.status()).toMatchObject({ loggedIn: true, scopes: ['listings_r', 'listings_w', 'shops_r', 'shops_w'] })
    expect(s.auth.status().reloginBy).toBe(s.clock.now() + REFRESH_TOKEN_LIFE_MS)
    expect(await s.auth.getAccessToken()).toBe('555.access2')
  })

  it('a refused refresh token (90 days over, revoked) signs out and says so', async () => {
    const s = setup([tokens(1), { status: 400, body: { error: 'invalid_grant' } }])
    await signIn(s)
    s.changes.mockClear()
    s.clock.advance(3600_000)
    expect(await s.auth.getAccessToken()).toBeNull()
    expect(s.auth.status().loggedIn).toBe(false)
    expect(s.changes).toHaveBeenCalledWith(expect.objectContaining({ loggedIn: false }))
  })

  it('a network failure while refreshing keeps the sign-in (next call tries again)', async () => {
    const s = setup([tokens(1), { throws: new TypeError('offline') }, tokens(3)])
    await signIn(s)
    s.clock.advance(3600_000)
    await expect(s.auth.getAccessToken()).rejects.toThrow('Немає з’єднання')
    expect(s.auth.status().loggedIn).toBe(true)
    expect(await s.auth.getAccessToken()).toBe('555.access3')
  })

  it('invalidate (Etsy said 401) refreshes even before expiry', async () => {
    const s = setup([tokens(1), tokens(2)])
    await signIn(s)
    expect(await s.auth.invalidate()).toBe('555.access2')
    s.auth.logout()
    expect(await s.auth.invalidate()).toBeNull()
  })
})

describe('createEtsyAuthStore', () => {
  it('keeps the other sections of settings.json and seals the tokens', async () => {
    const s = setup()
    await signIn(s)
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    expect(raw.apiKey).toBeTruthy()
    expect(raw.etsyAuth.tokens.encrypted).toBe(true)
    expect(raw.etsyAuth.redirectUri).toBe(DEFAULT_REDIRECT_URI)
    expect(createKeyStore(file, fakeSafeStorage()).getKey()).toBe('ks123:secret')
  })

  it('corrupt token JSON reads as none; plain storage is reported as not encrypted', () => {
    const store = createEtsyAuthStore(file, fakeSafeStorage(false))
    writeFileSync(file, JSON.stringify({ etsyAuth: { tokens: { data: '{"oops":1}', encrypted: false } } }))
    expect(store.get()).toBeNull()
    expect(store.unreadable()).toBe(true)
    store.set({
      clientId: 'k',
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 1,
      refreshObtainedAt: 1,
      signedInAt: 1,
      scopes: [],
      userId: 1,
      shopId: null,
      shopName: null
    })
    expect(store.get()?.accessToken).toBe('a')
    expect(store.encrypted()).toBe(false)
    expect(store.unreadable()).toBe(false)
  })
})
