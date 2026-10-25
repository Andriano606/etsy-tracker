import { describe, expect, it } from 'vitest'
import {
  MCP_DEFAULT_PORT,
  MCP_OLD_SERVER_NAMES,
  MCP_SERVER_NAME,
  MCP_TOOL_SUMMARY,
  claudeCodeCommand,
  claudeCodeReplaceCommand,
  claudeDesktopConfig,
  mcpJsonConfig,
  mcpUrl,
  validateMcpPort
} from '../../src/shared/mcpConfig'

const TOKEN = 'AbC_12-xyz'

describe('MCP client configs', () => {
  it('the server is named after the app, remembers its old name, and has a local URL', () => {
    expect(MCP_SERVER_NAME).toBe('etsy-tracker')
    expect(MCP_OLD_SERVER_NAMES).toEqual(['shop-catalog'])
    expect(mcpUrl(MCP_DEFAULT_PORT)).toBe('http://127.0.0.1:9102/mcp')
  })

  it('Claude Code: user scope, HTTP transport, the header last (it takes several values)', () => {
    expect(claudeCodeCommand(9102, TOKEN)).toBe(
      'claude mcp add --transport http --scope user etsy-tracker http://127.0.0.1:9102/mcp --header "Authorization: Bearer AbC_12-xyz"'
    )
  })

  it('the replace variant removes the current and the old (shop-catalog) entry first, ignoring "not found"', () => {
    expect(claudeCodeReplaceCommand(9200, TOKEN)).toBe(
      'claude mcp remove --scope user etsy-tracker 2>/dev/null; ' +
        'claude mcp remove --scope user shop-catalog 2>/dev/null; ' +
        claudeCodeCommand(9200, TOKEN)
    )
  })

  it('.mcp.json: an HTTP server with the bearer header', () => {
    expect(JSON.parse(mcpJsonConfig(9102, TOKEN))).toEqual({
      mcpServers: {
        'etsy-tracker': {
          type: 'http',
          url: 'http://127.0.0.1:9102/mcp',
          headers: { Authorization: 'Bearer AbC_12-xyz' }
        }
      }
    })
  })

  it('Claude Desktop: stdio through mcp-remote with the header', () => {
    expect(JSON.parse(claudeDesktopConfig(9102, TOKEN))).toEqual({
      mcpServers: {
        'etsy-tracker': {
          command: 'npx',
          args: ['-y', 'mcp-remote', 'http://127.0.0.1:9102/mcp', '--header', 'Authorization: Bearer AbC_12-xyz']
        }
      }
    })
  })
})

describe('validateMcpPort', () => {
  it('accepts unprivileged ports as numbers or trimmed strings', () => {
    expect(validateMcpPort(9102)).toBe(9102)
    expect(validateMcpPort(' 1024 ')).toBe(1024)
    expect(validateMcpPort('65535')).toBe(65535)
  })

  it('refuses everything else', () => {
    for (const bad of [1023, 65536, 0, -5, 9102.5, '91o2', '', '  ', null, undefined, {}, NaN]) {
      expect(() => validateMcpPort(bad)).toThrow('Порт — ціле число від 1024 до 65535.')
    }
  })
})

describe('MCP_TOOL_SUMMARY', () => {
  const text = (name: string) => MCP_TOOL_SUMMARY.find((t) => t.name === name)!.text

  it('get_store / get_product give review counts and averages, not review texts (those are list_reviews)', () => {
    expect(text('get_store')).toContain('кількість і середня оцінка збережених відгуків')
    expect(text('get_product')).toContain('кількість і середня оцінка відгуків')
    expect(text('get_product_history')).toContain('кількість відгуків')
    expect(text('list_reviews')).toContain('збережені відгуки')
  })
})

describe('MCP_TOOL_SUMMARY: drafts in the app', () => {
  const entry = (name: string) => MCP_TOOL_SUMMARY.find((t) => t.name === name)!

  it('lists the draft tools in the server’s order; only sending is a store write', () => {
    const names = MCP_TOOL_SUMMARY.map((t) => t.name).filter((n) => n.endsWith('_prepared_product') || n.endsWith('_prepared_products') || n === 'prepare_product')
    expect(names).toEqual([
      'prepare_product',
      'list_prepared_products',
      'sync_prepared_products',
      'unlink_prepared_product',
      'delete_prepared_product',
      'send_prepared_product'
    ])
    expect(names.filter((n) => entry(n).write)).toEqual(['send_prepared_product'])
  })

  it('says what reaches Etsy: editing a sent draft changes Etsy only on sending; deleting on Etsy needs the permission', () => {
    expect(entry('prepare_product').text).toContain('зміниться лише після надсилання')
    expect(entry('send_prepared_product').text).toContain('оновлення вже надісланого')
    expect(entry('sync_prepared_products').text).toContain('на Etsy нічого не змінює')
    expect(entry('unlink_prepared_product').text).toContain('лише в програмі')
    expect(entry('delete_prepared_product').text).toContain('лише це потребує дозволу на зміни')
  })
})
