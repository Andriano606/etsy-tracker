import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from '../../src/shared/externalUrl'

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
