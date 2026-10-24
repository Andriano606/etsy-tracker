// UI harness scenes: shell — sidebar, add shop, confirm, first run (see ../main.cjs). Each starts from a fresh app (first shop selected).
// The "no key" first-run screen can't be reached here (the fake API always has a key) — it is covered in
// tests/renderer/components/App.test.tsx. "No shops" is reached by deleting every shop (the fake API allows it).

// Asks to delete the open shop: its "Видалити" button, or the same action in the header's "⋯" menu.
const askDelete = `
  const btn = [...document.querySelectorAll('.main button')].find((b) => b.offsetParent && /^Видалити( магазин)?$/.test(b.textContent.trim()))
  if (btn) { btn.click(); await __h.sleep(350) }
  else { await __h.clickSel('.main .ui-actionbar-more button'); await __h.click('Видалити', '[role=menuitem]') }
`
const confirmYes = "await __h.click('Підтвердити', '.confirm-modal button'); await __h.sleep(400)"
const escape = "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await __h.sleep(300)"
// Settings → "Видалити ключ" → its confirm (custom heading and verb).
const askClearKey = "await __h.clickSel('.sidebar-header button[aria-label=\"Налаштування\"]'); await __h.sleep(300); await __h.click('Видалити ключ', '.ui-modal button')"
// Hover (React's onMouseEnter listens to mouseover) — a programmatic focus of an unfocused window fires no focus event.
const hoverTip = (sel) =>
  `document.querySelector('${sel}').dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })); await __h.sleep(700)`

module.exports = [
  {
    name: 'shell',
    code: ''
  },
  {
    name: 'shell-shoplist-tip',
    code: "await __h.clickSel('.sidebar-section-head .ui-infotip')"
  },
  {
    name: 'shell-scanall-tip',
    code: "await __h.clickSel('.scan-all-row .ui-infotip')"
  },
  {
    name: 'shell-quota-tip',
    code: "await __h.clickSel('.quota .ui-infotip')"
  },
  {
    name: 'shell-shop-tip',
    code: hoverTip('.shop-item')
  },
  {
    name: 'shell-mcp-tip',
    code: hoverTip('.mcp-btn')
  },
  {
    name: 'add-shop',
    code: "await __h.click('Додати магазин', '.add-shop')"
  },
  {
    name: 'add-shop-typed',
    code: "await __h.click('Додати магазин', '.add-shop'); await __h.type('Посилання на магазин Etsy або його назва', 'https://www.etsy.com/uk/shop/SimplyOrganizedPro?ref=shop_header')"
  },
  {
    name: 'add-shop-error',
    code: "await __h.click('Додати магазин', '.add-shop'); await __h.type('Посилання на магазин Etsy або його назва', 'https://www.etsy.com/listing/1234567/budget-planner'); await __h.click('Додати магазин', '.ui-modal-foot button')"
  },
  {
    name: 'add-shop-link-tip',
    code: "await __h.click('Додати магазин', '.add-shop'); await __h.clickSel('.add-shop-modal .ui-infotip')"
  },
  {
    name: 'confirm-delete',
    code: askDelete
  },
  {
    name: 'confirm-clear-key',
    code: askClearKey
  },
  {
    name: 'no-key',
    code: `${askClearKey}; await __h.click('Видалити ключ', '.confirm-modal button'); await __h.sleep(400); ${escape}; for (let i = 0; i < 6 && document.querySelector('.shop-item'); i++) { ${askDelete}; ${confirmYes} }`
  },
  {
    name: 'no-shops',
    code: `for (let i = 0; i < 6 && document.querySelector('.shop-item'); i++) { ${askDelete}; ${confirmYes} }`
  },
  {
    name: 'no-shops-add',
    code: `for (let i = 0; i < 6 && document.querySelector('.shop-item'); i++) { ${askDelete}; ${confirmYes} }; await __h.click('Додати магазин', '.welcome-cta button')`
  }
]
