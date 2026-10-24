import { describe, expect, it } from 'vitest'
import { accountFeature } from '../../../src/main/features/account'
import { OWN_SHOP, OWN_USER, callTool, featureCtx, mcpDeps, runAction, signedIn, signedOut } from '../../helpers/features'

const routes = {
  [`GET /v3/application/users/${OWN_USER}`]: {
    body: { user_id: OWN_USER, primary_email: 'me@example.com', first_name: 'Andrii', last_name: 'K', image_url_75x75: 'https://i.etsystatic.com/u.jpg' }
  },
  'GET /v3/application/user/addresses': {
    body: { count: 1, results: [{ user_address_id: 9, name: 'Andrii', first_line: 'Main st 1', city: 'Lviv', iso_country_code: 'UA', country_name: 'Ukraine', is_default_shipping_address: true }] }
  },
  'POST /v3/application/scopes': { body: { scopes: ['listings_r', 'email_r'] } },
  [`GET /v3/application/users/${OWN_USER}/shops`]: { body: { shop_id: OWN_SHOP, shop_name: 'TidyFoxSheets' } }
}

describe('account feature', () => {
  it('summary: user, addresses, granted scopes and shop — each from its endpoint', async () => {
    const { ctx, fetch } = featureCtx(routes)
    const a = await runAction(accountFeature, 'summary', {}, ctx)
    expect(a).toEqual({
      userId: OWN_USER,
      email: 'me@example.com',
      firstName: 'Andrii',
      lastName: 'K',
      avatarUrl: 'https://i.etsystatic.com/u.jpg',
      addresses: [
        { id: 9, name: 'Andrii', firstLine: 'Main st 1', secondLine: null, city: 'Lviv', state: null, zip: null, countryIso: 'UA', countryName: 'Ukraine', isDefaultShipping: true }
      ],
      grantedScopes: ['listings_r', 'email_r'],
      shopId: OWN_SHOP,
      shopName: 'TidyFoxSheets',
      notes: []
    })
    const scopes = fetch.calls.find((c) => c.url.pathname === '/v3/application/scopes')!
    expect(scopes.method).toBe('POST')
    expect(scopes.body).toBe('token=tok')
    expect(fetch.calls.find((c) => c.url.pathname === `/v3/application/users/${OWN_USER}`)!.headers.authorization).toBe('Bearer tok')
  })

  it('a sign-in without email_r / address_r: those parts are null with a note, no request made', async () => {
    const { ctx, fetch } = featureCtx(routes, { status: signedIn({ scopes: ['listings_r', 'shops_r'] }) })
    const a = (await runAction(accountFeature, 'summary', {}, ctx)) as { email: unknown; addresses: unknown; notes: string[] }
    expect(a.email).toBeNull()
    expect(a.addresses).toBeNull()
    expect(a.notes.join(' ')).toContain('email акаунта')
    expect(a.notes.join(' ')).toContain('адреси акаунта')
    expect(fetch.calls.some((c) => c.url.pathname === '/v3/application/user/addresses')).toBe(false)
  })

  it('a failing part becomes a note; the rest still answers', async () => {
    const { ctx } = featureCtx({ ...routes, 'GET /v3/application/user/addresses': { status: 500 } })
    const a = (await runAction(accountFeature, 'summary', {}, ctx)) as { addresses: unknown; notes: string[]; email: string }
    expect(a.addresses).toBeNull()
    expect(a.notes[0]).toMatch(/^Адреси: /)
    expect(a.email).toBe('me@example.com')
  })

  it('signed out: the sign-in error', async () => {
    const { ctx } = featureCtx(routes, { status: signedOut })
    await expect(runAction(accountFeature, 'summary', {}, ctx)).rejects.toThrow('Увійдіть в Etsy')
  })

  it('MCP get_my_account: the account as Etsy sent it; no avatar CDN URL or token; signed out → the Etsy sign-in note', async () => {
    const { deps } = mcpDeps({
      ...routes,
      'GET /v3/application/user/addresses': {
        body: { count: 1, results: [{ user_address_id: 9, name: 'Etsy Andrii', first_line: 'Main st 1 (see https://www.etsy.com/x)', city: 'Lviv', iso_country_code: 'UA', is_default_shipping_address: true }] }
      }
    })
    const r = await callTool(accountFeature, deps, 'get_my_account')
    expect(r.isError).toBe(false)
    expect(r.json).toEqual({
      user_id: OWN_USER,
      first_name: 'Andrii',
      last_name: 'K',
      email: 'me@example.com',
      addresses: [
        { id: 9, name: 'Etsy Andrii', line1: 'Main st 1 (see https://www.etsy.com/x)', line2: null, city: 'Lviv', state: null, zip: null, country: 'UA', default_shipping: true }
      ],
      permissions: ['listings_r', 'email_r'],
      store_id: OWN_SHOP,
      store_name: 'TidyFoxSheets',
      notes: []
    })
    expect(r.text).not.toMatch(/etsystatic\.com/i)
    expect(r.text).not.toContain('raw_json')
    expect(r.text).not.toContain('"tok"')
    expect(r.text).not.toContain('keystring')
    const tool = accountFeature.mcpTools!(deps)[0]
    expect(tool.description).toContain('Etsy account')
    expect(tool.description).toContain('live from the Etsy API')
    expect(tool.description).toMatch(/email_r[\s\S]*address_r/)
    const out = await callTool(accountFeature, mcpDeps(routes, { status: signedOut }).deps, 'get_my_account')
    expect(out.isError).toBe(true)
    expect(out.text).toContain('has not signed in to their own Etsy shop')
  })

  it('MCP get_my_account: a part that could not be read is null with a note', async () => {
    const { deps } = mcpDeps(routes, { status: signedIn({ scopes: ['shops_r'] }) })
    const r = await callTool(accountFeature, deps, 'get_my_account')
    expect(r.isError).toBe(false)
    expect(r.json).toMatchObject({ email: null, first_name: null, addresses: null, store_id: OWN_SHOP })
    expect(r.json.notes.join(' ')).toContain('email акаунта')
  })
})
