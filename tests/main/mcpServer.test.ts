import { afterEach, describe, expect, it } from 'vitest'
import { request, createServer } from 'http'
import type { AddressInfo } from 'net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { MCP_MAX_BODY, createMcpHttpServer, createMcpService, type McpHttpServer } from '../../src/main/mcpServer'
import { type McpTool, handleMcpBody, textResult } from '../../src/main/mcpProtocol'
import type { McpConfig } from '../../src/main/settings'

const TOKEN = 'tok_test-123'

const echo: McpTool = {
  name: 'echo',
  title: 'Echo',
  description: 'Echoes its text.',
  inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  run: (a) => textResult({ said: a.text })
}

const handler = (onInitialize?: (c: string | null) => void) => (body: unknown) =>
  handleMcpBody({ info: { name: 'etsy-tracker', title: 'Etsy Tracker', version: '0.1.0', instructions: 'Hi.' }, tools: [echo], onInitialize }, body)

interface Raw {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** A request with full control over headers (fetch can't set Host). */
function raw(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Buffer } = {}
): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: opts.method ?? 'POST', path: opts.path ?? '/mcp', headers: opts.headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }))
      }
    )
    req.on('error', reject)
    if (opts.body != null) req.write(opts.body)
    req.end()
  })
}

const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
const rpc = (method: string, params: unknown = {}, id: number | null = 1) =>
  JSON.stringify(id == null ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params })

let servers: McpHttpServer[] = []
afterEach(async () => {
  await Promise.all(servers.map((s) => s.stop()))
  servers = []
})

async function started(onRequest?: () => void): Promise<{ port: number; server: McpHttpServer }> {
  const server = createMcpHttpServer({ getToken: () => TOKEN, handle: handler(), onRequest })
  servers.push(server)
  await server.start(0)
  return { port: server.port()!, server }
}

