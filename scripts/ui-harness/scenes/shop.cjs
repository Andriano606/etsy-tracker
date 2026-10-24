// UI harness scenes: shop view — header, overview, scan results, grid, cards,
// scan history (see ../main.cjs). Each starts from a fresh app (first shop selected).

// Helpers shared by the scenes below (run in the page).
const PRE = `
const shopNamed = async (name) => { await __h.click(name, '.shop-item'); await __h.sleep(500) }
// Scroll only the shop's own scroller (scrollIntoView would also scroll the window).
const reveal = async (sel, block = 'start') => {
  const el = document.querySelector(sel)
  const sc = document.querySelector('.shop-scroll')
  if (el && sc) {
    const r = el.getBoundingClientRect()
    const s = sc.getBoundingClientRect()
    sc.scrollTop += block === 'end' ? r.bottom - s.bottom + 8 : r.top - s.top - 8
  }
  await __h.sleep(400)
}
const setSearch = async (value) => {
  const el = document.querySelector('.grid-search input')
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await __h.sleep(300)
}
const hover = async (sel) => {
  const el = document.querySelector(sel)
  if (!el) throw new Error('no element: ' + sel)
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
  await __h.sleep(400)
}
const more = async () => {
  const b = document.querySelector('.shop-header .ui-actionbar-more button')
  if (b) { b.click(); await __h.sleep(400) }
}
// The fixtures have no scan changes, failed scans or running syncs. To see those
// states, find the app's store (zustand getState, via React's fiber hooks),
// mutate its state and nudge it with a setter so React re-renders. Harness only.
const getState = () => {
  const root = document.getElementById('root')
  const k = Object.keys(root).find((x) => x.startsWith('__reactContainer$'))
  const stack = [root[k]]
  while (stack.length) {
    const f = stack.pop()
    if (!f) continue
    let h = f.memoizedState
    while (h && typeof h === 'object' && 'next' in h) {
      const m = h.memoizedState
      if (Array.isArray(m) && Array.isArray(m[1]) && typeof m[1][0] === 'function' && m[1][0].name === 'getState') return m[1][0]
      h = h.next
    }
    stack.push(f.sibling, f.child)
  }
  throw new Error('store not found')
}
const patch = async (p) => {
  const s = getState()()
  Object.assign(s, typeof p === 'function' ? p(s) : p)
  s.setSearch(s.search + '')
  await __h.sleep(400)
}
const patchShop = (over) => (s) => ({ shops: s.shops.map((x) => (x.id === s.activeShopId ? { ...x, ...over(x) } : x)) })
const openAll = async (sel = '.results details') => {
  for (const d of document.querySelectorAll(sel)) d.open = true
  await __h.sleep(400)
}
const DAY = 86400
const now = Math.floor(Date.now() / 1000)
const changesDemo = (s) => {
  const L = s.listings
  const scanId = 999
  const ch = (id, kind, l, oldValue = null, newValue = null) => ({ id, scanId, listingId: l.listingId, kind, oldValue, newValue, listing: l })
  const money = (l, k = 1) => ({ priceAmount: Math.round(l.priceAmount * k), priceDivisor: l.priceDivisor, currency: l.currency })
  const promo = (id, l, pct, ended) => ({
    id, listingId: l.listingId, shopId: s.activeShopId, country: 'UA', currency: 'USD', discountPercentage: pct,
    discountStart: now - 2 * DAY, discountEnd: now + 12 * DAY, original: { amount: 300, divisor: 100 },
    discounted: { amount: 300 - pct * 3, divisor: 100 }, discountAmount: null, startKind: 'seen', startedScanId: scanId,
    firstSeenAt: Date.now(), lastSeenAt: Date.now(), endedScanId: ended ? scanId : null, endedAt: ended ? Date.now() : null,
    endReason: ended ? 'ended' : null, listingTitle: l.title, listingImageId: l.images[0]?.id ?? null
  })
  const review = (id, l, rating, text, photo) => ({
    id, key: 't-' + id, shopId: s.activeShopId, listingId: l.listingId, transactionId: id, buyerUserId: null, rating, text,
    language: 'en', hasImage: !!photo, imageStatus: null, createdAt: now - id * 3600, updatedAt: null, firstSeenAt: Date.now(),
    lastSeenAt: Date.now(), origin: 'new', listingTitle: l.title, listingImageId: l.images[0]?.id ?? null
  })
  return {
    ...patchShop((x) => ({
      lastOkScan: { ...x.lastOkScan, id: scanId, added: 2, returned: 1, removed: 1, changed: 2, promotionsStarted: 2, promotionsEnded: 1 },
      reviews: x.reviews ? { ...x.reviews, newCount: 2 } : x.reviews
    }))(s),
    lastChanges: [
      ch(1, 'added', L[0]),
      ch(2, 'added', L[1]),
      ch(3, 'returned', L[2]),
      ch(4, 'removed', { ...L[3], removedAt: Date.now() }),
      ch(5, 'changed', L[4], { ...money(L[4], 1.25), description: 'old', images: [1, 2, 3] }, { ...money(L[4]), description: 'new', images: [4, 1, 2, 3] }),
      ch(6, 'changed', L[5], { title: 'An older, shorter title', tags: ['budget', 'planner'] }, { title: L[5].title, tags: ['budget', 'planner', 'digital download', 'google sheets'] })
    ],
    scanPromotions: { started: [promo(1, L[6], 60), promo(2, L[7], 25)], ended: [promo(3, L[8], 15, true)] },
    newReviews: [
      review(11, L[0], 5, 'Exactly what I needed to finally get my budget under control. Easy to set up and the instructions were clear.\\nWould buy again!', false),
      review(12, L[1], 4, 'Nice template, a little confusing at first.', false)
    ]
  }
}
`
const scene = (name, body) => ({ name, code: PRE + body })

