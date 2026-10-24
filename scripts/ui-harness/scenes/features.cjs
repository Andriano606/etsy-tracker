// UI harness scenes: features — "Пошук по Etsy", the shop's "Більше" window, the
// live listing panels, "Мій магазин → Акаунт" (see ../main.cjs). Each starts from
// a fresh app (first shop selected). Samples: ../features/{market,compete,account}.cjs;
// `uih(mode)` switches them to an error/empty state (document.documentElement.dataset.uih).

// Helpers for the scene code: find a visible button (or a menu item behind a "⋯"/"Ще" menu) by text.
const P = `
const uih = (m) => { document.documentElement.dataset.uih = m }
const visible = (e) => e && e.offsetParent !== null
const named = (e) => ((e.getAttribute('aria-label') || '') + ' ' + e.textContent).replace(/\\s+/g, ' ').trim()
const findBtn = (re, sel = 'button, [role=tab]') => [...document.querySelectorAll(sel)].find((b) => visible(b) && re.test(named(b)))
async function press(re) {
  let b = findBtn(re)
  if (!b) {
    for (const m of [...document.querySelectorAll('[aria-haspopup=menu]')].filter(visible)) {
      m.click(); await __h.sleep(300)
      b = findBtn(re, '[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=tab]')
      if (b) break
      m.click(); await __h.sleep(200)
    }
  }
  if (!b) throw new Error('no button ' + re)
  b.click(); await __h.sleep(450)
}
async function openPanel(testId) {
  const d = await __h.waitFor('[data-testid="' + testId + '"]')
  d.open = true
  await __h.sleep(700)
  d.scrollIntoView({ block: 'start' })
  await __h.sleep(250)
}
const market = async () => { await press(/Пошук по Etsy/); await __h.waitFor('.market-search') }
const search = async (words) => { await market(); await __h.type('Ключові слова', words); await press(/^Шукати$/); await __h.sleep(500) }
const more = async () => { await press(/^Більше/); await __h.waitFor('.shop-panels-modal') }
const listing = async () => { await __h.clickSel('.listing-card'); await __h.sleep(700) }
async function account() {
  // Signed in with the own shop tracked: its header's "Керувати"; otherwise the sidebar's "Мій магазин".
  if (findBtn(/Мій магазин/)) await press(/Мій магазин/)
  else { findBtn(/TidyFoxSheets/).click(); await __h.sleep(700); await press(/^Керувати$/) }
  await __h.sleep(600); await press(/^Акаунт$/); await __h.sleep(600)
}
`
const scene = (name, code) => ({ name, code: P + code })

