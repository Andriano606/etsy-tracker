// Feature "account" (the reference feature — copy its shape): who is signed in.
// getUser (email_r), getUserAddresses (address_r), tokenScopes (what the token
// really may do), getShopByOwnerUserId. Each part is read on its own: a
// missing permission leaves that part null with a note instead of failing all.

import type { AccountAddress, AccountSummary } from '../../shared/features/account'
import { isEtsyCdnUrl } from '../../shared/externalUrl'
import { decodeHtmlEntities } from '../../shared/html'
import { missingScopes, SCOPE_LABEL } from '../../shared/myShop'
import { EtsyApiError, type EtsyClient, type EtsyShop, type Paged } from '../etsyApi'
import { textResult } from '../mcpProtocol'
import { mcpFail, mcpOwnShop, ownShop } from './common'
import type { Feature, FeatureCtx } from './types'

interface EtsyUser {
  user_id: number
  primary_email?: string | null
  first_name?: string | null
  last_name?: string | null
  image_url_75x75?: string | null
}

interface EtsyUserAddress {
  user_address_id: number
  name?: string | null
  first_line?: string | null
  second_line?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  iso_country_code?: string | null
  country_name?: string | null
  is_default_shipping_address?: boolean
}

const txt = (v: unknown): string | null => (v == null || v === '' ? null : decodeHtmlEntities(String(v)))

export function toAddress(a: EtsyUserAddress): AccountAddress {
  return {
    id: a.user_address_id,
    name: txt(a.name),
    firstLine: txt(a.first_line),
    secondLine: txt(a.second_line),
    city: txt(a.city),
    state: txt(a.state),
    zip: txt(a.zip),
    countryIso: a.iso_country_code ?? null,
    countryName: txt(a.country_name),
    isDefaultShipping: !!a.is_default_shipping_address
  }
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Everything about the signed-in account; each part independently. */
export async function accountSummary(
  client: EtsyClient,
  status: FeatureCtx['authStatus'],
  accessToken: () => Promise<string | null>
): Promise<AccountSummary> {
  ownShop(status)
  const st = status()
  const notes: string[] = []
  const lacks = (scope: string): boolean => {
    if (!missingScopes(st.scopes, [scope]).length) return false
    notes.push(`Немає дозволу на ${SCOPE_LABEL[scope]} — увійдіть в Etsy ще раз, щоб його надати.`)
    return true
  }
  const out: AccountSummary = {
    userId: st.userId ?? 0,
    email: null,
    firstName: null,
    lastName: null,
    avatarUrl: null,
    addresses: null,
    grantedScopes: null,
    shopId: st.shopId ?? null,
    shopName: st.shopName ?? null,
    notes
  }
  if (!lacks('email_r') && st.userId) {
    try {
      const u = await client.call<EtsyUser>(`/v3/application/users/${st.userId}`, { oauth: true })
      out.email = u.primary_email ?? null
      out.firstName = txt(u.first_name)
      out.lastName = txt(u.last_name)
      out.avatarUrl = u.image_url_75x75 && isEtsyCdnUrl(u.image_url_75x75) ? u.image_url_75x75 : null
    } catch (e) {
      notes.push(`Профіль: ${why(e)}`)
    }
  }
  if (!lacks('address_r')) {
    try {
      const page = await client.call<Paged<EtsyUserAddress>>('/v3/application/user/addresses', {
        oauth: true,
        query: { limit: 100 }
      })
      out.addresses = (page?.results ?? []).map(toAddress)
    } catch (e) {
      notes.push(`Адреси: ${why(e)}`)
    }
  }
  try {
    const token = await accessToken()
    if (token) {
      const r = await client.call<{ scopes?: unknown }>('/v3/application/scopes', { method: 'POST', form: { token } })
      out.grantedScopes = Array.isArray(r?.scopes) ? r.scopes.map(String) : null
    }
  } catch (e) {
    notes.push(`Дозволи: ${why(e)}`)
  }
  if (st.userId) {
    try {
      const shop = await client.call<EtsyShop>(`/v3/application/users/${st.userId}/shops`)
      out.shopId = shop?.shop_id ?? out.shopId
      out.shopName = shop?.shop_name ?? out.shopName
    } catch (e) {
      if (!(e instanceof EtsyApiError && e.kind === 'not_found')) notes.push(`Магазин: ${why(e)}`)
    }
  }
  return out
}

export const accountFeature: Feature = {
  id: 'account',
  actions: {
    summary: (_args, ctx) => accountSummary(ctx.client, ctx.authStatus, ctx.accessToken)
  },
  mcpTools: (deps) => [
    {
      name: 'get_my_account',
      title: 'My Etsy account',
      openWorld: true,
      description:
        "The user's own Etsy account (the one signed in via \"✏️ Мій магазин\"), read live from the Etsy API (up to 4 requests): first/last name and email (scope email_r), saved addresses (address_r: id, name, line1, line2, city, state, zip, country ISO code, default_shipping), permissions = the OAuth scopes Etsy says the token has (null if that check failed), and their Etsy shop (store_id, store_name). A part that couldn't be read is null and explained in notes (Ukrainian) — except store_id/store_name, which then keep the values saved at sign-in. Needs the sign-in; only for questions about the user themselves.",
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        try {
          mcpOwnShop(deps)
          const a = await accountSummary(deps.client!, deps.authStatus, deps.accessToken)
          return textResult({
            user_id: a.userId,
            first_name: a.firstName,
            last_name: a.lastName,
            email: a.email,
            addresses: a.addresses?.map((x) => ({
              id: x.id,
              name: x.name,
              line1: x.firstLine,
              line2: x.secondLine,
              city: x.city,
              state: x.state,
              zip: x.zip,
              country: x.countryIso,
              default_shipping: x.isDefaultShipping
            })) ?? null,
            permissions: a.grantedScopes,
            store_id: a.shopId,
            store_name: a.shopName,
            notes: a.notes
          })
        } catch (e) {
          return mcpFail(e)
        }
      }
    }
  ]
}
