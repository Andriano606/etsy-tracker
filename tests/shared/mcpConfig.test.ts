import { describe, expect, it } from 'vitest'
import {
  MCP_DEFAULT_PORT,
  MCP_SERVER_NAME,
  claudeCodeCommand,
  claudeCodeReplaceCommand,
  claudeDesktopConfig,
  mcpJsonConfig,
  mcpUrl,
  validateMcpPort
} from '../../src/shared/mcpConfig'

const TOKEN = 'AbC_12-xyz'

describe('MCP client configs', () => {
  it('the server has a neutral name and a local URL', () => {
    expect(MCP_SERVER_NAME).toBe('shop-catalog')
    expect(MCP_SERVER_NAME).not.toMatch(/etsy/i)
    expect(mcpUrl(MCP_DEFAULT_PORT)).toBe('http://127.0.0.1:9102/mcp')
  })

  it('Claude Code: user scope, HTTP transport, the header last (it takes several values)', () => {
    expect(claudeCodeCommand(9102, TOKEN)).toBe(
      'claude mcp add --transport http --scope user shop-catalog http://127.0.0.1:9102/mcp --header "Authorization: Bearer AbC_12-xyz"'
    )
  })

  it('the replace variant removes the old entry first and ignores "not found"', () => {
    expect(claudeCodeReplaceCommand(9200, TOKEN)).toBe(
      `claude mcp remove --scope user shop-catalog 2>/dev/null; ${claudeCodeCommand(9200, TOKEN)}`
    )
  })

  it('.mcp.json: an HTTP server with the bearer header', () => {
    expect(JSON.parse(mcpJsonConfig(9102, TOKEN))).toEqual({
      mcpServers: {
        'shop-catalog': {
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
        'shop-catalog': {
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
