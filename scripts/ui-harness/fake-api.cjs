// UI harness: a window.api for the built renderer, answered from
// .ui-harness/fixtures.json (+ features/<id>.cjs samples for feature:call).
// No Etsy, no MinIO, no real main process — screens only.

const fs = require('fs')
const path = require('path')

const mcpStatusBase = () => ({ enabled: true, allowWrites: false, port: 9102, url: 'http://127.0.0.1:9102/mcp', token: 'tok_demo-1234567890', tokenEncrypted: true, running: true, error: null, requests: 12, lastRequestAt: Date.now() - 60000, lastClient: 'claude-code' })

module.exports = function fakeApi(fx, opts = {}) {
  const allListings = Object.values(fx.perShop).flatMap((p) => p.listings)
  const own = fx.shops.find((s) => s.shopName === 'TidyFoxSheets') ?? fx.shops[0]
  const sample = fx.shops.find((s) => s.shopName === 'SimplyOrganizedPro') ?? fx.shops[0]
  const ok = (value) => Promise.resolve({ ok: true, value })
  const nop = () => () => {}
  const signedIn = !opts.signedOut
  const auth = signedIn
    ? {
        loggedIn: true,
        redirectUri: 'https://localhost:3003/callback',
        pending: false,
        encrypted: true,
        userId: 555,
        shopId: own.id,
        shopName: own.shopName,
        scopes: ['listings_r', 'listings_w', 'listings_d', 'shops_r', 'shops_w', 'transactions_r', 'transactions_w', 'email_r', 'address_r'],
        signedInAt: Date.now() - 86400000,
        reloginBy: Date.now() + 89 * 86400000
      }
    : { loggedIn: false, redirectUri: 'https://localhost:3003/callback', pending: false, encrypted: false }
  const myListings = (fx.perShop[sample.id]?.listings ?? []).slice(0, 12).map((l, i) => ({
    listingId: l.listingId,
    state: ['active', 'active', 'draft', 'inactive', 'expired'][i % 5],
    title: l.title,
    description: l.description,
    tags: l.tags,
    materials: l.details?.materials ?? [],
    shouldAutoRenew: true,
    type: l.details?.listingType ?? 'download',
    priceAmount: l.priceAmount,
    priceDivisor: l.priceDivisor,
    currency: l.currency,
    quantity: l.quantity,
    url: l.url,
    imageUrl: fx.images[l.images[0]?.id]?.['170x135'] ?? null,
    updatedAt: l.etsyUpdatedAt,
    endingAt: null
  }))
  const features = {}
  const dir = path.join(__dirname, 'features')
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (f.endsWith('.cjs')) features[f.replace(/\.cjs$/, '')] = require(path.join(dir, f))
  }
  const ctx = { fx, own, sample, myListings, allListings }
  let mcp = { enabled: true, allowWrites: false }
  return {
    getKeyStatus: async () => ({ hasKey: true, masked: '1uix…gukx', encrypted: true }),
    setApiKey: async () => ({ ok: true, status: { hasKey: true, masked: '1uix…gukx', encrypted: true } }),
    clearApiKey: async () => ({ hasKey: false, masked: null, encrypted: false }),
    testApiKey: async () => ({ ok: true, message: 'Ключ працює (application_id 1234567).' }),
    listShops: async () => fx.shops,
    addShop: async () => ({ ok: false, error: '(стенд) додавання вимкнено' }),
    removeShop: async () => ({ ok: true }),
    onShopsChanged: nop,
    listListings: async (id) => fx.perShop[id]?.listings ?? [],
    getListing: async (id) => allListings.find((l) => l.listingId === id) ?? null,
    getListingRaw: async (id) => fx.listingExtras[id]?.raw ?? null,
    getListingStats: async (id) => fx.listingExtras[id]?.stats ?? [],
    listScans: async (id) => fx.perShop[id]?.scans ?? [],
    getScanChanges: async (scanId) => {
      for (const p of Object.values(fx.perShop)) if (p.scanChanges[scanId]) return p.scanChanges[scanId]
      return []
    },
    getScanPromotions: async () => ({ started: [], ended: [] }),
    getListingPromotions: async (id) => fx.listingExtras[id]?.promotions ?? [],
    getBuyerCountry: async () => 'UA',
    setBuyerCountry: async (c) => ({ ok: true, country: c }),
    getListingReviews: async (id) => fx.listingExtras[id]?.reviews ?? { total: 0, offset: 0, reviews: [] },
    getNewReviews: async () => [],
    syncReviews: async () => undefined,
    onReviewSync: nop,
    getShopStats: async (id, range) => fx.perShop[id]?.stats?.[range] ?? null,
    scanShop: async (shopId) => ({ ok: false, shopId, error: '(стенд) сканування вимкнено' }),
    scanAll: async () => [],
    onScanProgress: nop,
    onScanState: nop,
    getQuota: async () => ({ limitPerDay: 5000, remainingToday: 4211, limitPerSecond: 5, remainingThisSecond: 4, at: Date.now() }),
    getMinioStatus: async () => ({ enabled: true, endpoint: 'http://127.0.0.1:9100', accessKey: 'etsytracker', bucket: 'etsy-tracker', secretSource: 'default', encrypted: false }),
    setMinio: async (i) => ({ ok: true, status: { enabled: true, endpoint: 'http://127.0.0.1:9100', accessKey: 'etsytracker', bucket: 'etsy-tracker', secretSource: 'stored', encrypted: true, ...i } }),
    testMinio: async () => ({ ok: true, message: 'З’єднання є.' }),
    getImageStatus: async (id) => ({ counts: fx.perShop[id]?.imageCounts ?? { total: 0, stored: 0, pending: 0, error: 0 }, sync: { running: false, shopId: null, done: 0, total: 0, errors: 0, lastError: null, disabled: false } }),
    syncImages: async () => ({ running: true, shopId: null, done: 0, total: 10, errors: 0, lastError: null, disabled: false }),
    onImageSync: nop,
    onQuota: nop,
    getEtsyAuth: async () => auth,
    beginEtsyLogin: async () => ok('https://www.etsy.com/oauth/connect?response_type=code'),
    completeEtsyLogin: async () => ok(auth),
    logoutEtsy: async () => auth,
    onEtsyAuth: nop,
    getMyShop: async () =>
      ok({ shopId: own.id, shopName: own.shopName, title: own.title ?? 'Tidy spreadsheets for busy people', announcement: 'Welcome! New templates every week.', saleMessage: 'Thank you for your order!', digitalSaleMessage: 'Your files are ready to download.', policyAdditional: '', inEu: false, countryIso: 'UA' }),
    saveMyShop: async (patch) => ok({ shopId: own.id, shopName: own.shopName, title: '', announcement: '', saleMessage: '', digitalSaleMessage: '', policyAdditional: '', inEu: false, countryIso: 'UA', ...patch }),
    getMyListings: async (state, offset = 0) => {
      const rows = myListings.filter((l) => l.state === state)
      return ok({ state, total: rows.length, offset, listings: rows.slice(offset) })
    },
    saveMyListing: async (id, patch) => ok({ ...myListings.find((l) => l.listingId === id), ...patch }),
    pickListingFiles: async () => [],
    getTaxonomy: async () =>
      ok([
        { id: 1, path: 'Paper & Party Supplies' },
        { id: 2, path: 'Paper & Party Supplies › Paper › Calendars & Planners' },
        { id: 3, path: 'Home & Living › Office › Planners' }
      ]),
    getShippingProfiles: async () => ok([{ id: 11, label: 'Standard (з UA)' }]),
    getProcessingProfiles: async () => ok([{ id: 21, label: '1–3 дн.' }]),
    listDrafts: async () => fx.drafts ?? [],
    saveDraft: async (input) => ok({ ...(fx.drafts?.[0] ?? {}), id: input.id ?? 900, fields: input.fields, photos: [], files: [], status: 'draft', problems: [] }),
    deleteDraft: async () => true,
    sendDraft: async () => ({ ok: false, error: '(стенд) надсилання вимкнено' }),
    onDraftsChanged: nop,
    featureCall: async (feature, action, args) => {
      const f = features[feature]?.[action]
      if (!f) return { ok: false, error: `(стенд) немає тестових даних для ${feature}.${action}` }
      try {
        const v = await f(args ?? {}, ctx)
        return v && typeof v === 'object' && 'ok' in v ? v : { ok: true, value: v }
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) }
      }
    },
    onFeatureEvent: nop,
    onCreateListingProgress: nop,
    getMcpStatus: async () => ({ ...mcpStatusBase(), ...mcp }),
    __unused: async () => ({ enabled: true, allowWrites: false, port: 9102, url: 'http://127.0.0.1:9102/mcp', token: 'tok_demo-1234567890', tokenEncrypted: true, running: true, error: null, requests: 12, lastRequestAt: Date.now() - 60000, lastClient: 'claude-code' }),
    setMcp: async (i) => {
      mcp = { ...mcp, ...(i.enabled !== undefined ? { enabled: !!i.enabled } : {}), ...(i.allowWrites !== undefined ? { allowWrites: !!i.allowWrites } : {}) }
      return { ok: true, status: { ...mcpStatusBase(), ...mcp, running: mcp.enabled } }
    },
    __unused2: async (i) => ({ ok: true, status: { enabled: true, allowWrites: !!i.allowWrites, port: 9102, url: 'http://127.0.0.1:9102/mcp', token: 'tok_demo-1234567890', tokenEncrypted: true, running: true, error: null, requests: 12, lastRequestAt: Date.now(), lastClient: 'claude-code' } }),
    regenerateMcpToken: async () => ({ enabled: true, allowWrites: false, port: 9102, url: 'http://127.0.0.1:9102/mcp', token: 'tok_new', tokenEncrypted: true, running: true, error: null, requests: 0, lastRequestAt: null, lastClient: null }),
    copyText: async () => true,
    openExternal: async () => true
  }
}
