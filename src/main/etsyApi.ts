// Etsy Open API v3 client — API-key-only (no OAuth), public endpoints.
//
// Auth: every request carries `x-api-key: <keystring>:<shared_secret>` (since
// 2026-02-09 the keystring alone is rejected). Requests are strictly sequential
// with a minimum gap; 429 and 5xx are retried with exponential backoff + jitter
// honouring Retry-After. fetch/sleep/random/now are injectable for tests.

import type { Quota } from '../shared/types'

export const ETSY_BASE_URL = 'https://openapi.etsy.com'
/** `limit` cap of every paginated v3 endpoint. */
export const PAGE_LIMIT = 100
/** v3 rejects offset > 12000 ("the offset parameter is limited to a maximum value of 12000"). */
export const MAX_OFFSET = 12000
/** listing_ids cap of /listings/batch ("Limit 100 ids maximum per query"). */
export const BATCH_LIMIT = 100
/** findShops pages read while looking for the exact shop_name (each page is one request). */
export const FIND_SHOP_MAX_PAGES = 5

// ------------------------------------------------------------ response shapes

export interface EtsyMoney {
  amount: number
  divisor: number
  currency_code: string
}

/** OAS `Shop` (GET /shops/{shop_id}). Every field is optional-ish in practice. */
export interface EtsyShop {
  shop_id: number
  user_id?: number
  shop_name: string
  create_date?: number
  created_timestamp?: number
  title: string | null
  announcement?: string | null
  currency_code: string | null
  is_vacation?: boolean
  vacation_message?: string | null
  sale_message?: string | null
  digital_sale_message?: string | null
  update_date?: number
  updated_timestamp?: number
  listing_active_count: number
  digital_listing_count?: number
  login_name?: string
  accepts_custom_requests?: boolean
  policy_welcome?: string | null
  policy_payment?: string | null
  policy_shipping?: string | null
  policy_refunds?: string | null
  policy_additional?: string | null
  policy_seller_info?: string | null
  policy_update_date?: number
  policy_has_private_receipt_info?: boolean
  has_unstructured_policies?: boolean
  policy_privacy?: string | null
  vacation_autoreply?: string | null
  url: string
  image_url_760x100?: string | null
  num_favorers?: number
  languages?: string[]
  icon_url_fullxfull: string | null
  is_using_structured_policies?: boolean
  has_onboarded_structured_policies?: boolean
  include_dispute_form_link?: boolean
  is_direct_checkout_onboarded?: boolean
  is_etsy_payments_onboarded?: boolean
  is_calculated_eligible?: boolean
  is_opted_in_to_buyer_promise?: boolean
  is_shop_us_based?: boolean
  transaction_sold_count?: number
  shipping_from_country_iso?: string | null
  shop_location_country_iso?: string | null
  review_count?: number | null
  review_average?: number | null
  [k: string]: unknown
}

/** OAS `ShopListing` (an item of /shops/{id}/listings/active). */
export interface EtsyListing {
  listing_id: number
  user_id?: number
  shop_id: number
  title: string
  description: string
  state: string
  creation_timestamp?: number
  created_timestamp?: number
  ending_timestamp?: number
  original_creation_timestamp?: number
  last_modified_timestamp?: number
  updated_timestamp?: number
  state_timestamp?: number | null
  quantity?: number
  shop_section_id?: number | null
  featured_rank?: number
  url: string
  num_favorers?: number
  non_taxable?: boolean
  is_taxable?: boolean
  is_customizable?: boolean
  is_personalizable?: boolean
  listing_type?: string
  tags?: string[]
  materials?: string[]
  shipping_profile_id?: number | null
  return_policy_id?: number | null
  processing_min?: number | null
  processing_max?: number | null
  who_made?: string | null
  when_made?: string | null
  is_supply?: boolean | null
  item_weight?: number | null
  item_weight_unit?: string | null
  item_length?: number | null
  item_width?: number | null
  item_height?: number | null
  item_dimensions_unit?: string | null
  is_private?: boolean
  style?: string[]
  file_data?: string | null
  has_variations?: boolean
  should_auto_renew?: boolean
  language?: string | null
  price: EtsyMoney
  converted_price?: EtsyMoney | null
  taxonomy_id?: number | null
  readiness_state_id?: number | null
  /**
   * Not in the OAS `ShopListing`, but the live /listings/active items carry it
   * (verified 2026-10, same value as /listings/batch). Tabulated once a day.
   */
  views?: number
  [k: string]: unknown
}

