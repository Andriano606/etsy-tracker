import { describe, expect, it } from 'vitest'
import { parseShopInput, shopUrlFor } from '../../src/shared/shopUrl'

describe('parseShopInput — accepted', () => {
  const ok: Array<[string, string]> = [
    ['https://www.etsy.com/shop/CeramicStudioUA', 'CeramicStudioUA'],
    ['https://www.etsy.com/shop/CeramicStudioUA/', 'CeramicStudioUA'],
    ['https://www.etsy.com/uk/shop/CeramicStudioUA', 'CeramicStudioUA'],
    ['https://www.etsy.com/de/shop/CeramicStudioUA', 'CeramicStudioUA'],
    ['https://www.etsy.com/en-gb/shop/CeramicStudioUA', 'CeramicStudioUA'],
    ['https://www.etsy.com/shop/CeramicStudioUA?ref=simple-shop-header-name&listing_id=1', 'CeramicStudioUA'],
    ['https://www.etsy.com/shop/CeramicStudioUA?ref=x&page=2#items', 'CeramicStudioUA'],
    ['https://www.etsy.com/uk/shop/CeramicStudioUA/?ref=shop_sugg#about', 'CeramicStudioUA'],
    ['https://www.etsy.com/shop/CeramicStudioUA/reviews', 'CeramicStudioUA'],
    ['http://www.etsy.com/shop/CeramicStudioUA', 'CeramicStudioUA'],
    ['https://etsy.com/shop/CeramicStudioUA', 'CeramicStudioUA'],
    ['etsy.com/shop/CeramicStudioUA', 'CeramicStudioUA'],
    ['www.etsy.com/uk/shop/CeramicStudioUA?ref=1', 'CeramicStudioUA'],
    ['https://m.etsy.com/shop/CeramicStudioUA', 'CeramicStudioUA'],
    ['https://WWW.ETSY.COM/SHOP/CeramicStudioUA', 'CeramicStudioUA'],
    ['https://ceramicstudioua.etsy.com', 'ceramicstudioua'],
    ['https://CeramicStudioUA.etsy.com/', 'ceramicstudioua'],
    ['ceramicstudioua.etsy.com/?ref=x', 'ceramicstudioua'],
    ['CeramicStudioUA', 'CeramicStudioUA'],
    ['  CeramicStudioUA  ', 'CeramicStudioUA'],
    ['  https://www.etsy.com/shop/Shop123  ', 'Shop123'],
    ['https://www.etsy.com/shop/Ceramic%53tudio', 'CeramicStudio'],
    // A shop may itself be named "Listing" — only /listing/… is a listing link.
    ['https://www.etsy.com/shop/Listing', 'Listing'],
    ['https://www.etsy.com/uk/shop/listing/reviews', 'listing']
  ]
  it.each(ok)('%s → %s', (input, name) => {
    expect(parseShopInput(input)).toEqual({ ok: true, shopName: name })
  })
})

describe('parseShopInput — rejected', () => {
  const bad: Array<[string, RegExp]> = [
    ['', /Вставте/],
    ['   ', /Вставте/],
    ['https://www.etsy.com/listing/1801234567/handmade-mug', /посилання на товар/],
    ['https://www.etsy.com/uk/listing/1801234567/mug?ref=shop_home', /посилання на товар/],
    ['https://ceramicstudioua.etsy.com/listing/1801234567/mug', /посилання на товар/],
    ['https://www.google.com/shop/CeramicStudioUA', /не посилання на Etsy/],
    ['https://notetsy.com/shop/CeramicStudioUA', /не посилання на Etsy/],
    ['https://etsy.com.evil.example/shop/CeramicStudioUA', /не посилання на Etsy/],
    ['ftp://www.etsy.com/shop/CeramicStudioUA', /не посилання на Etsy/],
    ['https://www.etsy.com/', /не вдалося знайти назву/i],
    ['https://www.etsy.com/shop/', /не вдалося знайти назву/i],
    ['https://www.etsy.com/people/someone', /не вдалося знайти назву/i],
    ['https://www.etsy.com/c/home-and-living', /не вдалося знайти назву/i],
    ['https://help.etsy.com/hc/en-us', /не вдалося знайти назву/i],
    ['https://www.etsy.com/shop/Bad-Name!', /латинські літери/],
    ['Назва магазину', /не посилання на Etsy|латинські/],
    ['shop name with spaces', /не посилання на Etsy|латинські/],
    ['Ab_c', /латинські літери/],
    ['x', /латинські літери/],
    ['https://www.etsy.com/shop/%E0%A4%A', /латинські літери/],
    ['not a url at all://', /не посилання на Etsy/]
  ]
  it.each(bad)('%s', (input, err) => {
    const r = parseShopInput(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(err)
  })
})

describe('shopUrlFor', () => {
  it('builds the canonical shop URL', () => {
    expect(shopUrlFor('CeramicStudioUA')).toBe('https://www.etsy.com/shop/CeramicStudioUA')
  })
})