module.exports = [
  scene('shop', ''),
  scene('shop-scrolled', "await __h.scroll('.shop-scroll', 900)"),
  scene('shop-grid', "await reveal('.all-listings')"),
  scene('shop-grid-bottom', "await __h.scroll('.shop-scroll', 100000)"),
  scene('shop-own', "await shopNamed('TidyFoxSheets')"),
  scene('shop-own-more', "await shopNamed('TidyFoxSheets'); await more()"),
  scene('shop-baseline', "await shopNamed('OneWayCollection')"),
  scene('shop-baseline-grid', "await shopNamed('OneWayCollection'); await reveal('.all-listings')"),
  scene('shop-more-menu', 'await more()'),
  scene('shop-tip', "await __h.clickSel('.shop-overview .ui-infotip')"),
  scene('shop-stat-tip', "await __h.clickSel('.shop-kpis .ui-infotip')"),
  scene('shop-card-tip', "await reveal('.all-listings'); await hover('.all-listings [data-testid=card-favorites]')"),
  scene('shop-changes', 'await patch(changesDemo); await openAll()'),
  scene('shop-changes-scrolled', "await patch(changesDemo); await openAll(); await reveal('.kind-changed')"),
  scene('shop-changes-reviews', "await patch(changesDemo); await openAll(); await reveal('.new-reviews')"),
  scene('shop-changes-promos', "await patch(changesDemo); await openAll(); await reveal('.promotions')"),
  scene('shop-changes-wide-card', "await patch(changesDemo); await reveal('.results-new')"),
  scene('shop-history-changes', 'await patch((s) => ({ historyScan: s.scans[0], historyChanges: changesDemo(s).lastChanges })); await __h.sleep(300)'),
  scene('shop-history-changes-scrolled', "await patch((s) => ({ historyScan: s.scans[0], historyChanges: changesDemo(s).lastChanges })); await __h.scroll('.ui-modal-body', 100000)"),
  scene(
    'shop-alerts',
    "await patch((s) => ({ ...patchShop((x) => ({ lastScan: { ...x.lastOkScan, id: 77, status: 'error', error: 'Etsy не відповідає (тайм-аут 30 с). Перевірте інтернет і спробуйте ще раз.' }, lastOkScan: { ...x.lastOkScan, finishedAt: Date.now() - 2 * 86400000, buyerPrices: 'unavailable' }, reviews: x.reviews ? { ...x.reviews, lastError: 'Etsy не дозволяє читати відгуки цього магазину з цим ключем (HTTP 403). Товари скануються як і раніше.' } : x.reviews }))(s), keyStatus: { hasKey: false, masked: null, encrypted: false }, imageCounts: { total: 510, stored: 380, pending: 128, error: 2 }, imageSync: { running: false, shopId: null, done: 0, total: 0, errors: 0, lastError: 'MinIO недоступний (ECONNREFUSED). Запустіть: docker compose up -d', disabled: false } }))"
  ),
  scene('shop-alerts-scrolled', "await patch((s) => ({ ...patchShop((x) => ({ reviews: x.reviews ? { ...x.reviews, lastError: 'Etsy не дозволяє читати відгуки цього магазину з цим ключем (HTTP 403). Товари скануються як і раніше.' } : x.reviews }))(s), imageCounts: { total: 510, stored: 380, pending: 128, error: 2 }, imageSync: { running: false, shopId: null, done: 0, total: 0, errors: 0, lastError: 'MinIO недоступний (ECONNREFUSED). Запустіть: docker compose up -d', disabled: false } }))"),
  scene(
    'shop-syncing',
    "await patch((s) => ({ scanning: { [s.activeShopId]: true }, progress: { [s.activeShopId]: { shopId: s.activeShopId, phase: 'details', done: 100, total: 430, label: 'Деталі 100/430' } }, imageCounts: { total: 510, stored: 120, pending: 390, error: 0 }, imageSync: { running: true, shopId: s.activeShopId, done: 12, total: 390, errors: 0, lastError: null, disabled: false }, reviewSync: { [s.activeShopId]: { shopId: s.activeShopId, running: true, phase: 'backfill', stored: 3300, estimate: 9300, requests: 4, newReviews: 0, backfillComplete: false, budgetExhausted: false, error: null } } }))"
  ),
  scene(
    'shop-never-scanned',
    "await patch((s) => ({ ...patchShop(() => ({ lastOkScan: null, lastScan: null, stats: null, statsDelta: null, reviews: null }))(s), listings: [], lastChanges: [], scans: [], imageCounts: null }))"
  ),
  scene('shop-search-empty', "await reveal('.all-listings'); await setSearch('zzzz-nothing')"),
  scene('shop-search-empty-discount', "await reveal('.all-listings'); await setSearch('zzzz-nothing'); await __h.click('Зі знижкою', 'label'); await __h.sleep(300)"),
  scene(
    'shop-discount-empty',
    "await patch((s) => ({ listings: s.listings.map((l) => ({ ...l, buyerPrice: null })) })); await reveal('.all-listings'); await __h.click('Зі знижкою', 'label'); await __h.sleep(300)"
  ),
  scene('shop-price-tip', "await reveal('.all-listings'); await hover('.all-listings .card-price')"),
  scene(
    'shop-price-tip-sale',
    "await reveal('.all-listings'); const p = [...document.querySelectorAll('.all-listings .card-price')].find((x) => x.dataset.kind === 'discounted'); if (p) { p.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await __h.sleep(400) }"
  ),
  scene(
    'shop-delete-confirm',
    "const del = [...document.querySelectorAll('.shop-header button')].find((b) => b.textContent.trim() === 'Видалити'); if (del) { del.click() } else { await more(); await __h.click('Видалити', '[role=menuitem]') } await __h.sleep(500)"
  ),
  scene('shop-search', "await reveal('.all-listings'); await setSearch('planner')"),
  scene('shop-discount', "await reveal('.all-listings'); await __h.click('Зі знижкою', 'label'); await __h.sleep(300)"),
  scene('shop-history', "await __h.open('Історія сканувань'); await reveal('.history', 'end')"),
  scene(
    'shop-history-mixed',
    "await patch((s) => ({ scans: s.scans.map((x, i) => (i === 0 && x.status === 'ok' && !x.isBaseline ? { ...x, added: 0, returned: 0, removed: 0, changed: 0 } : i === 1 && x.status === 'ok' && !x.isBaseline ? { ...x, added: 2, changed: 3 } : x)) })); await __h.open('Історія сканувань'); await reveal('.history', 'end')"
  ),
  scene(
    'shop-history-modal',
    "await __h.open('Історія сканувань'); const b = [...document.querySelectorAll('.history-row')].find((x) => !x.disabled); if (b) b.click(); await __h.sleep(700)"
  ),
  scene(
    'shop-history-modal-scrolled',
    "await __h.open('Історія сканувань'); const b = [...document.querySelectorAll('.history-row')].find((x) => !x.disabled); if (b) b.click(); await __h.sleep(700); await __h.scroll('.ui-modal-body', 100000)"
  )
]