/** OAS `ListingImage`. */
export interface EtsyListingImage {
  listing_id: number
  listing_image_id: number
  hex_code?: string | null
  red?: number | null
  green?: number | null
  blue?: number | null
  hue?: number | null
  saturation?: number | null
  brightness?: number | null
  is_black_and_white?: boolean | null
  creation_tsz?: number
  created_timestamp?: number
  rank: number
  url_75x75: string
  url_170x135: string
  url_570xN: string
  url_fullxfull: string
  full_height: number | null
  full_width: number | null
  alt_text: string | null
  [k: string]: unknown
}

/** OAS `ListingVideo`. */
export interface EtsyListingVideo {
  video_id: number
  height?: number
  width?: number
  thumbnail_url?: string
  video_url?: string
  video_state?: string
  [k: string]: unknown
}

/** OAS `…ListingPersonalization` (includes=Personalization). */
export interface EtsyPersonalization {
  personalization_questions?: Array<{
    question_id?: number | null
    question_text?: string
    instructions?: string | null
    question_type?: string
    required?: boolean
    max_allowed_characters?: number | null
    max_allowed_files?: number | null
    add_on_price?: EtsyMoney | null
    options?: Array<{ option_id: number | null; label: string }> | null
  }>
}

/** OAS `ShopListingWithAssociations` (/listings/batch, /listings/{id}). */
export interface EtsyListingWithAssociations extends EtsyListing {
  images?: EtsyListingImage[]
  videos?: EtsyListingVideo[]
  personalization?: EtsyPersonalization | null
  skus?: string[]
}

/**
 * Associations requested from /listings/batch and /listings/{id} (the OAS enum
 * is Images, Shop, User, Translations, Videos, Personalization, BuyerPrice).
 * Shop/User duplicate what we read anyway, Translations multiply the payload,
 * BuyerPrice is a buyer-specific computation — so they are not requested. If
 * Etsy refuses this set for an API-key-only app (401/403) while plain
 * `Images` works, the client falls back to `Images` for the rest of its life.
 */
export const DETAIL_INCLUDES = ['Images', 'Videos', 'Personalization'] as const
export const FALLBACK_INCLUDES = ['Images'] as const

/**
 * OAS `TransactionReview` (an item of GET /shops/{shop_id}/reviews). The OAS
 * documents both `create_timestamp`/`created_timestamp` and
 * `update_timestamp`/`updated_timestamp` (same meaning, epoch seconds).
 * `buyer_user_id` and `image_url_fullxfull` "may be absent, depending on the
 * buyer's privacy settings".
 */
export interface EtsyTransactionReview {
  shop_id: number
  listing_id: number
  transaction_id?: number | null
  buyer_user_id?: number | null
  rating: number
  review?: string | null
  language?: string | null
  image_url_fullxfull?: string | null
  create_timestamp?: number
  created_timestamp?: number
  update_timestamp?: number
  updated_timestamp?: number
  [k: string]: unknown
}

/** Query of getReviewsByShop: `min_created`/`max_created` are epoch seconds (OAS minimum 946684800). */
export interface ReviewQuery {
  limit?: number
  offset?: number
  minCreated?: number
  maxCreated?: number
}

/** The OAS `minimum` of `min_created`/`max_created` (2000-01-01). */
export const REVIEW_EPOCH_MIN = 946_684_800

