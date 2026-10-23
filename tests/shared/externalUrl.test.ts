import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl, isEtsyCdnUrl } from '../../src/shared/externalUrl'

describe('isAllowedExternalUrl', () => {
  it.each([
    'https://www.etsy.com/listing/1/x',
    'https://etsy.com/shop/A',
    'https://www.etsy.com/developers/your-apps',
    'https://help.etsy.com/hc'
  ])('allows %s', (u) => expect(isAllowedExternalUrl(u)).toBe(true))

  it.each([
    'http://www.etsy.com/listing/1',
    'https://etsy.com.evil.example/',
    'https://evil-etsy.com/',
    'https://user:pw@www.etsy.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url'
  ])('refuses %s', (u) => expect(isAllowedExternalUrl(u)).toBe(false))
})

describe('isEtsyCdnUrl', () => {
  it.each([
    'https://i.etsystatic.com/1/r/il/ab/1/il_570xN.1_ab.jpg',
    'https://etsystatic.com/x.jpg',
    'https://v.etsystatic.com/video.mp4'
  ])('allows %s', (u) => expect(isEtsyCdnUrl(u)).toBe(true))

  it.each([
    'http://i.etsystatic.com/x.jpg',
    'file:///etc/hostname',
    'etsyimg://img/1/570xN',
    'https://etsystatic.com.evil.example/x.jpg',
    'https://evil-etsystatic.com/x.jpg',
    'https://u:p@i.etsystatic.com/x.jpg',
    '',
    'not a url'
  ])('refuses %s', (u) => expect(isEtsyCdnUrl(u)).toBe(false))

  it('refuses null/undefined', () => {
    expect(isEtsyCdnUrl(null)).toBe(false)
    expect(isEtsyCdnUrl(undefined)).toBe(false)
  })
})