describe('MCP HTTP server guards', () => {
  it('answers a JSON-RPC POST with JSON', async () => {
    const { port } = await started()
    const res = await raw(port, { headers: auth, body: rpc('tools/list') })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^application\/json/)
    expect(JSON.parse(res.body).result.tools.map((t: { name: string }) => t.name)).toEqual(['echo'])
  })

  it('listens on 127.0.0.1 only', async () => {
    const { server } = await started()
    expect(server.port()).toBeGreaterThan(0)
    const res = await raw(server.port()!, { headers: { ...auth, host: `localhost:${server.port()}` }, body: rpc('ping') })
    expect(res.status).toBe(200)
  })

  it('refuses a missing or wrong token with 401', async () => {
    const { port } = await started()
    const none = await raw(port, { headers: { 'content-type': 'application/json' }, body: rpc('ping') })
    expect(none.status).toBe(401)
    expect(none.headers['www-authenticate']).toBe('Bearer')
    const wrong = await raw(port, { headers: { ...auth, authorization: 'Bearer tok_test-124' }, body: rpc('ping') })
    expect(wrong.status).toBe(401)
    const shorter = await raw(port, { headers: { ...auth, authorization: 'Bearer tok' }, body: rpc('ping') })
    expect(shorter.status).toBe(401)
    const basic = await raw(port, { headers: { ...auth, authorization: `Basic ${TOKEN}` }, body: rpc('ping') })
    expect(basic.status).toBe(401)
  })

  it('refuses everyone while there is no token', async () => {
    const server = createMcpHttpServer({ getToken: () => null, handle: handler() })
    servers.push(server)
    await server.start(0)
    const res = await raw(server.port()!, { headers: { ...auth, authorization: 'Bearer ' }, body: rpc('ping') })
    expect(res.status).toBe(401)
  })

  it('refuses a foreign Host (DNS rebinding) and a foreign Origin (a web page) with 403', async () => {
    const { port } = await started()
    const host = await raw(port, { headers: { ...auth, host: `evil.example:${port}` }, body: rpc('ping') })
    expect(host.status).toBe(403)
    const otherPort = await raw(port, { headers: { ...auth, host: `127.0.0.1:${port + 1}` }, body: rpc('ping') })
    expect(otherPort.status).toBe(403)
    const origin = await raw(port, { headers: { ...auth, origin: 'https://evil.example' }, body: rpc('ping') })
    expect(origin.status).toBe(403)
    const local = await raw(port, { headers: { ...auth, origin: `http://localhost:${port}` }, body: rpc('ping') })
    expect(local.status).toBe(200)
  })

  it('only /mcp, only POST, only JSON', async () => {
    const { port } = await started()
    expect((await raw(port, { path: '/', headers: auth, body: rpc('ping') })).status).toBe(404)
    expect((await raw(port, { path: '/mcp/x', headers: auth, body: rpc('ping') })).status).toBe(404)
    const get = await raw(port, { method: 'GET', headers: auth })
    expect(get.status).toBe(405)
    expect(get.headers.allow).toBe('POST')
    expect((await raw(port, { method: 'DELETE', headers: auth })).status).toBe(405)
    const text = await raw(port, { headers: { ...auth, 'content-type': 'text/plain' }, body: rpc('ping') })
    expect(text.status).toBe(415)
  })

  it('refuses a body over 1 MB with 413 and bad JSON with a JSON-RPC parse error', async () => {
    const { port } = await started()
    const big = await raw(port, { headers: auth, body: Buffer.alloc(MCP_MAX_BODY + 1, 32) })
    expect(big.status).toBe(413)
    const bad = await raw(port, { headers: auth, body: '{nope' })
    expect(bad.status).toBe(400)
    expect(JSON.parse(bad.body).error.code).toBe(-32700)
  })

  it('a notification gets 202 with no body', async () => {
    const { port } = await started()
    const res = await raw(port, { headers: auth, body: rpc('notifications/initialized', {}, null) })
    expect(res.status).toBe(202)
    expect(res.body).toBe('')
  })

  it('counts only authorized requests', async () => {
    let n = 0
    const { port } = await started(() => n++)
    await raw(port, { headers: { 'content-type': 'application/json' }, body: rpc('ping') })
    await raw(port, { headers: auth, body: rpc('ping') })
    expect(n).toBe(1)
  })

  it('a busy port fails with a Ukrainian message', async () => {
    const blocker = createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
    const port = (blocker.address() as AddressInfo).port
    const server = createMcpHttpServer({ getToken: () => TOKEN, handle: handler() })
    try {
      await expect(server.start(port)).rejects.toThrow(`Порт ${port} уже зайнятий`)
      expect(server.port()).toBeNull()
    } finally {
      await new Promise((r) => blocker.close(r))
    }
  })

  it('stop() closes the port (a restart can take it again)', async () => {
    const { port, server } = await started()
    await server.stop()
    expect(server.port()).toBeNull()
    await expect(raw(port, { headers: auth, body: rpc('ping') })).rejects.toThrow()
    await server.start(port)
    expect((await raw(port, { headers: auth, body: rpc('ping') })).status).toBe(200)
  })
})

