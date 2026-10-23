import { describe, expect, it, vi } from 'vitest'
import {
  MCP_PROTOCOL_VERSIONS,
  type McpHandlerOptions,
  type McpTool,
  ToolInputError,
  checkArgs,
  handleMcpBody,
  handleMcpMessage,
  textResult
} from '../../src/main/mcpProtocol'

const add: McpTool = {
  name: 'add',
  title: 'Add',
  description: 'Adds two integers.',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'integer', minimum: 0, maximum: 100 },
      b: { type: 'integer' },
      mode: { type: 'string', enum: ['sum', 'diff'] }
    },
    required: ['a', 'b'],
    additionalProperties: false
  },
  run: (x) => textResult({ result: (x.a as number) + (x.mode === 'diff' ? -(x.b as number) : (x.b as number)) })
}

const boom: McpTool = {
  name: 'boom',
  title: 'Boom',
  description: 'Fails.',
  inputSchema: { type: 'object', properties: {} },
  run: () => {
    throw new Error('disk on fire')
  }
}

const opts = (over: Partial<McpHandlerOptions> = {}): McpHandlerOptions => ({
  info: { name: 'shop-catalog', title: 'Shop Catalog', version: '1.2.3', instructions: 'Read-only catalog.' },
  tools: [add, boom],
  ...over
})

const call = (method: string, params?: unknown, id: number | string = 1) => ({ jsonrpc: '2.0', id, method, params })

describe('initialize', () => {
  it('answers with the server info, instructions and the tools capability', async () => {
    const onInitialize = vi.fn()
    const res = await handleMcpMessage(
      opts({ onInitialize }),
      call('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-code', version: '2' }, capabilities: {} })
    )
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'shop-catalog', title: 'Shop Catalog', version: '1.2.3' },
        instructions: 'Read-only catalog.'
      }
    })
    expect(onInitialize).toHaveBeenCalledWith('claude-code')
  })

  it('echoes every supported version and answers an unknown one with the newest', async () => {
    for (const v of MCP_PROTOCOL_VERSIONS) {
      const res = await handleMcpMessage(opts(), call('initialize', { protocolVersion: v }))
      expect((res!.result as { protocolVersion: string }).protocolVersion).toBe(v)
    }
    const res = await handleMcpMessage(opts(), call('initialize', { protocolVersion: '1999-01-01' }))
    expect((res!.result as { protocolVersion: string }).protocolVersion).toBe(MCP_PROTOCOL_VERSIONS[0])
  })

  it('a client without clientInfo is reported as null', async () => {
    const onInitialize = vi.fn()
    await handleMcpMessage(opts({ onInitialize }), call('initialize', {}))
    expect(onInitialize).toHaveBeenCalledWith(null)
  })
})

