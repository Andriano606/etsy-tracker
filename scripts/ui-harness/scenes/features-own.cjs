// UI harness scenes: own-listing feature sections (inventory, media, listingMeta) (see ../main.cjs). Each starts from a fresh app (first shop selected).
// Path: TidyFoxSheets → "Керувати" (Мій магазин) → Лістинги → "Редагувати" on the first listing → open a section.

const PRE = `
const own = async () => {
  await __h.click('TidyFoxSheets', '.shop-item')
  await __h.click('Керувати', 'button')
  await __h.sleep(700)
}
// n = which listing's "Редагувати": 0 = full data, 1 = empty states, 2 = load errors, 3 = the video unreadable (see ../features/*.cjs).
const edit = async (n = 0) => {
  await own()
  const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim().endsWith('Редагувати') && b.offsetParent)
  if (!btns[n]) throw new Error('no Редагувати #' + n)
  btns[n].click()
  await __h.sleep(600)
}
const setValue = async (sel, value) => {
  const el = document.querySelector(sel)
  if (!el) throw new Error('no ' + sel)
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await __h.sleep(250)
}
const section = async (label) => {
  const s = __h.find(label, 'summary')
  if (s) {
    s.parentElement.open = true
    await __h.sleep(900)
    s.scrollIntoView({ block: 'start' })
  } else {
    await __h.click(label, 'button, [role=tab]')
    await __h.sleep(900)
  }
  await __h.sleep(300)
}
const reveal = async (sel) => {
  const el = document.querySelector(sel)
  if (el) el.scrollIntoView({ block: 'start' })
  await __h.sleep(300)
}
const tab = async (label) => {
  let t = __h.find(label, '[role=tab]')
  if (!t) {
    const more = document.querySelector('.ui-tabs-more-btn, .ui-tabs-more button')
    if (more) { more.click(); await __h.sleep(300) }
    t = __h.find(label, '[role=menuitem], [role=menuitemradio], [role=tab], button')
  }
  if (!t) throw new Error('no tab ' + label)
  t.click()
  await __h.sleep(900)
}
`

const scene = (name, body) => ({ name, code: PRE + body })

module.exports = [
  scene('own-inventory', "await edit(); await section('Ціна, кількість і варіанти')"),
  scene('own-inventory-table', "await edit(); await section('Ціна, кількість і варіанти'); await reveal('.inv-variants, .inv-table')"),
  scene('own-variation-photos', "await edit(); await section('Фото варіантів')"),
  scene('own-media', "await edit(); await section('Фото, відео й файли')"),
  scene('own-media-video', "await edit(); await section('Фото, відео й файли'); await reveal('[data-testid=media-video]')"),
  scene('own-media-files', "await edit(); await section('Фото, відео й файли'); await reveal('[data-testid=media-files]')"),
  scene('own-attributes', "await edit(); await section('Атрибути')"),
  scene('own-attributes-more', "await edit(); await section('Атрибути'); await reveal('[data-testid=lm-attr-300]')"),
  scene('own-personalization', "await edit(); await section('Персоналізація')"),
  scene('own-personalization-q2', "await edit(); await section('Персоналізація'); await reveal('[data-testid=lm-q1]')"),
  scene('own-translations', "await edit(); await section('Переклади')"),
  scene('own-danger', "await edit(); await section('Видалити товар з Etsy')"),
  scene('own-inventory-edited', "await edit(); await section('Ціна, кількість і варіанти'); await setValue('input[aria-label=\"Ціна: Letter / Sage green\"]', '13,999'); await setValue('input[aria-label=\"Кількість: A4 / Navy blue\"]', '5'); await reveal('[data-testid=inventory-problems]')"),
  scene('own-inventory-tip', "await edit(); await section('Ціна, кількість і варіанти'); await reveal('.inv-depends'); await __h.clickSel('.inv-depends .ui-infotip')"),
  scene('own-inventory-single', "await edit(1); await section('Ціна, кількість і варіанти')"),
  scene('own-variation-photos-empty', "await edit(1); await section('Фото варіантів')"),
  scene('own-media-empty', "await edit(1); await section('Фото, відео й файли')"),
  scene('own-media-empty-files', "await edit(1); await section('Фото, відео й файли'); await reveal('[data-testid=media-video]')"),
  scene('own-attributes-picker', "await edit(1); await section('Атрибути'); await setValue('#lm-cat', 'plan'); await __h.sleep(300)"),
  scene('own-attributes-problem', "await edit(); await section('Атрибути'); await reveal('[data-testid=lm-attr-46803063641]'); for (const v of ['Christmas', 'Easter', 'Halloween']) { const l = [...document.querySelectorAll('[data-testid=lm-attr-46803063641] .lm-chip')].find((x) => x.textContent.trim() === v); l?.click(); await __h.sleep(150) }"),
  scene('own-personalization-empty', "await edit(1); await section('Персоналізація')"),
  scene('own-translations-new', "await edit(1); await section('Переклади')"),
  scene('own-danger-typed', "await edit(); await section('Видалити товар з Etsy'); const t = document.querySelector('.lm-danger-name')?.textContent.replace(/^«|»$/g, '') ?? ''; await setValue('#lm-del-title', t); await reveal('.lm-danger-field')"),
  scene('own-errors', "await edit(2); await section('Ціна, кількість і варіанти'); await section('Фото, відео й файли'); await reveal('[data-testid=inventory-section], .feature-body')"),
  scene('own-errors-meta', "await edit(2); await section('Атрибути'); await section('Персоналізація'); await section('Переклади'); await section('Атрибути')"),
  scene('own-media-video-unreadable', "await edit(3); await section('Фото, відео й файли'); await reveal('.media-section')"),
  scene('own-media-deleted', "await edit(); await section('Фото, відео й файли'); const b = document.querySelectorAll('[data-testid^=media-photo-] [aria-label=\"Видалити фото\"]')[1]; b.click(); await __h.sleep(400); await __h.click('Підтвердити', 'button'); await __h.sleep(600); await reveal('.media-status')"),
  scene('own-inventory-invalid-focus', "await edit(); await section('Ціна, кількість і варіанти'); await setValue('input[aria-label=\"Ціна: Letter / Sage green\"]', '13,999'); await reveal('[data-testid=inventory-problems]'); document.querySelector('.inv-problem-link')?.click(); await __h.sleep(300)"),
  scene('own-variation-photos-keys', "await edit(); await section('Фото варіантів'); const r = document.querySelector('.inv-thumbs [role=radio][tabindex=\"0\"]'); r?.focus(); r?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); await __h.sleep(300)"),
  scene('own-attributes-picker-keys', "await edit(1); await section('Атрибути'); await setValue('#lm-cat', 'plan'); const i = document.querySelector('#lm-cat'); i.focus(); for (let k = 0; k < 3; k++) { i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await __h.sleep(80) }; await __h.sleep(300)"),
  scene('prices-tab', "await own(); await tab('Ціни й залишки')"),
  scene('prices-quick-edit', "await own(); await tab('Ціни й залишки'); const b = document.querySelector('[aria-label^=\"Змінити ціну й кількість\"]'); if (b) { b.click(); await __h.sleep(400); b.closest('tr, li, .inv-ov-row')?.scrollIntoView({ block: 'center' }) }; await __h.sleep(300)")
]
