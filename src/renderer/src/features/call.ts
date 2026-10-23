// The renderer side of `feature:call` (main/features): typed by the caller.

import type { MyShopResult } from '@shared/types'

export function featureCall<T>(feature: string, action: string, args: Record<string, unknown> = {}): Promise<MyShopResult<T>> {
  return window.api.featureCall(feature, action, args) as Promise<MyShopResult<T>>
}
