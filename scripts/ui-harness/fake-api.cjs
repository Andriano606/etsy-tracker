// UI harness: a window.api for the built renderer, answered from
// .ui-harness/fixtures.json (+ features/<id>.cjs samples for feature:call).
// No Etsy, no MinIO, no real main process — screens only.

const fs = require('fs')
const path = require('path')

const mcpStatusBase = () => ({ enabled: true, allowWrites: false, port: 9102, url: 'http://127.0.0.1:9102/mcp', token: 'tok_demo-1234567890', tokenEncrypted: true, running: true, error: null, requests: 12, lastRequestAt: Date.now() - 60000, lastClient: 'claude-code' })

// Drafts for the drafts scenes when the fixtures' db has none, one per state the
// drafts window knows (the first three keep their places — viewer.cjs opens them by index):
//   0 a draft Claude prepared (photos + buyer files), never sent
//   1 sent and published, in sync          2 sent as an Etsy draft, in sync
//   3 published, edited here since (changed) 4 pulled from an Etsy draft (files only on Etsy)
//   5 edited here AND changed on Etsy (conflict) 6 deleted on Etsy (+ the send error)
//   7 never sent, the last send failed
// A photo's media id IS a fixture image id, so main.cjs serves etsyimg://draft/{id} from it.
const etsyListingUrl = (id) => `https://www.etsy.com/listing/${id}`
const etsyListingEditUrl = (id) => `https://www.etsy.com/your/shops/me/listing-editor/edit/${id}`
function link(listingId, state, over = {}) {
  const now = Date.now()
  return {
    listingId,
    state,
    url: state === 'active' ? etsyListingUrl(listingId) : null,
    editUrl: etsyListingEditUrl(listingId),
    dirty: false,
    syncedAt: now - 7200000,
    etsyUpdatedAt: Math.floor((now - 7300000) / 1000),
    changedOnEtsy: false,
    removed: state === 'removed',
    shopId: null,
    unverified: false,
    incomplete: false,
    ...over
  }
}
function sampleDrafts(fx, sample) {
  const ls = (fx.perShop[sample.id]?.listings ?? []).filter((l) => l.images.length)
  const photos = (l, n, onEtsy = false) =>
    l.images.slice(0, n).map((im, i) => ({ id: Number(im.id), kind: 'photo', position: i + 1, name: `photo-${i + 1}-${l.listingId}.jpg`, mime: 'image/jpeg', size: 180000 + i * 37000, onEtsy, remote: false }))
  const files = (base, names, onEtsy = false, remote = false) =>
    names.map((name, i) => ({ id: base + i, kind: 'file', position: i + 1, name, mime: 'application/pdf', size: 420000 + i * 913000, onEtsy: onEtsy || remote, remote }))
  const fields = (l, over = {}) => ({
    type: 'download', title: l.title, description: l.description, price: '5.99', quantity: 999, taxonomyId: 2,
    taxonomyPath: 'Paper & Party Supplies › Paper › Calendars & Planners', whoMade: 'i_did', whenMade: 'made_to_order', isSupply: false,
    tags: (l.tags ?? []).slice(0, 13), materials: [], shouldAutoRenew: true, shippingProfileId: null, readinessStateId: null, ...over
  })
  const now = Date.now()
  const base = { createdAt: now - 3 * 86400000, updatedAt: now - 3600000, sentAt: null, sentListingId: null, sentPublished: null, lastError: null, problems: [], etsy: null }
  const sent = (id, published, at) => ({ sentAt: at, sentListingId: id, sentPublished: published })
  const out = []
  const l = (i) => ls[i % Math.max(ls.length, 1)]
  if (!ls.length) return out
  out.push({ ...base, id: 901, source: 'mcp', status: 'draft', fields: fields(l(0)), photos: photos(l(0), 4),
    files: files(7001, ['Budget-Planner-2027-Google-Sheets-instructions-and-link-to-the-template-copy.pdf', 'Budget Planner — Excel.xlsx']) })
  out.push({ ...base, id: 902, source: 'app', status: 'sent', updatedAt: now - 7200000, ...sent(4512345678, true, now - 7200000), etsy: link(4512345678, 'active'),
    fields: fields(l(1)), photos: photos(l(1), 3, true), files: files(7101, ['Planner-A4.pdf', 'Planner-US-Letter.pdf', 'How-to-print-and-use-this-planner-at-home.pdf'], true) })
  out.push({ ...base, id: 903, source: 'mcp', status: 'sent', updatedAt: now - 86400000, ...sent(4512349999, false, now - 86400000),
    etsy: link(4512349999, 'draft', { syncedAt: now - 86400000 }), fields: fields(l(2)), photos: photos(l(2), 2, true), files: files(7201, ['Template.xlsx'], true) })
  // 3: published, then the price and a photo changed here — not sent yet.
  out.push({ ...base, id: 904, source: 'app', status: 'changed', updatedAt: now - 1800000, ...sent(4512351111, true, now - 5 * 86400000),
    etsy: link(4512351111, 'active', { dirty: true, syncedAt: now - 5 * 86400000 }),
    fields: fields(l(3), { price: '7.49' }), photos: [...photos(l(3), 2, true), ...photos(l(4), 1)], files: files(7301, ['Weekly-Planner.pdf'], true) })
  // 4: made on Etsy's site, pulled by the last scan; its buyer files exist only on Etsy.
  out.push({ ...base, id: 905, source: 'etsy', status: 'sent', updatedAt: now - 2400000, createdAt: now - 2400000, ...sent(4512352222, false, null),
    etsy: link(4512352222, 'draft', { syncedAt: now - 2400000 }),
    fields: fields(l(5), { taxonomyPath: 'Home & Living › Office › Planners', taxonomyId: 3 }), photos: photos(l(5), 3, true),
    files: files(7401, ['Habit-Tracker-2027.pdf', 'Habit-Tracker-2027-dark.pdf'], true, true) })
  // 5: edited here and, meanwhile, changed on Etsy too (a pull saw it) — sending asks before overwriting.
  out.push({ ...base, id: 906, source: 'app', status: 'changed', updatedAt: now - 600000, ...sent(4512353333, true, now - 4 * 86400000),
    etsy: link(4512353333, 'active', { dirty: true, changedOnEtsy: true, syncedAt: now - 4 * 86400000 }),
    fields: fields(l(6)), photos: photos(l(6), 2, true), files: files(7501, ['Meal-Planner.pdf'], true) })
  // 6: the listing was deleted on Etsy (found by the last send).
  out.push({ ...base, id: 907, source: 'mcp', status: 'error', updatedAt: now - 300000, ...sent(4512354444, true, now - 9 * 86400000),
    lastError: 'Цей товар видалено на Etsy, тож оновити його не вийде. Щоб надіслати чернетку як новий товар, спершу від’єднайте її від Etsy.',
    etsy: link(4512354444, 'removed', { dirty: true, syncedAt: now - 9 * 86400000 }),
    fields: fields(l(7)), photos: photos(l(7), 2, true), files: [...files(7601, ['Savings-Tracker.pdf'], true), ...files(7611, ['Savings-Tracker-print.pdf'], true, true)] })
  // 7: never sent; the last send failed.
  out.push({ ...base, id: 908, source: 'app', status: 'error', updatedAt: now - 120000, lastError: 'Etsy не відповідає (тайм-аут 30 с). Спробуйте ще раз.',
    fields: fields(l(8)), photos: photos(l(8), 1), files: files(7701, ['Cleaning-Schedule.pdf']) })
  return out
}

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
  const drafts = fx.drafts?.length ? fx.drafts : sampleDrafts(fx, sample)
  const ctx = { fx, own, sample, myListings, allListings }
  let mcp = { enabled: true, allowWrites: false }
  let copyFail = false
  // The last Etsy-drafts pull (after the latest scan of the own shop).
  const pull = {
    running: false,
    lastAt: Date.now() - 2400000,
    lastSummary: { imported: 1, updated: 1, removed: 0, conflicts: 1, errors: [] },
    error: null
  }
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
    listDrafts: async () => drafts,
    saveDraftMedia: async (id) => ok({ path: `/home/andrii/Завантаження/${[...drafts.flatMap((d) => d.files)].find((m) => m.id === id)?.name ?? 'file'}` }),
    // Saving answers like main: the same draft with the new fields (a linked one becomes "changed"); media as stored.
    saveDraft: async (input) => {
      const d = drafts.find((x) => x.id === input.id)
      if (!d) return ok({ ...(drafts[0] ?? {}), id: input.id ?? 900, source: 'app', fields: input.fields, photos: [], files: [], status: 'draft', problems: [], etsy: null, lastError: null })
      const etsy = d.etsy && { ...d.etsy, dirty: true }
      return ok({ ...d, fields: input.fields, updatedAt: Date.now(), etsy, status: d.lastError ? 'error' : etsy ? 'changed' : 'draft' })
    },
    deleteDraft: async (_id, o) => ok({ deletedOnEtsy: !!o?.onEtsy }),
    // The conflict draft answers with the overwrite question; an overwrite or any other send is refused (no Etsy here).
    sendDraft: async (id, _publish, o) =>
      id === 906 && !o?.overwrite
        ? {
            ok: false,
            conflict: true,
            error: `На Etsy цей товар змінили після останньої синхронізації (${new Date(Date.now() - 86400000).toLocaleString('uk-UA')}). Надіслати все одно й перезаписати ті зміни?`
          }
        : { ok: false, error: '(стенд) надсилання вимкнено' },
    unlinkDraft: async (id) => {
      const d = drafts.find((x) => x.id === id)
      if (!d) return { ok: false, error: `Чернетки #${id} немає.` }
      const gone = d.files.filter((f) => f.remote)
      return ok({
        ...d, status: 'draft', etsy: null, sentAt: null, sentListingId: null, sentPublished: null, lastError: null,
        photos: d.photos.map((m) => ({ ...m, onEtsy: false })),
        files: d.files.filter((f) => !f.remote).map((m, i) => ({ ...m, onEtsy: false, position: i + 1 })),
        notes: gone.length
          ? [`Файли, що були лише на Etsy, прибрано з чернетки (Etsy не дає їх завантажити, тож надіслати їх знову не вийде): ${gone.map((f) => `«${f.name}»`).join(', ')}. Додайте їх ще раз зі свого комп’ютера.`]
          : undefined
      })
    },
    // Slow enough for a scene to catch "Синхронізація з Etsy…"; answers with a per-listing error to show the warning.
    pullDrafts: () =>
      new Promise((r) =>
        setTimeout(
          () => r(ok({ imported: 2, updated: 1, removed: 1, conflicts: 1, errors: ['«Habit Tracker 2027 — Printable PDF, Digital Download, A4 / US Letter»: Etsy не відповідає (тайм-аут 30 с). Спробуйте ще раз.'] })),
          1800
        )
      ),
    getDraftsPullState: async () => pull,
    onDraftsChanged: nop,
    onDraftsPull: nop,
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
    // Scenes call __setCopyFail(true) to show the "Не вдалося скопіювати" feedback.
    copyText: async () => !copyFail,
    __setCopyFail: async (v) => {
      copyFail = !!v
    },
    openExternal: async () => true
  }
}