module.exports = [
  // ---- Пошук по Etsy ----
  scene('market', 'await market()'),
  scene('market-results', "await search('budget')"),
  scene('market-results-scrolled', "await search('budget'); await __h.scroll('.ui-modal-body', 700)"),
  scene('market-results-end', "await search('planner'); await __h.scroll('.ui-modal-body', 99999)"),
  scene('market-category', "await market(); await __h.type('Категорія', 'planner'); await __h.sleep(300)"),
  // ↓ twice: the second suggestion is highlighted (combobox keyboard).
  scene(
    'market-category-keys',
    "await market(); await __h.type('Категорія', 'planner'); await __h.sleep(300); const i = document.getElementById('market-cat'); for (const k of ['ArrowDown', 'ArrowDown']) i.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); await __h.sleep(200)"
  ),
  scene(
    'market-category-props',
    "await market(); await __h.type('Категорія', 'planner'); await __h.click('Paper & Party Supplies › Paper › Calendars & Planners', '[role=option]'); await openPanel('market-category-properties')"
  ),
  scene('market-empty', "await search('zzzz nothing')"),
  scene('market-error', "uih('error'); await search('budget')"),
  scene('market-loading', "uih('slow'); await market(); await __h.type('Ключові слова', 'budget'); await press(/^Шукати$/); await __h.scroll('.ui-modal-body', 400)"),
  scene(
    'market-follow',
    "await search('budget'); const b = findBtn(/Стежити за магазином/); b.scrollIntoView({ block: 'center' }); b.click(); await __h.sleep(600)"
  ),
  scene('market-tip', "await search('budget'); document.querySelector('.market-card .ui-infotip').click(); await __h.sleep(300)"),

  // ---- "Більше" window of a tracked shop ----
  scene('more', 'await more()'),
  scene('more-sections', "await more(); await openPanel('shop-panel-compete-sections')"),
  scene(
    'more-section-open',
    // No manual scrolling: the opened section must bring itself into view.
    "await more(); await openPanel('shop-panel-compete-sections'); [...document.querySelectorAll('button')].filter((b) => /^Відкрити$/.test(b.textContent.trim()))[3].click(); await __h.sleep(900)"
  ),
  scene('more-featured', "await more(); await openPanel('shop-panel-compete-featured')"),
  scene('more-policies', "await more(); await openPanel('shop-panel-compete-return-policies')"),
  scene('more-error', "uih('error'); await more(); await openPanel('shop-panel-compete-sections'); await openPanel('shop-panel-compete-featured')"),
  scene('more-empty', "uih('empty'); await more(); await openPanel('shop-panel-compete-sections'); await openPanel('shop-panel-compete-featured'); await openPanel('shop-panel-compete-return-policies')"),

  // ---- live panels at the bottom of a listing window ----
  scene('lp-list', "await listing(); document.querySelector('[data-testid=listing-panel-compete-properties]').scrollIntoView({ block: 'start' }); await __h.sleep(300)"),
  scene('lp-properties', "await listing(); await openPanel('listing-panel-compete-properties')"),
  scene('lp-media', "await listing(); await openPanel('listing-panel-compete-media')"),
  scene(
    'lp-media-details',
    "await listing(); await openPanel('listing-panel-compete-media'); [...document.querySelectorAll('button')].filter((b) => /^Деталі$/.test(b.textContent.trim()))[0].click(); await __h.sleep(900)"
  ),
  scene('lp-personalization', "await listing(); await openPanel('listing-panel-compete-personalization')"),
  scene(
    'lp-translation',
    "await listing(); await openPanel('listing-panel-compete-translation'); const s = document.getElementById('compete-lang'); s.value = 'de'; s.dispatchEvent(new Event('change', { bubbles: true })); await __h.sleep(200); await press(/^Показати переклад$/); await __h.sleep(500)"
  ),
  scene('lp-variations', "await listing(); await openPanel('listing-panel-compete-variation-images')"),
  scene('lp-shipping', "await listing(); await openPanel('listing-panel-compete-shipping'); await press(/^Показати служби$/); await __h.sleep(400)"),
  scene(
    'lp-shipping-ua',
    "await listing(); await openPanel('listing-panel-compete-shipping'); const s = document.getElementById('compete-carrier-country'); s.value = 'UA'; s.dispatchEvent(new Event('change', { bubbles: true })); await __h.sleep(200); await press(/^Показати служби$/); await __h.sleep(400)"
  ),
  scene('lp-shipping-profile', "uih('profile'); await listing(); await openPanel('listing-panel-compete-shipping')"),
  scene('lp-reviews', "await listing(); await openPanel('listing-panel-compete-reviews')"),
  scene('lp-error', "uih('error'); await listing(); await openPanel('listing-panel-compete-properties'); await openPanel('listing-panel-compete-media')"),
  scene('lp-empty', "uih('empty'); await listing(); await openPanel('listing-panel-compete-media'); await openPanel('listing-panel-compete-personalization')"),

  // ---- Мій магазин → Акаунт ----
  scene('account', 'await account()'),
  scene('account-limited', "uih('limited'); await account()"),
  scene('account-error', "uih('error'); await account()")
]
