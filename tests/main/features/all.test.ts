import { describe, expect, it } from 'vitest'
import { createMcpTools } from '../../../src/main/mcpTools'
import { handleMcpMessage } from '../../../src/main/mcpProtocol'
import { mcpServerInfo } from '../../../src/main/mcpTools'
import { FEATURES, featureMcpTools } from '../../../src/main/features'
import { MCP_TOOL_SUMMARY } from '../../../src/shared/mcpConfig'
import { memDb } from '../../helpers/db'
import { mcpDeps, routedFetch, signedIn, testClient } from '../../helpers/features'

/** The OAuth access token the tools run with — it must never reach a client. */
const TOKEN = 'oauth-tok-9f8e7d6c'

/** Every MCP tool the app serves, signed in with changes allowed, over a routed fake Etsy. */
function allTools(routes: Parameters<typeof routedFetch>[0] = {}) {
  const client = testClient(routedFetch(routes), TOKEN)
  return createMcpTools({
    db: memDb(),
    own: { client, status: () => signedIn(), writesAllowed: () => true, taxonomy: async () => [], accessToken: async () => TOKEN }
  })
}

/** What no client may ever get: Etsy CDN URLs, raw API objects, the token or the API key. */
function expectNothingSecret(text: string) {
  expect(text).not.toMatch(/etsystatic\.com/i)
  expect(text).not.toMatch(/"raw_json"\s*:/)
  expect(text).not.toContain(TOKEN)
  expect(text).not.toContain('keystring:secret')
}

/** Names of every property of a JSON schema, nested ones included. */
function schemaKeys(schema: unknown, out: string[] = []): string[] {
  if (Array.isArray(schema)) for (const s of schema) schemaKeys(s, out)
  else if (schema && typeof schema === 'object') {
    const o = schema as Record<string, unknown>
    if (o.properties && typeof o.properties === 'object') out.push(...Object.keys(o.properties))
    for (const v of Object.values(o)) schemaKeys(v, out)
  }
  return out
}

describe('all features together', () => {
  it('tool names are unique and match the MCP modal’s list (name, order, write flag)', () => {
    const tools = allTools()
    const names = tools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(MCP_TOOL_SUMMARY.map((s) => s.name))
    const writeInSummary = Object.fromEntries(MCP_TOOL_SUMMARY.map((s) => [s.name, !!s.write]))
    // Drafts kept in the app (prepare/delete) change only the app — not marked as store writes.
    const appOnly = new Set(['prepare_product', 'delete_prepared_product'])
    for (const t of tools) {
      if (appOnly.has(t.name)) continue
      expect({ name: t.name, write: t.readOnly === false }).toEqual({ name: t.name, write: writeInSummary[t.name] })
    }
  })

  it('the server introduces itself as Etsy Tracker', async () => {
    const res = await handleMcpMessage(
      { info: mcpServerInfo('1'), tools: allTools() },
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }
    )
    const info = (res?.result as { serverInfo: { name: string; title: string } }).serverInfo
    expect(info).toMatchObject({ name: 'etsy-tracker', title: 'Etsy Tracker' })
    expectNothingSecret(JSON.stringify(res))
  })

  it('the tool list says it is Etsy and carries no CDN URL, raw-object field or secret', async () => {
    const tools = allTools()
    const res = await handleMcpMessage({ info: mcpServerInfo('1'), tools }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const text = JSON.stringify(res)
    expect(text).toMatch(/Etsy/)
    expectNothingSecret(text)
    for (const t of tools) expect({ tool: t.name, keys: schemaKeys(t.inputSchema) }).toEqual({
      tool: t.name,
      keys: expect.not.arrayContaining(['raw_json'])
    })
  })

  it('text from Etsy reaches the client unchanged (the word Etsy and etsy.com links included)', async () => {
    const title = 'Etsy picks: see https://www.etsy.com/shop/TidyFoxSheets?section_id=7 & etsy.me/abc'
    const tools = allTools({
      'GET /v3/application/shops/{id}/sections': {
        body: { count: 1, results: [{ shop_section_id: 7, title, rank: 1, user_id: 1, active_listing_count: 3 }] }
      }
    })
    const res = await handleMcpMessage(
      { info: mcpServerInfo('1'), tools },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_store_sections', arguments: { store_id: 42 } } }
    )
    const result = res?.result as { isError?: boolean; content: Array<{ type: string; text: string }> }
    expect(result.isError).toBeFalsy()
    const json = JSON.parse(result.content[0].text)
    expect(json.sections).toEqual([expect.objectContaining({ section_id: 7, title, position: 1, active_product_count: 3 })])
    expectNothingSecret(result.content[0].text)
  })

  it('every feature tool calls the Etsy API live → tools/list says openWorldHint: true', async () => {
    const featureNames = new Set(featureMcpTools(mcpDeps({}).deps).map((t) => t.name))
    expect(featureNames.size).toBeGreaterThan(70)
    const res = await handleMcpMessage({ info: mcpServerInfo('1'), tools: allTools() }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const listed = (res?.result as { tools: Array<{ name: string; annotations: Record<string, boolean> }> }).tools
    const hints = listed.filter((t) => featureNames.has(t.name)).map((t) => ({ name: t.name, openWorldHint: t.annotations.openWorldHint }))
    expect(hints).toHaveLength(featureNames.size)
    expect(hints).toEqual([...featureNames].map((name) => ({ name, openWorldHint: true })))
    // the hint is independent of read/write: live reads are open-world too
    const readOnly = listed.filter((t) => featureNames.has(t.name) && t.annotations.readOnlyHint)
    expect(readOnly.length).toBeGreaterThan(0)
  })

  it('every input schema is closed and its required fields exist', () => {
    for (const t of allTools()) {
      expect({ tool: t.name, closed: t.inputSchema.additionalProperties }).toEqual({ tool: t.name, closed: false })
      for (const r of t.inputSchema.required ?? []) expect(t.inputSchema.properties).toHaveProperty(r)
    }
  })

  it('feature ids are unique and every action name is unique within its feature', () => {
    const ids = FEATURES.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['market', 'compete', 'inventory', 'media', 'listingMeta', 'shopConfig', 'orders', 'account'])
    for (const f of FEATURES) expect(Object.keys(f.actions).length).toBeGreaterThan(0)
  })
})
