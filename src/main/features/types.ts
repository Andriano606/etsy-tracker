// The feature framework: every group of Etsy API methods added after the core
// (market search, competitor extras, inventory, media, listing metadata, shop
// configuration, orders & money, account) is one `Feature` in its own file —
// its IPC actions (one generic channel, `feature:call`) and its MCP tools.
// See CLAUDE.md "Features (feature:call)".

import type { EtsyAuthStatus } from '../../shared/types'
import type { Db } from '../db'
import type { EtsyClient } from '../etsyApi'
import type { McpTool } from '../mcpProtocol'
import type { FileRegistry } from '../myShop'
import type { TaxonomyOption } from '../../shared/types'

/** What an action (IPC) gets. */
export interface FeatureCtx {
  db: Db
  client: EtsyClient
  /** Etsy sign-in state (own-shop features). */
  authStatus: () => EtsyAuthStatus
  /** Files picked with `myShop:pickFiles` (renderer holds tokens only). */
  files: FileRegistry
  readFile: (path: string) => Promise<Uint8Array<ArrayBuffer>>
  /** Push `feature:event` {feature, type, payload} to the renderer (progress…). */
  emit: (type: string, payload: unknown) => void
  /** The seller taxonomy as "A › B › C" paths (cached). */
  taxonomy: () => Promise<TaxonomyOption[]>
  /** The current OAuth access token (refreshed as needed), null when signed out. */
  accessToken: () => Promise<string | null>
  now: () => number
}

/** An IPC action: validates its own args; throws to answer `{ok: false, error}` (Ukrainian text). */
export type FeatureAction = (args: Record<string, unknown>, ctx: FeatureCtx) => unknown | Promise<unknown>

/** What MCP tools of a feature get. */
export interface FeatureMcpDeps {
  db: Db
  client: EtsyClient | null
  authStatus: () => EtsyAuthStatus
  /** The MCP modal's "allow changes" switch (read per call). */
  writesAllowed: () => boolean
  taxonomy: () => Promise<TaxonomyOption[]>
  readFile?: (path: string) => Promise<Uint8Array<ArrayBuffer>>
  statFile?: (path: string) => Promise<{ size: number; isFile: boolean }>
  accessToken: () => Promise<string | null>
  now: () => number
}

export interface Feature {
  /** Short id: the first argument of `feature:call` and of `window.api.featureCall`. */
  id: string
  actions: Record<string, FeatureAction>
  /** Neutral MCP tools (never name the marketplace — see mcpTools.ts). */
  mcpTools?: (deps: FeatureMcpDeps) => McpTool[]
}
