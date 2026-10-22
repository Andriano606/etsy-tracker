// Etsy has historically returned HTML entities (&quot; &#39; &amp; …) inside
// listing titles and descriptions. We store and show plain text, so decode them
// once on the way in. Decoding only — the result is always rendered as text,
// never as HTML.

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢'
}

function fromCodePoint(cp: number, original: string): string {
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
    return original
  }
  return String.fromCodePoint(cp)
}

/** Decode named and numeric HTML entities. Unknown entities are left as-is. */
export function decodeHtmlEntities(text: string): string {
  if (!text || !text.includes('&')) return text ?? ''
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X'
      return fromCodePoint(parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10), m)
    }
    const named = NAMED[body.toLowerCase()]
    return named ?? m
  })
}
