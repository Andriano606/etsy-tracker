// UI harness scenes: own-shop feature tabs (shopConfig, orders) (see ../main.cjs). Each starts from a fresh app (first shop selected).
// `go(tab)` opens "Мій магазин" (sidebar button, else the own shop's "Керувати") and the tab — from the "Ще" menu when it doesn't fit.

const GO = `
const openMy = async () => {
  const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && /Мій магазин/.test(e.textContent))
  if (b) await __h.click(b)
  else { await __h.click('TidyFoxSheets', '.shop-item'); await __h.click('Керувати') }
  await __h.sleep(500)
}
const go = async (name) => {
  await openMy()
  const t = [...document.querySelectorAll('[role=tab]')].find((e) => e.offsetParent !== null && e.textContent.trim().startsWith(name))
  if (t) await __h.click(t)
  else {
    await __h.clickSel('.ui-tabs-more button')
    const m = [...document.querySelectorAll('[role^=menuitem]')].find((e) => e.textContent.includes(name))
    if (!m) throw new Error('no tab ' + name)
    await __h.click(m)
  }
  await __h.sleep(700)
}
const into = async (css) => { const el = await __h.waitFor(css); el.scrollIntoView({ block: 'start' }); await __h.sleep(300) }
const btn = async (text, root = document) => {
  const b = [...root.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.trim() === text)
  if (!b) throw new Error('no button ' + text)
  await __h.click(b)
}
`

const scene = (name, code) => ({ name, code: GO + code })

