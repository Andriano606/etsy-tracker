// The drafts window with two-way Etsy sync: every status, linked drafts, conflicts, removed listings, remote files, delete, sync.
const H = `
const action = async (label) => {
  const b = __h.find(label, '.shop-header button, .shop-head-row button')
  if (b) return __h.click(b)
  await __h.clickSel('.shop-header .ui-actionbar-more button, .shop-head-row .ui-actionbar-more button')
  await __h.click(label, '[role=menuitem]')
}
const own = async () => { await __h.click('TidyFoxSheets', '.shop-item'); await __h.sleep(300) }
const openDrafts = async () => { await own(); await action('Чернетки'); await __h.waitFor('[data-testid=draft-list]'); await __h.sleep(400) }
// Draft ids of fake-api.cjs sampleDrafts: 901 mcp local, 902 published, 903 Etsy draft, 904 dirty, 905 pulled from Etsy (remote files),
// 906 changed on Etsy (conflict), 907 removed on Etsy, 908 local send error.
const openDraft = async (id) => {
  await openDrafts()
  const rows = [...document.querySelectorAll('.my-rows .my-row')]
  const ids = [901, 902, 903, 904, 905, 906, 907, 908]
  const row = rows[ids.indexOf(id)]
  const b = [...row.querySelectorAll('button')].find((x) => /Відкрити/.test(x.textContent))
  await __h.click(b)
  await __h.waitFor('[data-testid=draft-form]')
  await __h.sleep(500)
}
const body = () => document.querySelector('.drafts-modal .ui-modal-body')
const toSel = async (sel, block = 'start') => { const el = document.querySelector(sel); if (el) el.scrollIntoView({ block }); await __h.sleep(300) }
const bottom = async () => { const b = body(); b.scrollTop = b.scrollHeight; await __h.sleep(300) }
const bar = (label) => [...document.querySelectorAll('.my-savebar button')].find((b) => b.textContent.trim().startsWith(label))
const topModal = () => [...document.querySelectorAll('.ui-modal')].pop()
const confirmOk = async () => { const btns = topModal().querySelectorAll('.ui-modal-foot button'); await __h.click(btns[btns.length - 1]); await __h.sleep(500) }
`
const scene = (name, code) => ({ name, code: H + code })

module.exports = [
  scene('drafts-list', 'await openDrafts()'),
  scene('drafts-list-bottom', 'await openDrafts(); await bottom()'),
  scene('drafts-list-tip', "await openDrafts(); const r = document.querySelector('.my-rows .my-row:nth-child(6)'); r.scrollIntoView({ block: 'center' }); await __h.sleep(300); window.__hoverSel = '.my-rows .my-row:nth-child(6) .my-meta .ui-badge'"),
  scene('drafts-sync-running', "await openDrafts(); await __h.click('Синхронізувати з Etsy', '.draft-pull button')"),
  scene('drafts-sync-result', "await openDrafts(); await __h.click('Синхронізувати з Etsy', '.draft-pull button'); await __h.sleep(2200)"),

  scene('drafts-linked-active', 'await openDraft(902)'),
  scene('drafts-linked-active-bottom', 'await openDraft(902); await bottom()'),
  scene('drafts-linked-etsy-draft', 'await openDraft(903)'),
  scene('drafts-linked-etsy-draft-bottom', 'await openDraft(903); await bottom()'),
  scene('drafts-linked-dirty', 'await openDraft(904)'),
  scene('drafts-from-etsy', 'await openDraft(905)'),
  scene('drafts-remote-files', "await openDraft(905); await toSel('.draft-files', 'center')"),
  scene('drafts-changed-on-etsy', 'await openDraft(906)'),
  scene('drafts-conflict-update', "await openDraft(906); await __h.click(bar('Оновити на Etsy')); await __h.sleep(300)"),
  scene('drafts-conflict-confirm', "await openDraft(906); await __h.click(bar('Оновити на Etsy')); await confirmOk(); await __h.sleep(500)"),
  scene(
    'drafts-conflict-kept',
    "await openDraft(906); await __h.click(bar('Оновити на Etsy')); await confirmOk(); await __h.sleep(500); const btns = topModal().querySelectorAll('.ui-modal-foot button'); await __h.click(btns[0]); await __h.sleep(600)"
  ),
  scene(
    'drafts-conflict-kept-bottom',
    "await openDraft(906); await __h.click(bar('Оновити на Etsy')); await confirmOk(); await __h.sleep(500); const btns = topModal().querySelectorAll('.ui-modal-foot button'); await __h.click(btns[0]); await __h.sleep(600); await bottom()"
  ),
  scene('drafts-removed', 'await openDraft(907)'),
  scene('drafts-removed-bottom', 'await openDraft(907); await bottom()'),
  scene('drafts-removed-files', "await openDraft(907); await toSel('.draft-files', 'center')"),
  scene('drafts-send-as-new', "await openDraft(907); const b = __h.find('Надіслати як новий', '.drafts-modal button'); if (!b) throw new Error('no send-as-new'); await __h.click(b)"),
  scene('drafts-local-error', 'await openDraft(908)'),
  scene('drafts-local-error-bottom', 'await openDraft(908); await bottom()'),
  scene('drafts-mcp-local', 'await openDraft(901)'),

  scene('drafts-delete-menu', "await openDraft(902); await __h.clickSel('.draft-delete-menu')"),
  scene('drafts-delete-local-confirm', "await openDraft(902); await __h.clickSel('.draft-delete-menu'); await __h.click('Видалити лише в програмі', '[role=menuitem]'); await __h.sleep(300)"),
  scene('drafts-delete-etsy-confirm', "await openDraft(902); await __h.clickSel('.draft-delete-menu'); await __h.click('Видалити і на Etsy', '[role=menuitem]'); await __h.sleep(300)"),
  scene('drafts-delete-removed', "await openDraft(907); await __h.click('Видалити', '.my-back button'); await __h.sleep(300)")
]
