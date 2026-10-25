import { describe, expect, it } from 'vitest'
import {
  draftPhotoRef,
  hasEtsyShortLink,
  draftRef,
  parseClaudeRef,
  photoRef,
  productRef,
  reviewPhotoRef,
  storeImageRef,
  storeRef,
  videoRef
} from '../../src/shared/claudeRef'

describe('claude references', () => {
  it('builds and parses every app reference', () => {
    expect(parseClaudeRef(productRef(1803602196))).toEqual({ kind: 'product', productId: 1803602196 })
    expect(parseClaudeRef(photoRef(1803602196, 6437472477))).toEqual({ kind: 'photo', productId: 1803602196, imageId: 6437472477 })
    expect(parseClaudeRef(videoRef(5, 9))).toEqual({ kind: 'video', productId: 5, videoId: 9 })
    expect(parseClaudeRef(reviewPhotoRef(12))).toEqual({ kind: 'reviewPhoto', reviewId: 12 })
    expect(parseClaudeRef(storeRef(7))).toEqual({ kind: 'store', storeId: 7 })
    expect(parseClaudeRef(storeImageRef(7))).toEqual({ kind: 'storeImage', storeId: 7, image: 'logo' })
    expect(parseClaudeRef(storeImageRef(7, 'banner'))).toEqual({ kind: 'storeImage', storeId: 7, image: 'banner' })
    expect(parseClaudeRef(draftRef(3))).toEqual({ kind: 'draft', draftId: 3 })
    expect(parseClaudeRef(draftPhotoRef(3, 77))).toEqual({ kind: 'draftPhoto', draftId: 3, mediaId: 77 })
    expect(productRef(1)).toBe('etsy-tracker://product/1')
  })

  it('finds the reference inside a sentence', () => {
    expect(parseClaudeRef('подивись на цю картинку etsy-tracker://product/1/photo/2 будь ласка')).toEqual({
      kind: 'photo',
      productId: 1,
      imageId: 2
    })
    expect(parseClaudeRef('ось: https://www.etsy.com/listing/1803602196.')).toEqual({ kind: 'product', productId: 1803602196 })
  })

  it('reads Etsy listing and shop links in their usual shapes', () => {
    for (const url of [
      'https://www.etsy.com/listing/1803602196',
      'https://www.etsy.com/listing/1803602196/social-media-content-calendar?ref=shop_home',
      'https://www.etsy.com/uk/listing/1803602196/x',
      'etsy.com/listing/1803602196',
      'https://m.etsy.com/listing/1803602196'
    ]) {
      expect(parseClaudeRef(url), url).toEqual({ kind: 'product', productId: 1803602196 })
    }
    expect(parseClaudeRef('https://www.etsy.com/shop/OneWayCollection')).toEqual({ kind: 'storeName', name: 'OneWayCollection' })
    expect(parseClaudeRef('1803602196')).toEqual({ kind: 'product', productId: 1803602196 })
  })

  it('a reference or link wrapped in quotes, Markdown or a dash', () => {
    const photo = { kind: 'photo', productId: 123, imageId: 5 }
    for (const text of [
      '`etsy-tracker://product/123/photo/5`',
      '«etsy-tracker://product/123/photo/5»',
      '“etsy-tracker://product/123/photo/5”',
      '„etsy-tracker://product/123/photo/5“',
      '‘etsy-tracker://product/123/photo/5’',
      '**etsy-tracker://product/123/photo/5**',
      '*etsy-tracker://product/123/photo/5*',
      'ось etsy-tracker://product/123/photo/5—глянь',
      '(etsy-tracker://product/123/photo/5)',
      '[etsy-tracker://product/123/photo/5]',
      'фото: etsy-tracker://product/123/photo/5…'
    ]) {
      expect(parseClaudeRef(text), text).toEqual(photo)
    }
    expect(parseClaudeRef('`etsy-tracker://product/123`')).toEqual({ kind: 'product', productId: 123 })
    expect(parseClaudeRef('магазин «https://www.etsy.com/shop/TidyFoxSheets»')).toEqual({ kind: 'storeName', name: 'TidyFoxSheets' })
    expect(parseClaudeRef('`https://www.etsy.com/shop/X1`')).toEqual({ kind: 'storeName', name: 'X1' })
    expect(parseClaudeRef('**https://www.etsy.com/listing/1803602196/x**')).toEqual({ kind: 'product', productId: 1803602196 })
    expect(parseClaudeRef('«https://www.etsy.com/listing/1803602196»')).toEqual({ kind: 'product', productId: 1803602196 })
  })

  it('the scheme and the path in any case', () => {
    expect(parseClaudeRef('ETSY-TRACKER://PRODUCT/1/PHOTO/2')).toEqual({ kind: 'photo', productId: 1, imageId: 2 })
    expect(parseClaudeRef('Etsy-Tracker://Store/7/Logo')).toEqual({ kind: 'storeImage', storeId: 7, image: 'logo' })
  })

  it("the shop owner's editor links are the listing too", () => {
    for (const url of [
      'https://www.etsy.com/your/shops/me/listing-editor/edit/123456',
      'https://www.etsy.com/your/shops/me/listing-editor/edit/123456?ref=x',
      'https://www.etsy.com/your/listings/123456'
    ]) {
      expect(parseClaudeRef(`ось ${url}`), url).toEqual({ kind: 'product', productId: 123456 })
    }
    expect(parseClaudeRef('https://www.etsy.com/your/shops/me/listing-editor/edit/abc')).toBeNull()
  })

  it('etsy.me short links are recognised as such (they hide the id), not parsed', () => {
    expect(parseClaudeRef('https://etsy.me/3AbCdEf')).toBeNull()
    expect(hasEtsyShortLink('глянь https://etsy.me/3AbCdEf')).toBe(true)
    expect(hasEtsyShortLink('etsy.me/3AbCdEf')).toBe(true)
    expect(hasEtsyShortLink('https://notetsy.me/x')).toBe(false)
    expect(hasEtsyShortLink('https://www.etsy.com/listing/1')).toBe(false)
  })

  it('a number inside a sentence is not a bare id; an app reference wins over an earlier Etsy link', () => {
    expect(parseClaudeRef('1234567 is the id')).toBeNull()
    expect(parseClaudeRef('https://www.etsy.com/listing/1803602196 and etsy-tracker://product/1/photo/2')).toEqual({
      kind: 'photo',
      productId: 1,
      imageId: 2
    })
  })

  it('refuses what is not a reference', () => {
    for (const bad of [
      '',
      'hello',
      'etsy-tracker://product/abc',
      'etsy-tracker://product/0',
      'etsy-tracker://product/1/photo',
      'etsy-tracker://product/1/size/2',
      'etsy-tracker://review/1',
      'etsy-tracker://draft/1/file/2',
      'etsy-tracker://unknown/1',
      'https://example.com/listing/1',
      'https://evil-etsy.com/listing/1803602196',
      'https://myetsy.com/listing/1803602196',
      'see notetsy.com/shop/Foo',
      'https://www.etsy.com/listing/abc',
      '12'
    ]) {
      expect(parseClaudeRef(bad), bad).toBeNull()
    }
  })
})