export interface Paged<T> {
  count: number
  results: T[]
}

// --------------------------------------------------------------------- errors

export type EtsyErrorKind =
  | 'no_key'
  | 'auth'
  | 'not_found'
  | 'bad_request'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'bad_response'

export class EtsyApiError extends Error {
  constructor(
    public kind: EtsyErrorKind,
    message: string,
    public status?: number,
    /** `x-etsy-request-uuid` of the failing response, for support/debugging. */
    public requestId?: string,
    /** Etsy's own `{"error": "…"}` text. */
    public detail?: string
  ) {
    super(message)
    this.name = 'EtsyApiError'
  }
}

function errorMessage(kind: EtsyErrorKind, status: number | undefined, detail?: string): string {
  const tail = detail ? ` (${detail})` : ''
  switch (kind) {
    case 'no_key':
      return 'API-ключ Etsy не задано. Відкрийте Налаштування та вставте Keystring і Shared secret.'
    case 'auth':
      return `Etsy відхилив API-ключ (HTTP ${status}). Перевірте Keystring і Shared secret у Налаштуваннях та чи схвалено застосунок.${tail}`
    case 'not_found':
      return `Etsy не знайшов цей магазин або товар (HTTP 404).${tail}`
    case 'bad_request':
      return `Etsy відхилив запит як некоректний (HTTP 400).${tail}`
    case 'rate_limit':
      return 'Перевищено ліміт запитів до Etsy. Зачекайте трохи й повторіть сканування.'
    case 'server':
      return `Сервер Etsy повернув помилку (HTTP ${status}). Спробуйте пізніше.${tail}`
    case 'network':
      return `Немає з’єднання з Etsy.${tail}`
    case 'bad_response':
      return 'Etsy повернув неочікувану відповідь.'
  }
}

function makeError(
  kind: EtsyErrorKind,
  status?: number,
  requestId?: string,
  detail?: string
): EtsyApiError {
  return new EtsyApiError(kind, errorMessage(kind, status, detail), status, requestId, detail)
}

// ---------------------------------------------------------------------- quota

