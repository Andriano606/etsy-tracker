// Helpers every feature shares: arguments, the signed-in shop, scopes, and the
// MCP side (neutral errors, own-store/write gates).

import { missingScopes, SCOPE_LABEL } from '../../shared/myShop'
import { EtsyApiError } from '../etsyApi'
import { ToolInputError, type McpToolResult } from '../mcpProtocol'
import { NOT_SIGNED_IN, WRITES_OFF, neutralError } from '../mcpStoreTools'
import type { FeatureCtx, FeatureMcpDeps } from './types'

/** A Ukrainian message for a refused action — shown as is (IPC) / neutralized (MCP). */
export class FeatureError extends Error {}

/** A positive safe integer argument, else FeatureError. */
export function idArg(args: Record<string, unknown>, name: string): number {
  const n = Number(args[name])
  if (!Number.isSafeInteger(n) || n <= 0) throw new FeatureError(`Некоректний ${name}.`)
  return n
}

export function optIdArg(args: Record<string, unknown>, name: string): number | null {
  return args[name] == null ? null : idArg(args, name)
}

export function strArg(args: Record<string, unknown>, name: string, opts: { optional?: boolean; max?: number } = {}): string {
  const v = args[name]
  if (v == null && opts.optional) return ''
  if (typeof v !== 'string') throw new FeatureError(`Поле ${name} має бути текстом.`)
  if (opts.max && v.length > opts.max) throw new FeatureError(`Поле ${name} довше за ${opts.max} символів.`)
  return v
}

/**
 * The signed-in user's shop id, after checking the sign-in has `scopes`
 * (else: sign in again — the message names what is missing).
 */
export function ownShop(status: FeatureCtx['authStatus'], scopes: readonly string[] = []): number {
  const st = status()
  if (!st.loggedIn) throw new EtsyApiError('not_signed_in', 'Увійдіть в Etsy («Мій магазин» → «Увійти через Etsy»).')
  if (!st.shopId) throw new FeatureError('У цього акаунта Etsy немає магазину.')
  const missing = missingScopes(st.scopes, scopes)
  if (missing.length) {
    throw new FeatureError(
      `Для цього потрібен дозвіл: ${missing.map((s) => SCOPE_LABEL[s] ?? s).join(', ')}. Вийдіть і увійдіть в Etsy ще раз («✏️ Мій магазин»).`
    )
  }
  return st.shopId
}

// ------------------------------------------------------------------- MCP side

/** Own store for an MCP tool: signed in (+ scopes), else a neutral ToolInputError. */
export function mcpOwnShop(deps: FeatureMcpDeps, scopes: readonly string[] = []): number {
  const st = deps.authStatus()
  if (!deps.client || !st.loggedIn || !st.shopId) throw new ToolInputError(NOT_SIGNED_IN)
  const missing = missingScopes(st.scopes, scopes)
  if (missing.length) {
    throw new ToolInputError(
      `The user's sign-in to their store lacks a permission this needs (${missing.join(', ')}). Ask them to sign out and sign in again in the app ("✏️ Мій магазин").`
    )
  }
  return st.shopId
}

/** Own store + the "allow changes" switch. */
export function mcpWritable(deps: FeatureMcpDeps, scopes: readonly string[] = []): number {
  const id = mcpOwnShop(deps, scopes)
  if (!deps.writesAllowed()) throw new ToolInputError(WRITES_OFF)
  return id
}

/** A tool error result with a neutral text. */
export function mcpFail(e: unknown): McpToolResult {
  return { content: [{ type: 'text', text: neutralError(e) }], isError: true }
}

export { neutralError }
