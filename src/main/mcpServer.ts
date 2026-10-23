// The local MCP server: Streamable HTTP (JSON responses, no SSE stream) on
// 127.0.0.1 only, behind a bearer token (Settings → MCP). Read-only tools over
// the app's database (mcpTools.ts). Off by default; it runs only while the app
// runs.
//
// Guards, in order: path `/mcp` (404), Host = 127.0.0.1/localhost:{port} and no
// foreign Origin (403 — DNS rebinding / a web page in the user's browser),
// bearer token (401), POST only (405), JSON content type (415), body ≤ 1 MB (413).

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { timingSafeEqual } from 'crypto'
import { MCP_PATH, mcpUrl } from '../shared/mcpConfig'
import type { McpStatus } from '../shared/types'
import { RPC, rpcError } from './mcpProtocol'
import type { McpConfig } from './settings'

export const MCP_MAX_BODY = 1024 * 1024

export interface McpHttpOptions {
  /** The token clients must send; null refuses everyone. Read per request (regenerating needs no restart). */
  getToken: () => string | null
  /** A parsed POST body → the JSON to answer, or null (202, nothing to answer). */
  handle: (body: unknown) => Promise<unknown | null>
  /** An authorized request arrived. */
  onRequest?: () => void
}

export interface McpHttpServer {
  /** Listen on 127.0.0.1:port (0 = any free port, for tests). Rejects with a Ukrainian message. */
  start(port: number): Promise<void>
  stop(): Promise<void>
  /** The port listened on, or null. */
  port(): number | null
}

function tokenMatches(header: string | undefined, token: string | null): boolean {
  if (!token || !header) return false
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!m) return false
  const a = Buffer.from(m[1])
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost'])

function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false
  const m = /^([^:]+):(\d+)$/.exec(host)
  return !!m && LOCAL_HOSTS.has(m[1].toLowerCase()) && Number(m[2]) === port
}

function originAllowed(origin: string | undefined): boolean {
  if (origin == null) return true // not a browser
  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  if (body === undefined) {
    res.writeHead(status, headers).end()
    return
  }
  const text = JSON.stringify(body)
  res
    .writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    })
    .end(text)
}

/** Read the body up to `max` bytes; null when it is larger. */
function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let over = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) over = true
      else chunks.push(c)
    })
    req.on('end', () => resolve(over ? null : Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function createMcpHttpServer(opts: McpHttpOptions): McpHttpServer {
  let server: Server | null = null
  let listening: number | null = null

  async function onRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const port = listening ?? 0
    const path = (req.url ?? '').split('?')[0]
    if (path !== MCP_PATH) return send(res, 404, { error: 'Not found' })
    if (!hostAllowed(req.headers.host, port) || !originAllowed(req.headers.origin)) {
      return send(res, 403, { error: 'Forbidden' })
    }
    if (!tokenMatches(req.headers.authorization, opts.getToken())) {
      return send(res, 401, { error: 'Unauthorized' }, { 'www-authenticate': 'Bearer' })
    }
    opts.onRequest?.()
    if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { allow: 'POST' })
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) {
      return send(res, 415, { error: 'Content-Type must be application/json' })
    }
    const raw = await readBody(req, MCP_MAX_BODY)
    if (raw == null) return send(res, 413, { error: 'Request too large' })
    let body: unknown
    try {
      body = JSON.parse(raw.toString('utf8'))
    } catch {
      return send(res, 400, rpcError(null, RPC.parseError, 'Parse error'))
    }
    const out = await opts.handle(body)
    if (out == null) return send(res, 202)
    send(res, 200, out)
  }

  return {
    start(port) {
      return new Promise((resolve, reject) => {
        const s = createServer((req, res) => {
          onRequest(req, res).catch(() => {
            if (!res.headersSent) send(res, 500, rpcError(null, RPC.internalError, 'Internal error'))
            else res.end()
          })
        })
        s.once('error', (e: NodeJS.ErrnoException) => {
          reject(
            new Error(
              e.code === 'EADDRINUSE'
                ? `Порт ${port} уже зайнятий іншою програмою — виберіть інший.`
                : e.code === 'EACCES'
                  ? `Немає дозволу слухати порт ${port}.`
                  : `MCP-сервер не запустився: ${e.message}`
            )
          )
        })
        s.listen(port, '127.0.0.1', () => {
          server = s
          const addr = s.address()
          listening = typeof addr === 'object' && addr ? addr.port : port
          resolve()
        })
      })
    },
    stop() {
      const s = server
      server = null
      listening = null
      if (!s) return Promise.resolve()
      return new Promise((resolve) => {
        s.close(() => resolve())
        s.closeAllConnections()
      })
    },
    port: () => listening
  }
}

export interface McpServiceDeps {
  getConfig: () => McpConfig
  ensureToken: () => string
  handle: McpHttpOptions['handle']
  now?: () => number
}

export interface McpService {
  /** Start/stop/restart to match the saved settings. Never throws: an error lands in `status().error`. */
  apply(): Promise<McpStatus>
  status(): McpStatus
  /** A client initialized a session. */
  noteClient(name: string | null): void
  stop(): Promise<void>
}

/** The server as the settings say: running on the saved port while enabled. */
export function createMcpService(deps: McpServiceDeps): McpService {
  const now = deps.now ?? Date.now
  let error: string | null = null
  let requests = 0
  let lastRequestAt: number | null = null
  let lastClient: string | null = null
  let queue: Promise<unknown> = Promise.resolve()

  const http = createMcpHttpServer({
    getToken: () => deps.getConfig().token,
    handle: deps.handle,
    onRequest: () => {
      requests++
      lastRequestAt = now()
    }
  })

  function status(): McpStatus {
    const cfg = deps.getConfig()
    return {
      enabled: cfg.enabled,
      port: cfg.port,
      url: mcpUrl(cfg.port),
      token: cfg.token,
      tokenEncrypted: cfg.tokenEncrypted,
      running: http.port() != null,
      error: cfg.enabled ? error : null,
      requests,
      lastRequestAt,
      lastClient
    }
  }

  async function applyNow(): Promise<void> {
    const cfg = deps.getConfig()
    if (!cfg.enabled) {
      await http.stop()
      error = null
      return
    }
    if (!cfg.token) deps.ensureToken()
    if (http.port() === cfg.port && !error) return
    await http.stop()
    try {
      await http.start(cfg.port)
      error = null
    } catch (e) {
      error = (e as Error).message
    }
  }

  return {
    apply() {
      // Serialized: two quick saves must not race two listens.
      const run = queue.then(applyNow, applyNow)
      queue = run.catch(() => undefined)
      return run.then(status)
    },
    status,
    noteClient(name) {
      lastClient = name
    },
    stop: () => http.stop()
  }
}
