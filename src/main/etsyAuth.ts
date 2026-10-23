// Signing in to Etsy (OAuth 2.0 authorization code + PKCE) so the app can edit
// the user's OWN shop: profile texts and listings. Reading other shops keeps
// using the API key alone (etsyApi.ts).
//
// Etsy only accepts https redirect URIs and the app has no web server with a
// certificate, so the redirect (https://localhost:3003/callback by default —
// it must equal one registered at etsy.com/developers/your-apps) fails to load
// in the browser; the user copies that URL from the address bar and pastes it
// into the app, which exchanges the code. Access tokens live 1 h and are
// refreshed transparently; the refresh token lives 90 days.

import { createHash, randomBytes } from 'crypto'
import type { EtsyAuthStatus } from '../shared/types'
import type { EtsyAuthStore, StoredEtsyAuth } from './settings'

export const ETSY_CONNECT_URL = 'https://www.etsy.com/oauth/connect'
export const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'
export const DEFAULT_REDIRECT_URI = 'https://localhost:3003/callback'
/**
 * Asked for at sign-in: listings (read, edit, delete), the shop (read, edit),
 * orders and money (read, mark shipped), the account's email and addresses.
 * A sign-in made with fewer scopes keeps working for what it has; the UI asks
 * to sign in again for the rest (`missingScopes`).
 */
export const OAUTH_SCOPES = [
  'listings_r',
  'listings_w',
  'listings_d',
  'shops_r',
  'shops_w',
  'transactions_r',
  'transactions_w',
  'email_r',
  'address_r'
] as const
/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 60_000
/** A started sign-in is valid this long (the code itself lives a few minutes). */
export const PENDING_TTL_MS = 30 * 60_000
/** Etsy's refresh-token lifetime: after it the user signs in again. */
export const REFRESH_TOKEN_LIFE_MS = 90 * 24 * 3600_000

/** A Ukrainian message for the UI. */
export class EtsyAuthError extends Error {}

const b64url = (b: Buffer): string => b.toString('base64url')

