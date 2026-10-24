// The Model Context Protocol over JSON-RPC 2.0, server side, tools only — what
// the HTTP layer (mcpServer.ts) feeds every POSTed message to. Hand-rolled
// instead of @modelcontextprotocol/sdk: the server needs initialize / ping /
// tools/list / tools/call and nothing else, and the SDK would ship express,
// hono and a dozen more packages inside the AppImage. tests/main/mcpServer.test.ts
// checks it against the official SDK client.

/** Newest first; an unknown version requested by a client is answered with the first. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const

export interface JsonSchema {
  type?: 'object' | 'string' | 'integer' | 'number' | 'boolean' | 'array'
  description?: string
  enum?: readonly (string | number)[]
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  default?: unknown
  items?: JsonSchema
  properties?: Record<string, JsonSchema>
  required?: readonly string[]
  additionalProperties?: boolean
}

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

export interface McpToolResult {
  content: McpContent[]
  isError?: boolean
}

export interface McpTool {
  name: string
  title: string
  description: string
  inputSchema: JsonSchema & { type: 'object' }
  /** false = changes something (MCP annotations: readOnlyHint false). Default true. */
  readOnly?: boolean
  /** Changes are hard to undo (publishing, deactivating). Only meaningful when not read-only. */
  destructive?: boolean
  /**
   * Reaches outside the app (the Etsy API or Etsy's image CDN) — MCP
   * `openWorldHint`. Default: false (the app's own database only).
   */
  openWorld?: boolean
  /** Arguments already checked against `inputSchema`. */
  run(args: Record<string, unknown>): McpToolResult | Promise<McpToolResult>
}

export interface McpServerInfo {
  name: string
  title: string
  version: string
  /** Shown to the client's model: what the server is and how to use it. */
  instructions: string
}

export interface McpHandlerOptions {
  info: McpServerInfo
  tools: readonly McpTool[]
  /** A client initialized a session (`clientInfo.name`, if it sent one). */
  onInitialize?: (clientName: string | null) => void
}

/** A tool argument is invalid: answered as a tool error the model can read and fix. */
export class ToolInputError extends Error {}

export const RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603
} as const

type Id = string | number | null

interface RpcResponse {
  jsonrpc: '2.0'
  id: Id
  result?: unknown
  error?: { code: number; message: string }
}

const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })
export const rpcError = (id: Id, code: number, message: string): RpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message }
})

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export const textResult = (data: unknown): McpToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }]
})

export const errorResult = (message: string): McpToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true
})

function typeOk(s: JsonSchema, v: unknown): boolean {
  switch (s.type) {
    case 'string':
      return typeof v === 'string'
    case 'integer':
      return typeof v === 'number' && Number.isSafeInteger(v)
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'boolean':
      return typeof v === 'boolean'
    case 'array':
      return Array.isArray(v)
    case 'object':
      return isObj(v)
    default:
      return true
  }
}

/** Check arguments against a tool's (flat) input schema. Throws ToolInputError. */
export function checkArgs(schema: JsonSchema, args: unknown): Record<string, unknown> {
  if (args == null) args = {}
  if (!isObj(args)) throw new ToolInputError('Arguments must be an object.')
  const props = schema.properties ?? {}
  for (const k of schema.required ?? []) {
    if (args[k] === undefined) throw new ToolInputError(`Missing required argument "${k}".`)
  }
  for (const [k, v] of Object.entries(args)) {
    const p = props[k]
    if (!p) {
      if (schema.additionalProperties === false) throw new ToolInputError(`Unknown argument "${k}".`)
      continue
    }
    if (v === undefined || v === null) continue
    if (!typeOk(p, v)) throw new ToolInputError(`Argument "${k}" must be of type ${p.type}.`)
    if (p.enum && !p.enum.includes(v as string | number)) {
      throw new ToolInputError(`Argument "${k}" must be one of: ${p.enum.join(', ')}.`)
    }
    if (typeof v === 'number') {
      if (p.minimum != null && v < p.minimum) throw new ToolInputError(`Argument "${k}" must be ≥ ${p.minimum}.`)
      if (p.maximum != null && v > p.maximum) throw new ToolInputError(`Argument "${k}" must be ≤ ${p.maximum}.`)
    }
    if (typeof v === 'string') {
      if (p.minLength != null && v.length < p.minLength) {
        throw new ToolInputError(`Argument "${k}" must be at least ${p.minLength} characters.`)
      }
      if (p.maxLength != null && v.length > p.maxLength) {
        throw new ToolInputError(`Argument "${k}" must be at most ${p.maxLength} characters.`)
      }
    }
  }
  return args
}

async function callTool(opts: McpHandlerOptions, id: Id, params: Record<string, unknown>): Promise<RpcResponse> {
  const tool = opts.tools.find((t) => t.name === params.name)
  if (!tool) return rpcError(id, RPC.invalidParams, `Unknown tool: ${String(params.name)}`)
  try {
    return ok(id, await tool.run(checkArgs(tool.inputSchema, params.arguments)))
  } catch (e) {
    if (e instanceof ToolInputError) return ok(id, errorResult(e.message))
    return ok(id, errorResult(`The tool failed: ${e instanceof Error ? e.message : String(e)}`))
  }
}

/**
 * One JSON-RPC message → its response, or null for a notification / a client's
 * response (nothing to answer).
 */
export async function handleMcpMessage(opts: McpHandlerOptions, msg: unknown): Promise<RpcResponse | null> {
  if (!isObj(msg) || msg.jsonrpc !== '2.0') return rpcError(null, RPC.invalidRequest, 'Invalid JSON-RPC message.')
  const hasId = 'id' in msg && (typeof msg.id === 'string' || typeof msg.id === 'number')
  if (typeof msg.method !== 'string') {
    // A response to a server request (we never send any) — nothing to answer.
    return hasId && ('result' in msg || 'error' in msg) ? null : rpcError(null, RPC.invalidRequest, 'Invalid request.')
  }
  if (!hasId) return null // notification (notifications/initialized, cancelled, …)
  const id = msg.id as string | number
  const params = isObj(msg.params) ? msg.params : {}

  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      const version = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0]
      const client = isObj(params.clientInfo) && typeof params.clientInfo.name === 'string' ? params.clientInfo.name : null
      opts.onInitialize?.(client)
      return ok(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: opts.info.name, title: opts.info.title, version: opts.info.version },
        instructions: opts.info.instructions
      })
    }
    case 'ping':
      return ok(id, {})
    case 'tools/list':
      return ok(id, {
        tools: opts.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: {
            title: t.title,
            readOnlyHint: t.readOnly !== false,
            destructiveHint: t.readOnly === false && !!t.destructive,
            idempotentHint: t.readOnly !== false,
            openWorldHint: !!t.openWorld
          }
        }))
      })
    case 'tools/call':
      return callTool(opts, id, params)
    default:
      return rpcError(id, RPC.methodNotFound, `Method not found: ${msg.method}`)
  }
}

/** A POST body: one message or (protocol 2025-03-26) a batch. null = nothing to answer. */
export async function handleMcpBody(opts: McpHandlerOptions, body: unknown): Promise<unknown | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, RPC.invalidRequest, 'Empty batch.')
    const out = (await Promise.all(body.map((m) => handleMcpMessage(opts, m)))).filter((r) => r != null)
    return out.length ? out : null
  }
  return handleMcpMessage(opts, body)
}
