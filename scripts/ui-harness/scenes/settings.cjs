// UI harness scenes: settings + MCP (see ../main.cjs). Each starts from a fresh app (first shop selected).

const openSettings = "await __h.clickSel('[aria-label=\"Налаштування\"]');"
const tab = (name) => `${openSettings} await __h.click(${JSON.stringify(name)}, '[role=tab]');`
const openMcp = "await __h.clickSel('[aria-label=\"MCP-сервер для Claude\"]'); await __h.sleep(400);"
// Bring an element to the middle of the scrolling modal body (before a click, so the result stays in view).
const reveal = (css) => `document.querySelector(${JSON.stringify(css)}).scrollIntoView({ block: 'center' }); await __h.sleep(200);`

module.exports = [
  // Settings → Доступ до Etsy
  { name: 'settings', code: openSettings },
  { name: 'settings-scrolled', code: `${openSettings} await __h.scroll('.ui-modal-body', 900)` },
  {
    name: 'settings-key-howto',
    code: `${openSettings} await __h.open('Як отримати ключ'); await __h.type('Keystring', 'abcd1234efgh5678'); await __h.click('Перевірити ключ', 'button'); await __h.sleep(300)`
  },
  { name: 'settings-clear-key', code: `${openSettings} await __h.click('Видалити ключ', 'button'); await __h.sleep(200)` },
  { name: 'settings-tip', code: `${openSettings} await __h.clickSel('.settings-status .ui-infotip')` },
  // Settings → Ціни для покупця
  { name: 'settings-prices', code: tab('Ціни для покупця') },
  {
    name: 'settings-prices-other',
    code: `${tab('Ціни для покупця')} const s = document.querySelector('#buyer-country'); s.value = '__other'; s.dispatchEvent(new Event('change', { bubbles: true })); await __h.sleep(200); await __h.type('Код країни', 'XX'); await __h.scroll('.ui-modal-body', 400)`
  },
  // Settings → Фото
  { name: 'settings-photos', code: tab('Фото') },
  {
    name: 'settings-photos-advanced',
    code: `${tab('Фото')} await __h.open('Для досвідчених'); await __h.click('Перевірити з’єднання', 'button'); await __h.sleep(300)`
  },
  {
    name: 'settings-photos-install',
    code: `${tab('Фото')} await __h.open('Для досвідчених'); ${reveal('[data-testid=copy-minio-run]')}`
  },
  {
    name: 'settings-photos-dirty',
    code: `${tab('Фото')} await __h.open('Для досвідчених'); await __h.type('Тека для фото', 'my-photos'); await __h.scroll('.ui-modal-body', 3000)`
  },
  {
    name: 'settings-photos-off',
    code: `${tab('Фото')} await __h.clickSel('[data-testid=minio-section] input[role=switch]'); await __h.sleep(300)`
  },
  {
    name: 'settings-photos-bottom',
    code: `${tab('Фото')} await __h.open('Для досвідчених'); await __h.scroll('.ui-modal-body', 3000)`
  },
  // Settings → Про програму
  { name: 'settings-about', code: tab('Про програму') },

  // MCP window
  { name: 'mcp', code: openMcp },
  { name: 'mcp-scrolled', code: `${openMcp} await __h.scroll('.ui-modal-body', 520)` },
  { name: 'mcp-desktop', code: `${openMcp} await __h.click('Claude Desktop', 'label'); await __h.scroll('.ui-modal-body', 520)` },
  { name: 'mcp-other', code: `${openMcp} await __h.click('Інший клієнт', 'label'); await __h.scroll('.ui-modal-body', 520)` },
  {
    name: 'mcp-tools',
    code: `${openMcp} await __h.open('Читати'); await __h.open('Змінювати мій магазин'); await __h.scroll('.ui-modal-body', 1400)`
  },
  {
    name: 'mcp-advanced',
    code: `${openMcp} await __h.open('Для досвідчених'); await __h.type('Порт', '80'); await __h.scroll('.ui-modal-body', 5000)`
  },
  {
    name: 'mcp-copied',
    code: `${openMcp} ${reveal('[data-testid=copy-claude-code]')} await __h.click('Копіювати', 'button')`
  },
  {
    name: 'mcp-writes-on',
    code: `${openMcp} await __h.clickSel('[data-testid=mcp-writes] input[role=switch]'); await __h.sleep(200)`
  },
  {
    name: 'mcp-token-confirm',
    code: `${openMcp} await __h.open('Для досвідчених'); await __h.scroll('.ui-modal-body', 5000); await __h.click('Новий токен', 'button'); await __h.sleep(200)`
  }
]
