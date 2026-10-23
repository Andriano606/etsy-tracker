import { describe, expect, it } from 'vitest'
import { createMcpTools } from '../../../src/main/mcpTools'
import { handleMcpMessage } from '../../../src/main/mcpProtocol'
import { mcpServerInfo } from '../../../src/main/mcpTools'
import { FEATURES } from '../../../src/main/features'
import { MCP_TOOL_SUMMARY } from '../../../src/shared/mcpConfig'
import { memDb } from '../../helpers/db'
import { routedFetch, signedIn, testClient } from '../../helpers/features'

/** Every MCP tool the app serves, signed in with changes allowed. */
function allTools() {
  const client = testClient(routedFetch({}))
  return createMcpTools({
    db: memDb(),
    own: { client, status: () => signedIn(), writesAllowed: () => true, taxonomy: async () => [], accessToken: async () => 'tok' }
  })
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

  it('no tool (name, title, description, schema) names the marketplace or carries a URL', async () => {
    const tools = allTools()
    const res = await handleMcpMessage({ info: mcpServerInfo('1'), tools }, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const text = JSON.stringify(res)
    expect(text).not.toMatch(/etsy/i)
    expect(text).not.toMatch(/https?:\/\//)
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
