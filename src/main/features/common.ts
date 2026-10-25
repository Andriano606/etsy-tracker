// Helpers every feature shares: arguments, the signed-in shop, scopes, and the
// MCP side (English error texts via mcpErrorText, own-shop/write gates).

import { missingScopes, SCOPE_LABEL } from '../../shared/myShop'
import { EtsyApiError } from '../etsyApi'
import { ToolInputError, type McpToolResult } from '../mcpProtocol'
import { NOT_SIGNED_IN, WRITES_OFF, mcpErrorText } from '../mcpStoreTools'
import type { FeatureCtx, FeatureMcpDeps } from './types'
import { FeatureError } from './errors'

export { FeatureError }

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
      `Для цього потрібен дозвіл: ${missing.map((s) => SCOPE_LABEL[s] ?? s).join(', ')}. Вийдіть і увійдіть в Etsy ще раз («Керувати» у шапці вашого магазину → «Вийти»).`
    )
  }
  return st.shopId
}

// ------------------------------------------------------------------- MCP side

/** The user's own Etsy shop for an MCP tool: signed in (+ OAuth scopes), else a ToolInputError. */
export function mcpOwnShop(deps: FeatureMcpDeps, scopes: readonly string[] = []): number {
  const st = deps.authStatus()
  if (!deps.client || !st.loggedIn || !st.shopId) throw new ToolInputError(NOT_SIGNED_IN)
  const missing = missingScopes(st.scopes, scopes)
  if (missing.length) {
    throw new ToolInputError(
      `The user's Etsy sign-in lacks a permission this needs (${missing.join(', ')}) — an Etsy OAuth scope, granted at sign-in. Ask them to sign out and sign in to Etsy again in the app: the "Керувати" button in their own shop's header → "Вийти", then "Увійти через Etsy".`
    )
  }
  return st.shopId
}

/** The own Etsy shop + the MCP modal's "allow changes" switch. */
export function mcpWritable(deps: FeatureMcpDeps, scopes: readonly string[] = []): number {
  const id = mcpOwnShop(deps, scopes)
  if (!deps.writesAllowed()) throw new ToolInputError(WRITES_OFF)
  return id
}

/** A tool error result with mcpErrorText's English text (Etsy errors with Etsy's own detail). */
export function mcpFail(e: unknown): McpToolResult {
  return { content: [{ type: 'text', text: mcpErrorText(e) }], isError: true }
}

export { mcpErrorText }