/** PKCE: a 43-char verifier from 32 random bytes and its S256 challenge. */
export function pkcePair(random: (n: number) => Buffer = randomBytes): { verifier: string; challenge: string } {
  const verifier = b64url(random(32))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

/** An https URL without credentials or a fragment — what Etsy accepts as redirect_uri. */
export function normalizeRedirectUri(raw: unknown): string {
  const v = String(raw ?? '').trim()
  let u: URL
  try {
    u = new URL(v)
  } catch {
    throw new EtsyAuthError('Адреса повернення має бути повною адресою, напр. https://localhost:3003/callback.')
  }
  if (u.protocol !== 'https:') throw new EtsyAuthError('Etsy приймає лише адреси повернення на https://.')
  if (u.username || u.password || u.hash) throw new EtsyAuthError('Адреса повернення — без логіна, пароля й #.')
  return u.toString()
}

export function buildAuthorizeUrl(p: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
  scopes?: readonly string[]
}): string {
  const u = new URL(ETSY_CONNECT_URL)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('client_id', p.clientId)
  u.searchParams.set('redirect_uri', p.redirectUri)
  u.searchParams.set('scope', (p.scopes ?? OAUTH_SCOPES).join(' '))
  u.searchParams.set('state', p.state)
  u.searchParams.set('code_challenge', p.challenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

/**
 * What the user pasted: the whole redirect URL, or just its query
 * (`code=…&state=…`). Etsy's refusal comes back as `error=access_denied`.
 */
export function parseCallback(pasted: unknown): { code: string; state: string } {
  const v = String(pasted ?? '').trim()
  if (!v) throw new EtsyAuthError('Вставте адресу, на яку Etsy перекинув браузер після входу.')
  let q: URLSearchParams
  try {
    q = /^[a-z]+:\/\//i.test(v) ? new URL(v).searchParams : new URLSearchParams(v.replace(/^[?#]/, ''))
  } catch {
    throw new EtsyAuthError('Не вдалося розібрати адресу — скопіюйте її з адресного рядка повністю.')
  }
  const err = q.get('error')
  if (err) {
    throw new EtsyAuthError(
      err === 'access_denied'
        ? 'Доступ не надано: на сторінці Etsy натиснули «Відмовити». Спробуйте увійти ще раз.'
        : `Etsy повернув помилку: ${q.get('error_description') || err}.`
    )
  }
  const code = q.get('code')
  const state = q.get('state')
  if (!code || !state) {
    throw new EtsyAuthError('В адресі немає коду входу (code=…). Скопіюйте адресу з адресного рядка після «Дозволити».')
  }
  return { code, state }
}

interface TokenResponse {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  token_type?: unknown
  scope?: unknown
}

export interface EtsyAuthDeps {
  store: EtsyAuthStore
  /** The API keystring (= OAuth client_id), null without a saved key. */
  getClientId: () => string | null
  /** After a new token: who signed in — GET /users/me and the shop name, with that token. */
  whoAmI: (accessToken: string) => Promise<{ userId: number; shopId: number | null; shopName: string | null }>
  fetch?: typeof fetch
  now?: () => number
  random?: (n: number) => Buffer
  /** Sign-in state changed (sign-in, sign-out, a refresh that failed for good). */
  onChange?: (s: EtsyAuthStatus) => void
}

export interface EtsyAuth {
  status(): EtsyAuthStatus
  /** Start signing in: the URL to open in the browser. Throws EtsyAuthError. */
  begin(redirectUri?: string): string
  /** Finish with what the user pasted. Throws EtsyAuthError. */
  complete(pasted: string): Promise<EtsyAuthStatus>
  /** A valid access token (refreshed when about to expire), or null when signed out. */
  getAccessToken(): Promise<string | null>
  /** The stored token was refused (401): try one refresh, else sign out. */
  invalidate(): Promise<string | null>
  logout(): EtsyAuthStatus
}

export function createEtsyAuth(deps: EtsyAuthDeps): EtsyAuth {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const now = deps.now ?? Date.now
  const random = deps.random ?? randomBytes
  let pending: { verifier: string; state: string; redirectUri: string; clientId: string; at: number } | null = null
  let refreshing: Promise<string | null> | null = null

  function status(): EtsyAuthStatus {
    const redirectUri = deps.store.getRedirectUri() ?? DEFAULT_REDIRECT_URI
    const a = deps.store.get()
    const base = {
      redirectUri,
      pending: !!pending && now() - pending.at < PENDING_TTL_MS,
      encrypted: deps.store.encrypted()
    }
    if (!a) return { loggedIn: false, ...base, ...(deps.store.unreadable() ? { unreadable: true } : {}) }
    return {
      loggedIn: true,
      ...base,
      userId: a.userId,
      shopId: a.shopId,
      shopName: a.shopName,
      scopes: a.scopes,
      signedInAt: a.signedInAt,
      reloginBy: a.refreshObtainedAt + REFRESH_TOKEN_LIFE_MS
    }
  }

  const changed = (): void => deps.onChange?.(status())

  async function tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    let res: Response
    try {
      res = await doFetch(ETSY_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams(form).toString()
      })
    } catch (e) {
      throw new EtsyAuthError(`Немає з’єднання з Etsy (${(e as Error)?.message ?? 'мережа'}).`)
    }
    let body: TokenResponse & { error?: unknown; error_description?: unknown } = {}
    try {
      body = (await res.json()) as typeof body
    } catch {
      // handled below
    }
    if (!res.ok) {
      const why = [body.error, body.error_description].filter((x) => typeof x === 'string').join(': ')
      const err = new EtsyAuthError(`Etsy не видав токен (HTTP ${res.status}${why ? `, ${why}` : ''}).`)
      ;(err as EtsyAuthError & { status?: number; code?: unknown }).status = res.status
      ;(err as EtsyAuthError & { code?: unknown }).code = body.error
      throw err
    }
    if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string') {
      throw new EtsyAuthError('Etsy повернув неочікувану відповідь на запит токена.')
    }
    return body
  }

  const expiresAt = (b: TokenResponse): number => now() + (Number(b.expires_in) > 0 ? Number(b.expires_in) : 3600) * 1000
  const scopesOf = (b: TokenResponse, fallback: string[]): string[] =>
    typeof b.scope === 'string' && b.scope.trim() ? b.scope.trim().split(/\s+/) : fallback

  async function refresh(a: StoredEtsyAuth): Promise<string | null> {
    try {
      const b = await tokenRequest({ grant_type: 'refresh_token', client_id: a.clientId, refresh_token: a.refreshToken })
      const next: StoredEtsyAuth = {
        ...a,
        accessToken: b.access_token as string,
        refreshToken: b.refresh_token as string,
        expiresAt: expiresAt(b),
        refreshObtainedAt: now(),
        scopes: scopesOf(b, a.scopes)
      }
      deps.store.set(next)
      return next.accessToken
    } catch (e) {
      // A refused refresh token (expired after 90 days, revoked) means signed
      // out; a network/server problem keeps the sign-in for the next try.
      const status = (e as { status?: number }).status
      if (status === 400 || status === 401) {
        deps.store.clear()
        changed()
        return null
      }
      throw e
    }
  }

  /** Single-flight: concurrent callers share one refresh. */
  function refreshOnce(a: StoredEtsyAuth): Promise<string | null> {
    if (!refreshing) {
      refreshing = refresh(a).finally(() => {
        refreshing = null
      })
    }
    return refreshing
  }

  return {
    status,

    begin(redirectUri) {
      const clientId = deps.getClientId()
      if (!clientId) throw new EtsyAuthError('Спершу збережіть API-ключ Etsy (Keystring і Shared secret) у Налаштуваннях.')
      const uri = normalizeRedirectUri(redirectUri ?? deps.store.getRedirectUri() ?? DEFAULT_REDIRECT_URI)
      deps.store.setRedirectUri(uri)
      const { verifier, challenge } = pkcePair(random)
      const state = b64url(random(24))
      pending = { verifier, state, redirectUri: uri, clientId, at: now() }
      changed()
      return buildAuthorizeUrl({ clientId, redirectUri: uri, state, challenge })
    },

    async complete(pasted) {
      const { code, state } = parseCallback(pasted)
      const p = pending
      if (!p || now() - p.at >= PENDING_TTL_MS) {
        throw new EtsyAuthError('Вхід не розпочато або він застарів — натисніть «Увійти через Etsy» ще раз.')
      }
      if (state !== p.state) {
        throw new EtsyAuthError('Ця адреса від іншої спроби входу (state не збігається) — увійдіть ще раз.')
      }
      let b: TokenResponse
      try {
        b = await tokenRequest({
          grant_type: 'authorization_code',
          client_id: p.clientId,
          redirect_uri: p.redirectUri,
          code,
          code_verifier: p.verifier
        })
      } catch (e) {
        if ((e as { status?: number }).status === 400) {
          pending = null
          throw new EtsyAuthError(
            `Etsy не прийняв код входу: він уже використаний, застарів або адреса повернення не збігається з зареєстрованою (${(e as Error).message})`
          )
        }
        throw e
      }
      pending = null
      const access = b.access_token as string
      let me: Awaited<ReturnType<EtsyAuthDeps['whoAmI']>>
      try {
        me = await deps.whoAmI(access)
      } catch (e) {
        throw new EtsyAuthError(`Вхід вдався, але Etsy не сказав, чий це магазин: ${(e as Error).message}`)
      }
      deps.store.set({
        clientId: p.clientId,
        accessToken: access,
        refreshToken: b.refresh_token as string,
        expiresAt: expiresAt(b),
        refreshObtainedAt: now(),
        signedInAt: now(),
        scopes: scopesOf(b, [...OAUTH_SCOPES]),
        userId: me.userId,
        shopId: me.shopId,
        shopName: me.shopName
      })
      changed()
      return status()
    },

    async getAccessToken() {
      const a = deps.store.get()
      if (!a) return null
      if (a.expiresAt - now() > REFRESH_MARGIN_MS) return a.accessToken
      return refreshOnce(a)
    },

    async invalidate() {
      const a = deps.store.get()
      if (!a) return null
      return refreshOnce(a)
    },

    logout() {
      pending = null
      deps.store.clear()
      changed()
      return status()
    }
  }
}