module.exports = [
  // ---- Розділи
  scene('sc-sections', "await go('Розділи')"),
  scene('sc-sections-rename', "await go('Розділи'); await btn('Перейменувати'); await __h.sleep(200)"),
  scene('sc-sections-tip', "await go('Розділи'); await __h.clickSel('.fx-intro .ui-infotip')"),
  // ---- Доставка
  scene('sc-shipping', "await go('Доставка')"),
  scene('sc-shipping-new', "await go('Доставка'); await btn('Новий профіль доставки'); await into('[data-testid=sc-profile-create]')"),
  scene('sc-shipping-new-2', "await go('Доставка'); await btn('Новий профіль доставки'); await into('[data-testid=sc-profile-create] .fx-step:nth-of-type(3)')"),
  scene('sc-profile', "await go('Доставка'); await btn('Відкрити'); await __h.sleep(400)"),
  scene('sc-profile-dest', "await go('Доставка'); await btn('Відкрити'); await __h.sleep(400); await into('[data-testid=sc-destinations]')"),
  scene('sc-profile-upg', "await go('Доставка'); await btn('Відкрити'); await __h.sleep(400); await into('[data-testid=sc-upgrades]')"),
  scene(
    'sc-dest-form',
    "await go('Доставка'); await btn('Відкрити'); await __h.sleep(400); await btn('Додати напрямок'); await __h.type('Вартість за один товар', '6,5'); await __h.type('За кожен наступний товар', '2'); await into('[data-testid=sc-destination-form]')"
  ),
  scene(
    'sc-dest-carrier',
    "await go('Доставка'); await btn('Відкрити'); await __h.sleep(400); const d = [...document.querySelectorAll('[data-testid=sc-destinations] button')].filter((b) => b.textContent.trim() === 'Змінити')[1]; await __h.click(d); await into('[data-testid=sc-destination-form] .fx-step:nth-of-type(3)')"
  ),
  scene('sc-upg-form', "await go('Доставка'); await btn('Відкрити'); await __h.sleep(400); await btn('Додати прискорену доставку'); await into('[data-testid=sc-upgrade-form]')"),
  // ---- Обробка
  scene('sc-processing', "await go('Обробка')"),
  scene('sc-processing-form', "await go('Обробка'); await btn('Новий профіль підготовки'); await into('[data-testid=sc-processing-form]')"),
  // (scoped to the tab: at 1680 px the shop view's own "Видалити" is visible behind the modal)
  scene(
    'sc-processing-del',
    "await go('Обробка'); await btn('Видалити', await __h.waitFor('[data-testid=sc-processing] table')); await __h.sleep(300); await btn('Видалити профіль'); await __h.sleep(300)"
  ),
  scene('sc-processing-confirm', "await go('Обробка'); await btn('Видалити', await __h.waitFor('[data-testid=sc-processing] table')); await __h.sleep(400)"),
  scene(
    'sc-processing-invalid',
    "await go('Обробка'); await btn('Новий профіль підготовки'); await __h.type('Від', '5'); await __h.type('До', '2'); await into('[data-testid=sc-processing-form] .fx-step:nth-of-type(2)')"
  ),
  // ---- Повернення
  scene('sc-returns', "await go('Повернення')"),
  scene('sc-returns-listings', "await go('Повернення'); await btn('Товари', document.querySelector('[data-testid=sc-returns] table'));await into('[data-testid=sc-policy-listings]')"),
  scene('sc-returns-form', "await go('Повернення'); await btn('Нові правила'); await into('[data-testid=sc-return-form]')"),
  scene('sc-returns-merge', "await go('Повернення'); await into('[data-testid=sc-consolidate]')"),
  // ---- Свята, Партнери
  scene('sc-holidays', "await go('Свята')"),
  scene('sc-partners', "await go('Партнери')"),
  // ---- Замовлення
  scene('ord-list', "await go('Замовлення')"),
  scene('ord-filters', "await go('Замовлення'); await __h.open('Фільтри і порядок')"),
  scene('ord-detail', "await go('Замовлення'); await btn('Відкрити'); await __h.sleep(400)"),
  scene('ord-detail-2', "await go('Замовлення'); await btn('Відкрити'); await __h.sleep(400); await into('[data-testid=order-items]')"),
  scene(
    'ord-detail-pay',
    "await go('Замовлення'); await btn('Відкрити'); await __h.sleep(400); await __h.open('Платіж'); await __h.open('Товари цього замовлення'); await into('[data-testid=order-payments]')"
  ),
  scene('ord-ship', "await go('Замовлення'); await btn('Відкрити'); await __h.sleep(400); await btn('Як відправити'); await __h.sleep(500)"),
  scene(
    'ord-shipped',
    "await go('Замовлення'); const b = [...document.querySelectorAll('[data-testid^=order-row] button')][4]; await __h.click(b); await __h.sleep(400)"
  ),
  scene('ord-canceled', "await go('Замовлення'); await __h.click(await __h.waitFor('[data-testid=order-row-3300006] button')); await __h.sleep(400); await into('[data-testid=ship-anyway]')"),
  scene(
    'ord-unpaid-anyway',
    "await go('Замовлення'); await __h.click(await __h.waitFor('[data-testid=order-row-3300004] button')); await __h.sleep(400); await __h.open('Все одно позначити'); await __h.sleep(300); await into('[data-testid=ship-anyway]')"
  ),
  scene('ord-finance', "await go('Фінанси')"),
  scene('ord-finance-entries', "await go('Фінанси'); await into('[data-testid=ledger-entries]')"),
  scene(
    'ord-finance-open',
    "await go('Фінанси'); const r = await __h.waitFor('[data-testid=entry-880004]'); await btn('Пов’язаний запис', r); await into('[data-testid=entry-880004]')"
  ),
  scene('ord-finance-sales', "await go('Фінанси'); await __h.open('Продажі за товарами'); await into('[data-testid=sales-by-listing]')"),
  // ---- the own listing's sections
  scene(
    'own-listing-section',
    "await go('Товари'); await btn('Редагувати'); await __h.sleep(400); await __h.open('Розділ магазину'); await into('[data-testid=sc-listing-section]')"
  ),
  scene('ord-detail-tip', "await go('Замовлення'); await btn('Відкрити'); await __h.sleep(400); await into('[data-testid=order-totals]'); await __h.clickSel('[data-testid=order-totals] .ui-infotip')"),
  scene(
    'own-listing-sales',
    "await go('Товари'); await btn('Редагувати'); await __h.sleep(400); await __h.open('Продажі'); await __h.open('Розділ магазину'); await into('[data-testid=listing-sales]')"
  )
]