describe('the official MCP SDK client', () => {
  it('connects, lists and calls tools against our server (Streamable HTTP, JSON responses)', async () => {
    let clientName: string | null = null
    const server = createMcpHttpServer({ getToken: () => TOKEN, handle: handler((c) => (clientName = c)) })
    servers.push(server)
    await server.start(0)
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port()}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } }
    })
    const client = new Client({ name: 'sdk-test-client', version: '1.0.0' })
    await client.connect(transport)
    try {
      expect(client.getServerVersion()).toMatchObject({ name: 'etsy-tracker', title: 'Etsy Tracker', version: '0.1.0' })
      expect(client.getInstructions()).toBe('Hi.')
      expect(clientName).toBe('sdk-test-client')
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name)).toEqual(['echo'])
      expect(tools[0].annotations?.readOnlyHint).toBe(true)
      const res = await client.callTool({ name: 'echo', arguments: { text: 'привіт' } })
      expect(res.content).toEqual([{ type: 'text', text: JSON.stringify({ said: 'привіт' }) }])
      const bad = await client.callTool({ name: 'echo', arguments: {} })
      expect(bad.isError).toBe(true)
      await expect(client.ping()).resolves.toBeDefined()
    } finally {
      await client.close()
    }
  })

  it('a client with a wrong token cannot connect', async () => {
    const server = createMcpHttpServer({ getToken: () => TOKEN, handle: handler() })
    servers.push(server)
    await server.start(0)
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port()}/mcp`), {
      requestInit: { headers: { Authorization: 'Bearer wrong' } }
    })
    const client = new Client({ name: 'x', version: '1' })
    await expect(client.connect(transport)).rejects.toThrow()
  })
})

describe('createMcpService (the server as the settings say)', () => {
  function service(cfg: Partial<McpConfig> = {}) {
    const state: McpConfig = { enabled: false, port: 0, token: null, tokenEncrypted: false, ...cfg }
    let tokens = 0
    const svc = createMcpService({
      getConfig: () => state,
      ensureToken: () => {
        tokens++
        state.token = `tok_${tokens}`
        return state.token
      },
      handle: handler(),
      now: () => 1_700_000_000_000
    })
    return { svc, state, tokens: () => tokens }
  }

  async function freePort(): Promise<number> {
    const s = createServer()
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
    const port = (s.address() as AddressInfo).port
    await new Promise((r) => s.close(r))
    return port
  }

  it('disabled: not running, no error, no token made', async () => {
    const { svc, tokens } = service()
    const st = await svc.apply()
    expect(st).toMatchObject({ enabled: false, running: false, error: null, token: null })
    expect(tokens()).toBe(0)
  })

  it('enabling starts it on the saved port and makes a token once', async () => {
    const port = await freePort()
    const { svc, state, tokens } = service({ enabled: true, port })
    const st = await svc.apply()
    try {
      expect(st).toMatchObject({ enabled: true, running: true, error: null, port, url: `http://127.0.0.1:${port}/mcp` })
      expect(st.token).toBe('tok_1')
      await svc.apply()
      expect(tokens()).toBe(1)
      const res = await raw(port, { headers: { ...auth, authorization: `Bearer ${state.token}` }, body: rpc('ping') })
      expect(res.status).toBe(200)
      expect(svc.status()).toMatchObject({ requests: 1, lastRequestAt: 1_700_000_000_000 })
      svc.noteClient('claude-code')
      expect(svc.status().lastClient).toBe('claude-code')
    } finally {
      await svc.stop()
    }
  })

  it('a port change moves it; disabling stops it', async () => {
    const [p1, p2] = [await freePort(), await freePort()]
    const { svc, state } = service({ enabled: true, port: p1 })
    await svc.apply()
    state.port = p2
    expect(await svc.apply()).toMatchObject({ running: true, port: p2 })
    await expect(raw(p1, { headers: auth, body: rpc('ping') })).rejects.toThrow()
    state.enabled = false
    expect(await svc.apply()).toMatchObject({ running: false, error: null })
    await expect(raw(p2, { headers: auth, body: rpc('ping') })).rejects.toThrow()
  })

  it('a busy port is reported in status().error (never thrown) and retried on the next apply', async () => {
    const blocker = createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
    const port = (blocker.address() as AddressInfo).port
    const { svc } = service({ enabled: true, port })
    const st = await svc.apply()
    expect(st.running).toBe(false)
    expect(st.error).toContain(`Порт ${port} уже зайнятий`)
    await new Promise((r) => blocker.close(r))
    try {
      expect(await svc.apply()).toMatchObject({ running: true, error: null })
    } finally {
      await svc.stop()
    }
  })

  it('a token changed in the settings applies to the next request without a restart', async () => {
    const port = await freePort()
    const { svc, state } = service({ enabled: true, port, token: 'old' })
    await svc.apply()
    try {
      state.token = 'new'
      const old = await raw(port, { headers: { ...auth, authorization: 'Bearer old' }, body: rpc('ping') })
      expect(old.status).toBe(401)
      const fresh = await raw(port, { headers: { ...auth, authorization: 'Bearer new' }, body: rpc('ping') })
      expect(fresh.status).toBe(200)
    } finally {
      await svc.stop()
    }
  })

  it('concurrent applies do not race two listens', async () => {
    const port = await freePort()
    const { svc } = service({ enabled: true, port })
    const [a, b] = await Promise.all([svc.apply(), svc.apply()])
    try {
      expect(a.error ?? b.error).toBeNull()
      expect(svc.status().running).toBe(true)
    } finally {
      await svc.stop()
    }
  })
})