function intHeader(h: Headers, name: string): number | null {
  const v = h.get(name)
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Read Etsy's rate-limit headers; null when the response carries none of them. */
export function parseQuota(h: Headers, now: number): Quota | null {
  const q: Quota = {
    limitPerDay: intHeader(h, 'x-limit-per-day'),
    remainingToday: intHeader(h, 'x-remaining-today'),
    limitPerSecond: intHeader(h, 'x-limit-per-second'),
    remainingThisSecond: intHeader(h, 'x-remaining-this-second'),
    at: now
  }
  const any =
    q.limitPerDay != null ||
    q.remainingToday != null ||
    q.limitPerSecond != null ||
    q.remainingThisSecond != null
  return any ? q : null
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date; null if absent/invalid. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (value == null || value.trim() === '') return null
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}

// --------------------------------------------------------------------- client

export interface EtsyClientOptions {
  /** `keystring:shared_secret`, or null when not configured. Read per request. */
  getApiKey: () => string | null
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  now?: () => number
  baseUrl?: string
  /** Minimum gap between two requests (keeps us under small per-second limits). */
  minIntervalMs?: number
  /** Retries for 429 / 5xx / network errors (so up to maxRetries + 1 attempts). */
  maxRetries?: number
  /** First backoff step; doubles each retry. */
  backoffBaseMs?: number
  /** A Retry-After longer than this (the daily quota) fails fast instead of waiting. */
  maxRetryAfterMs?: number
  /** Abort a request (headers + body) that takes longer than this. Default 30 s. */
  requestTimeoutMs?: number
  /** How many times a timed-out request is retried (within maxRetries). Default 1. */
  maxTimeoutRetries?: number
  onQuota?: (q: Quota) => void
}

export type Params = Record<string, string | number | boolean | Array<string | number> | undefined>

export interface ActiveListingsResult {
  listings: EtsyListing[]
  /** Etsy's `count` from the last page. */
  count: number
  /** More listings exist than the offset cap lets us page through. */
  truncated: boolean
}

export interface EtsyClient {
  request<T>(path: string, params?: Params, apiKey?: string): Promise<T>
  ping(apiKey?: string): Promise<{ application_id: number }>
  findShopByName(name: string): Promise<EtsyShop | null>
  getShop(shopId: number): Promise<EtsyShop>
  getAllActiveListings(
    shopId: number,
    onPage?: (page: number, pages: number) => void
  ): Promise<ActiveListingsResult>
  /** The associations currently requested for listing details. */
  detailIncludes(): readonly string[]
  /** One listing with its images/videos/personalization; null when Etsy answers 404. */
  getListing(listingId: number): Promise<EtsyListingWithAssociations | null>
  /**
   * Listings (with images) by id, 100 per batch request. Ids Etsy no longer
   * knows are simply absent from the result: a batch answered 404/400 is split
   * in halves down to single `GET /listings/{id}` calls, where 404 = gone.
   */
  getListingsByIds(
    ids: number[],
    onChunk?: (done: number, total: number) => void
  ): Promise<Map<number, EtsyListingWithAssociations>>
  /**
   * One page of GET /shops/{shop_id}/reviews (getReviewsByShop): limit ≤ 100,
   * optional created-time bounds. The OAS documents no result order.
   */
  getShopReviews(shopId: number, q?: ReviewQuery): Promise<Paged<EtsyTransactionReview>>
}

export function buildUrl(baseUrl: string, path: string, params: Params = {}): string {
  const url = new URL(path, baseUrl)
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    // v3 arrays are comma-separated, no brackets: ?listing_ids=1,2,3
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  return url.toString()
}

export function createEtsyClient(opts: EtsyClientOptions): EtsyClient {
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const random = opts.random ?? Math.random
  const now = opts.now ?? Date.now
  const baseUrl = opts.baseUrl ?? ETSY_BASE_URL
  const minInterval = opts.minIntervalMs ?? 125
  const maxRetries = opts.maxRetries ?? 4
  const backoffBase = opts.backoffBaseMs ?? 1000
  const maxRetryAfter = opts.maxRetryAfterMs ?? 60_000
  const requestTimeout = opts.requestTimeoutMs ?? 30_000
  const maxTimeoutRetries = opts.maxTimeoutRetries ?? 1

  function timeoutError(): EtsyApiError {
    const secs = Math.max(1, Math.round(requestTimeout / 1000))
    return new EtsyApiError(
      'network',
      `Etsy не відповідає (тайм-аут ${secs} с). Перевірте з’єднання й спробуйте ще раз.`,
      undefined,
      undefined,
      'timeout'
    )
  }

  // Serialize every request through one promise chain.
  let queue: Promise<unknown> = Promise.resolve()
  let lastRequestAt = -Infinity

  function backoff(attempt: number): number {
    return backoffBase * 2 ** attempt + Math.floor(random() * backoffBase)
  }

  async function once<T>(path: string, params: Params | undefined, key: string): Promise<T> {
    const url = buildUrl(baseUrl, path, params)
    let timeouts = 0
    for (let attempt = 0; ; attempt++) {
      const wait = lastRequestAt + minInterval - now()
      if (wait > 0) await sleep(wait)
      lastRequestAt = now()

      // A stalled connection must not hold the (serialized) request queue for
      // minutes: the abort covers both the headers and the body read. A timeout
      // is retried at most maxTimeoutRetries times (it has already waited).
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), requestTimeout)
      const retryTimeout = (): boolean => timeouts++ < maxTimeoutRetries && attempt < maxRetries
      try {
        let res: Response
        try {
          res = await doFetch(url, {
            headers: { 'x-api-key': key, accept: 'application/json' },
            signal: ctrl.signal
          })
        } catch (e) {
          if (ctrl.signal.aborted) {
            if (retryTimeout()) continue
            throw timeoutError()
          }
          if (attempt < maxRetries) {
            await sleep(backoff(attempt))
            continue
          }
          throw makeError('network', undefined, undefined, (e as Error)?.message)
        }

        const requestId = res.headers.get('x-etsy-request-uuid') ?? undefined
        const quota = parseQuota(res.headers, now())
        if (quota) opts.onQuota?.(quota)

        if (res.ok) {
          try {
            return (await res.json()) as T
          } catch {
            if (ctrl.signal.aborted) {
              if (retryTimeout()) continue
              throw timeoutError()
            }
            throw makeError('bad_response', res.status, requestId)
          }
        }

        let detail: string | undefined
        try {
          const body = (await res.json()) as { error?: unknown }
          if (typeof body?.error === 'string') detail = body.error
        } catch {
          // Non-JSON error body — the status says enough.
        }

        if (res.status === 429) {
          const ra = parseRetryAfter(res.headers.get('retry-after'), now())
          if (ra != null && ra > maxRetryAfter) {
            throw makeError('rate_limit', 429, requestId, detail)
          }
          if (attempt < maxRetries) {
            await sleep((ra ?? backoff(attempt)) + Math.floor(random() * 250))
            continue
          }
          throw makeError('rate_limit', 429, requestId, detail)
        }
        if (res.status >= 500) {
          if (attempt < maxRetries) {
            await sleep(backoff(attempt))
            continue
          }
          throw makeError('server', res.status, requestId, detail)
        }
        if (res.status === 401 || res.status === 403) {
          throw makeError('auth', res.status, requestId, detail)
        }
        if (res.status === 404) throw makeError('not_found', 404, requestId, detail)
        if (res.status === 400) throw makeError('bad_request', 400, requestId, detail)
        throw makeError('server', res.status, requestId, detail)
      } finally {
        clearTimeout(timer)
      }
    }
  }

  function request<T>(path: string, params?: Params, apiKey?: string): Promise<T> {
    const key = apiKey ?? opts.getApiKey()
    if (!key) return Promise.reject(makeError('no_key'))
    const run = queue.then(() => once<T>(path, params, key))
    queue = run.catch(() => undefined)
    return run
  }

  function expectPaged<T>(body: Paged<T>): Paged<T> {
    if (!body || !Array.isArray(body.results)) throw makeError('bad_response')
    return body
  }

  let includes: readonly string[] = DETAIL_INCLUDES

  /**
   * Run `fn` with the current includes; if Etsy refuses them as unauthorized
   * and a smaller set works, keep using the smaller set from now on.
   */
  async function withIncludes<T>(fn: (inc: readonly string[]) => Promise<T>): Promise<T> {
    try {
      return await fn(includes)
    } catch (e) {
      if (!(e instanceof EtsyApiError) || e.kind !== 'auth' || includes === FALLBACK_INCLUDES) throw e
      let out: T
      try {
        out = await fn(FALLBACK_INCLUDES)
      } catch {
        throw e
      }
      includes = FALLBACK_INCLUDES
      return out
    }
  }

  async function getListing(listingId: number): Promise<EtsyListingWithAssociations | null> {
    try {
      return await withIncludes((inc) =>
        request<EtsyListingWithAssociations>(`/v3/application/listings/${listingId}`, {
          includes: [...inc]
        })
      )
    } catch (e) {
      if (e instanceof EtsyApiError && e.kind === 'not_found') return null
      throw e
    }
  }

  /**
   * One batch request. The spec documents a 404 for /listings/batch, which may
   * mean "some id is unknown" (deleted / no longer public): bisect so one dead
   * id costs ~2·log2(100) extra requests, and only a single-id 404 counts as
   * gone. Other errors (and a 400 that the single GET also rejects) still throw.
   */
  async function batch(ids: number[]): Promise<EtsyListingWithAssociations[]> {
    try {
      return await withIncludes(async (inc) =>
        expectPaged(
          await request<Paged<EtsyListingWithAssociations>>('/v3/application/listings/batch', {
            listing_ids: ids,
            includes: [...inc]
          })
        ).results
      )
    } catch (e) {
      if (!(e instanceof EtsyApiError) || (e.kind !== 'not_found' && e.kind !== 'bad_request')) throw e
      if (ids.length === 1) {
        const one = await getListing(ids[0])
        return one ? [one] : []
      }
      const mid = Math.ceil(ids.length / 2)
      return [...(await batch(ids.slice(0, mid))), ...(await batch(ids.slice(mid)))]
    }
  }

  return {
    request,

    ping(apiKey) {
      return request('/v3/application/openapi-ping', undefined, apiKey)
    },

    async findShopByName(name) {
      // findShops is a name *search* that may match fuzzily — keep only an exact,
      // case-insensitive hit. It need not rank first, so keep paging (bounded by
      // FIND_SHOP_MAX_PAGES) until it shows up or the results run out.
      const want = name.toLowerCase()
      for (let page = 0, offset = 0; page < FIND_SHOP_MAX_PAGES && offset <= MAX_OFFSET; page++) {
        const body = expectPaged(
          await request<Paged<EtsyShop>>('/v3/application/shops', {
            shop_name: name,
            limit: PAGE_LIMIT,
            offset: offset || undefined
          })
        )
        const hit = body.results.find((s) => s.shop_name?.toLowerCase() === want)
        if (hit) return hit
        offset += PAGE_LIMIT
        if (body.results.length === 0 || offset >= (Number(body.count) || 0)) break
      }
      return null
    },

    getShop(shopId) {
      return request<EtsyShop>(`/v3/application/shops/${shopId}`)
    },

    async getAllActiveListings(shopId, onPage) {
      const seen = new Map<number, EtsyListing>()
      let count = 0
      let offset = 0
      let page = 0
      for (;;) {
        const body = expectPaged(
          await request<Paged<EtsyListing>>(`/v3/application/shops/${shopId}/listings/active`, {
            limit: PAGE_LIMIT,
            offset
          })
        )
        page++
        count = Number(body.count) || 0
        const pages = Math.max(page, Math.ceil(Math.min(count, MAX_OFFSET + PAGE_LIMIT) / PAGE_LIMIT))
        onPage?.(page, pages)
        // Listings can shift between pages while we read — dedupe by id.
        for (const l of body.results) seen.set(l.listing_id, l)
        offset += PAGE_LIMIT
        if (body.results.length === 0 || offset >= count || offset > MAX_OFFSET) break
      }
      return { listings: [...seen.values()], count, truncated: count > MAX_OFFSET + PAGE_LIMIT }
    },

    getListing,

    async getShopReviews(shopId, q = {}) {
      const clamp = (v: number | undefined): number | undefined =>
        v == null ? undefined : Math.max(REVIEW_EPOCH_MIN, Math.trunc(v))
      return expectPaged(
        await request<Paged<EtsyTransactionReview>>(`/v3/application/shops/${shopId}/reviews`, {
          limit: Math.min(PAGE_LIMIT, Math.max(1, q.limit ?? PAGE_LIMIT)),
          offset: q.offset || undefined,
          min_created: clamp(q.minCreated),
          max_created: clamp(q.maxCreated)
        })
      )
    },

    detailIncludes: () => includes,

    async getListingsByIds(ids, onChunk) {
      const out = new Map<number, EtsyListingWithAssociations>()
      const unique = [...new Set(ids)]
      for (let i = 0; i < unique.length; i += BATCH_LIMIT) {
        const chunk = unique.slice(i, i + BATCH_LIMIT)
        for (const l of await batch(chunk)) out.set(l.listing_id, l)
        onChunk?.(Math.min(i + chunk.length, unique.length), unique.length)
      }
      return out
    }
  }
}
