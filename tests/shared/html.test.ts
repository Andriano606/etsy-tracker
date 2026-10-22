import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities } from '../../src/shared/html'

describe('decodeHtmlEntities', () => {
  it.each([
    ['Mug &quot;Sunflower&quot;', 'Mug "Sunflower"'],
    ['Tom&#39;s &amp; Jerry&#039;s', "Tom's & Jerry's"],
    ['&lt;b&gt;bold&lt;/b&gt;', '<b>bold</b>'],
    ['caf&#xE9; &#x1F600;', 'café 😀'],
    ['a&nbsp;b &mdash; c&hellip;', 'a b — c…'],
    ['plain text', 'plain text'],
    ['', '']
  ])('%s', (input, out) => {
    expect(decodeHtmlEntities(input)).toBe(out)
  })

  it('leaves unknown and invalid entities alone', () => {
    expect(decodeHtmlEntities('&unknown; &#xD800; &#99999999;')).toBe('&unknown; &#xD800; &#99999999;')
  })

  it('decodes only once (no double-unescape)', () => {
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;')
  })
})