describe('tools', () => {
  it('tools/list describes every tool as read-only', async () => {
    const res = await handleMcpMessage(opts(), call('tools/list'))
    const tools = (res!.result as { tools: Array<Record<string, unknown>> }).tools
    expect(tools.map((t) => t.name)).toEqual(['add', 'boom'])
    expect(tools[0]).toMatchObject({
      title: 'Add',
      description: 'Adds two integers.',
      inputSchema: add.inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    })
  })

  it('tools/call runs the tool with checked arguments', async () => {
    const res = await handleMcpMessage(opts(), call('tools/call', { name: 'add', arguments: { a: 2, b: 3 } }))
    expect(res!.result).toEqual({ content: [{ type: 'text', text: '{"result":5}' }] })
  })

  it('an unknown tool is a JSON-RPC invalid-params error', async () => {
    const res = await handleMcpMessage(opts(), call('tools/call', { name: 'nope', arguments: {} }))
    expect(res!.error).toEqual({ code: -32602, message: 'Unknown tool: nope' })
  })

  it('bad arguments come back as a tool error the model can read', async () => {
    const cases: Array<[unknown, string]> = [
      [{ a: 1 }, 'Missing required argument "b".'],
      [{ a: 1, b: 2, c: 3 }, 'Unknown argument "c".'],
      [{ a: '1', b: 2 }, 'Argument "a" must be of type integer.'],
      [{ a: 1.5, b: 2 }, 'Argument "a" must be of type integer.'],
      [{ a: 101, b: 2 }, 'Argument "a" must be ≤ 100.'],
      [{ a: -1, b: 2 }, 'Argument "a" must be ≥ 0.'],
      [{ a: 1, b: 2, mode: 'x' }, 'Argument "mode" must be one of: sum, diff.'],
      ['text', 'Arguments must be an object.']
    ]
    for (const [args, msg] of cases) {
      const res = await handleMcpMessage(opts(), call('tools/call', { name: 'add', arguments: args }))
      expect(res!.result).toEqual({ content: [{ type: 'text', text: msg }], isError: true })
    }
  })

  it('a tool that throws is a tool error, not a crash', async () => {
    const res = await handleMcpMessage(opts(), call('tools/call', { name: 'boom' }))
    expect(res!.result).toEqual({ content: [{ type: 'text', text: 'The tool failed: disk on fire' }], isError: true })
  })

  it('a ToolInputError thrown by the tool reads as its message', async () => {
    const t: McpTool = { ...boom, name: 'picky', run: () => { throw new ToolInputError('No store with id 7.') } }
    const res = await handleMcpMessage(opts({ tools: [t] }), call('tools/call', { name: 'picky' }))
    expect(res!.result).toEqual({ content: [{ type: 'text', text: 'No store with id 7.' }], isError: true })
  })
})

describe('checkArgs', () => {
  it('null/undefined arguments are an empty object; null values are "not given"', () => {
    expect(checkArgs({ type: 'object', properties: {} }, undefined)).toEqual({})
    expect(checkArgs({ type: 'object', properties: { a: { type: 'integer' } } }, { a: null })).toEqual({ a: null })
  })

  it('string length limits', () => {
    const s = { type: 'object' as const, properties: { q: { type: 'string' as const, minLength: 2, maxLength: 3 } } }
    expect(() => checkArgs(s, { q: 'a' })).toThrow('at least 2')
    expect(() => checkArgs(s, { q: 'abcd' })).toThrow('at most 3')
    expect(checkArgs(s, { q: 'abc' })).toEqual({ q: 'abc' })
  })
})

describe('JSON-RPC plumbing', () => {
  it('ping answers an empty result', async () => {
    expect(await handleMcpMessage(opts(), call('ping', undefined, 'x'))).toEqual({ jsonrpc: '2.0', id: 'x', result: {} })
  })

  it('an unknown method is -32601', async () => {
    const res = await handleMcpMessage(opts(), call('resources/list'))
    expect(res!.error!.code).toBe(-32601)
  })

  it('notifications and client responses get no answer', async () => {
    expect(await handleMcpMessage(opts(), { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect(await handleMcpMessage(opts(), { jsonrpc: '2.0', id: 4, result: {} })).toBeNull()
  })

  it('anything that is not JSON-RPC 2.0 is -32600', async () => {
    for (const bad of [null, 42, 'x', { id: 1, method: 'ping' }, { jsonrpc: '2.0', id: 1 }]) {
      const res = await handleMcpMessage(opts(), bad)
      expect(res!.error!.code).toBe(-32600)
    }
  })

  it('a batch answers every request in order, skipping notifications', async () => {
    const res = await handleMcpBody(opts(), [
      call('ping', undefined, 1),
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      call('tools/call', { name: 'add', arguments: { a: 1, b: 1 } }, 2)
    ])
    expect((res as Array<{ id: number }>).map((r) => r.id)).toEqual([1, 2])
    expect(await handleMcpBody(opts(), [{ jsonrpc: '2.0', method: 'notifications/initialized' }])).toBeNull()
    expect(((await handleMcpBody(opts(), [])) as { error: { code: number } }).error.code).toBe(-32600)
  })
})
