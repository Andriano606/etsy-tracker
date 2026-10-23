// Feature "account": who is signed in — the Etsy user (name, email), their
// addresses, the permissions (scopes) the sign-in really has, and their shop.

export interface AccountAddress {
  id: number
  name: string | null
  firstLine: string | null
  secondLine: string | null
  city: string | null
  state: string | null
  zip: string | null
  countryIso: string | null
  countryName: string | null
  isDefaultShipping: boolean
}

export interface AccountSummary {
  userId: number
  /** null = the sign-in has no email_r (sign in again) or Etsy refused. */
  email: string | null
  firstName: string | null
  lastName: string | null
  /** The user's avatar on the Etsy CDN (validated), or null. */
  avatarUrl: string | null
  /** null = no address_r. */
  addresses: AccountAddress[] | null
  /** What Etsy says the current token may do (tokenScopes); null = couldn't ask. */
  grantedScopes: string[] | null
  shopId: number | null
  shopName: string | null
  /** Parts that couldn't be read, in Ukrainian (e.g. a missing permission). */
  notes: string[]
}

/** The MCP tools of this feature, in Ukrainian for the MCP modal. */
export const ACCOUNT_TOOL_SUMMARY = [{ name: 'get_my_account', text: 'мій акаунт: ім’я, email, адреси, видані дозволи' }]
