// UI harness scenes: "Мій магазин" and the drafts window (see ../main.cjs). Each starts from a fresh app (first shop selected).
// Run the sign-in scenes with --signed-out (myshop-signin, myshop-signin-paste); the rest signed in.

// Clicks a shop-header action by its label, also when the action bar moved it into its "⋯" menu (narrow windows).
const ACTION = `
const action = async (label) => {
  const b = __h.find(label, '.shop-header button, .shop-head-row button')
  if (b) return __h.click(b)
  await __h.clickSel('.shop-header .ui-actionbar-more button, .shop-head-row .ui-actionbar-more button')
  await __h.click(label, '[role=menuitem]')
}
const own = async () => { await __h.click('TidyFoxSheets', '.shop-item'); await __h.sleep(200) }
const openMyShop = async () => {
  const side = __h.find('Мій магазин', '.sidebar button')
  if (side) await __h.click(side)
  else { await own(); await action('Керувати') }
  await __h.sleep(500)
}
const tab = async (label) => { await __h.click(label, '[role=tab]'); await __h.sleep(600) }
const openDrafts = async () => { await own(); await action('Чернетки'); await __h.sleep(300) }
const newDraft = async () => {
  await own()
  await action('Новий товар')
  await __h.sleep(400)
}
// Opens the first draft of the list (fixtures with drafts only; otherwise the list stays).
const firstDraft = async () => { await openDrafts(); const b = __h.find('Відкрити', '.my-rows button'); if (b) await __h.click(b); await __h.sleep(300) }
`

const scene = (name, code) => ({ name, code: ACTION + code })

const TABS = [
  ['myshop-tab-inventory', 'Ціни й залишки'],
  ['myshop-tab-orders', 'Замовлення'],
  ['myshop-tab-finance', 'Фінанси'],
  ['myshop-tab-profile', 'Профіль магазину'],
  ['myshop-tab-sections', 'Розділи'],
  ['myshop-tab-shipping', 'Доставка'],
  ['myshop-tab-processing', 'Обробка'],
  ['myshop-tab-returns', 'Повернення'],
  ['myshop-tab-holidays', 'Свята'],
  ['myshop-tab-partners', 'Партнери'],
  ['myshop-tab-account', 'Акаунт']
]

module.exports = [
  // ---- signed out (--signed-out) ----
  scene('myshop-signin', 'await openMyShop()'),
  scene('myshop-signin-paste', "await openMyShop(); await __h.click('Увійти через Etsy', 'button'); await __h.scroll('.ui-modal-body', 2000)"),
  scene('myshop-signin-tip', "await openMyShop(); await __h.clickSel('.my-steps .ui-field .ui-infotip')"),

  // ---- signed in: the tabs ----
  scene('myshop', 'await openMyShop()'),
  scene('myshop-filter-drafts', "await openMyShop(); await __h.click('Чернетки', '.my-toolbar label'); await __h.sleep(400)"),
  scene('myshop-tab-tip', "await openMyShop(); await __h.clickSel('.my-signedin .ui-infotip')"),
  ...TABS.map(([name, label]) => scene(name, `await openMyShop(); await tab('${label}')`)),
  scene('myshop-tab-profile-bottom', "await openMyShop(); await tab('Профіль магазину'); await __h.scroll('.my-shop-tabs > .ui-tabpanel', 3000)"),

  // ---- the listing editor ----
  scene('myshop-edit', "await openMyShop(); await __h.click('Редагувати', 'button'); await __h.sleep(300)"),
  scene(
    'myshop-edit-bottom',
    "await openMyShop(); await __h.click('Редагувати', 'button'); await __h.scroll('.my-shop-tabs > .ui-tabpanel', 4000)"
  ),
  scene(
    'myshop-edit-section',
    "await openMyShop(); await __h.click('Редагувати', 'button'); await __h.open('Фото, відео й файли'); await __h.scroll('.my-shop-tabs > .ui-tabpanel', 900)"
  ),
  scene(
    'myshop-edit-invalid',
    "await openMyShop(); await __h.click('Редагувати', 'button'); await __h.type('Теги', 'budget/plan, a very very long tag text here, ok'); await __h.scroll('.my-shop-tabs > .ui-tabpanel', 380)"
  ),
  // Unsaved edits + Escape: the "Закрити без збереження?" question.
  scene(
    'myshop-edit-dirty-close',
    "await openMyShop(); await __h.click('Редагувати', 'button'); await __h.type('Назва', 'Нова назва товару'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await __h.sleep(400)"
  ),
  // Unsaved edits + another tab.
  scene(
    'myshop-edit-dirty-tab',
    "await openMyShop(); await __h.click('Редагувати', 'button'); await __h.type('Теги', 'budget, planner'); await __h.click('Профіль магазину', '[role=tab]')"
  ),
  scene(
    'myshop-edit-sections-list',
    "await openMyShop(); await __h.click('Редагувати', 'button'); const m = document.querySelector('.my-more'); const p = document.querySelector('.my-shop-tabs > .ui-tabpanel'); if (m && p) p.scrollTop = m.offsetTop - 8; await __h.sleep(300)"
  ),
  scene(
    'myshop-edit-publish',
    "await openMyShop(); await __h.click('Чернетки', '.my-toolbar label'); await __h.sleep(400); await __h.click('Редагувати', 'button'); await __h.click('Опублікувати', '.my-state label'); await __h.scroll('.my-shop-tabs > .ui-tabpanel', 700)"
  ),

  // ---- drafts ----
  scene('drafts', 'await openDrafts()'),
  scene('draft-new', 'await newDraft()'),
  scene('draft-new-middle', "await newDraft(); await __h.scroll('.ui-modal-body', 700)"),
  scene('draft-new-bottom', "await newDraft(); await __h.scroll('.ui-modal-body', 5000)"),
  scene(
    'draft-new-physical',
    "await newDraft(); await __h.click('Фізичний', '.ui-seg-item'); await __h.sleep(400); await __h.scroll('.ui-modal-body', 1500)"
  ),
  scene(
    'draft-new-category',
    "await newDraft(); await __h.type('Категорія', 'plan'); await __h.scroll('.ui-modal-body', 450)"
  ),
  // The first draft in the list (a draft Claude prepared, when the fixtures have one).
  scene('draft-open', 'await firstDraft()'),
  // A failed send (the harness never sends): the reason shows in the sticky save bar, where the button is.
  scene(
    'draft-send-error',
    "await firstDraft(); const b = __h.find('Надіслати на Etsy як чернетку', '.my-savebar button'); if (b && !b.disabled) { await __h.click(b); await __h.click('Підтвердити', '[role=alertdialog] button'); await __h.sleep(800) }"
  ),
  // A new draft with something typed + × : the "Закрити без збереження?" question.
  scene(
    'draft-dirty-close',
    "await newDraft(); await __h.type('Назва', 'Планер бюджету 2027'); await __h.clickSel('.drafts-modal .ui-modal-close')"
  )
]
