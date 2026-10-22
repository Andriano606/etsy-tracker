// Adding a shop: parse the pasted link, resolve the name through findShops, store.

import type { AddShopResult } from '../shared/types'
import { parseShopInput } from '../shared/shopUrl'
import { type Db, findShopByName, getShop, getShopSummary, insertShop } from './db'
import { EtsyApiError, type EtsyClient } from './etsyApi'
import { mapShop } from './mapEtsy'

export async function addShop(
  db: Db,
  client: EtsyClient,
  input: string,
  now: number = Date.now()
): Promise<AddShopResult> {
  const parsed = parseShopInput(input)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const dupe = (name: string): AddShopResult => ({
    ok: false,
    error: `Магазин «${name}» уже додано.`
  })
  const existing = findShopByName(db, parsed.shopName)
  if (existing) return dupe(existing.shopName)

  let found
  try {
    found = await client.findShopByName(parsed.shopName)
  } catch (e) {
    return { ok: false, error: e instanceof EtsyApiError ? e.message : String(e) }
  }
  if (!found) {
    return { ok: false, error: `Магазин «${parsed.shopName}» не знайдено на Etsy.` }
  }
  const shop = mapShop(found, now)
  if (getShop(db, shop.id)) return dupe(shop.shopName)

  insertShop(db, shop)
  const summary = getShopSummary(db, shop.id)
  if (!summary) return { ok: false, error: 'Не вдалося зберегти магазин.' }
  return { ok: true, shop: summary }
}
