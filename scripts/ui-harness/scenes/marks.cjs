// UI harness scenes: listing marks ("В роботі" / "Реалізовано") — the card badge,
// the card's quick-mark menu, the grid filter + sort and the listing window's
// "Мітка" block (see ../main.cjs). The fake api marks a few listings of the
// sample shop (SimplyOrganizedPro).

const PRE = `
await __h.click('SimplyOrganizedPro', '.shop-item').catch(() => undefined)
await __h.sleep(700)
const reveal = async (sel) => {
  const el = document.querySelector(sel)
  const sc = document.querySelector('.shop-scroll')
  if (el && sc) sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 8
  await __h.sleep(400)
}
const markedCard = () => document.querySelector('[data-testid=card-mark]').closest('.listing-card-host')
`

const openMarked = `${PRE} markedCard().querySelector('.listing-card').click(); await __h.waitFor('.listing-modal [data-testid=mark-block]'); await __h.sleep(600);`

module.exports = [
  { name: 'marks-grid', code: `${PRE} await reveal('.all-listings')` },
  {
    name: 'marks-card-menu',
    code: `${PRE} await reveal('.all-listings'); const host = markedCard(); host.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); host.querySelector('.card-mark-btn').click(); await __h.sleep(500)`
  },
  {
    name: 'marks-card-tip',
    code: `${PRE} await reveal('.all-listings'); document.querySelector('[data-testid=card-mark]').closest('.ui-tooltip-anchor').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await __h.sleep(600)`
  },
  {
    name: 'marks-filter-done',
    code: `${PRE} await reveal('.grid-toolbar'); await __h.click('Реалізовано', '.grid-mark label'); await __h.sleep(400)`
  },
  {
    name: 'marks-sort-marked',
    code: `${PRE} const sel = document.querySelector('.grid-sort select'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, 'marked'); sel.dispatchEvent(new Event('change', { bubbles: true })); await __h.sleep(300); await reveal('.grid-toolbar')`
  },
  { name: 'marks-modal', code: openMarked },
  {
    name: 'marks-modal-unmarked',
    code: `${PRE} ;[...document.querySelectorAll('.listing-card-host')].find((h) => !h.querySelector('[data-testid=card-mark]')).querySelector('.listing-card').click(); await __h.waitFor('.listing-modal [data-testid=mark-block]'); await __h.sleep(600)`
  },
  {
    name: 'marks-modal-long-note',
    code: `${openMarked} const t = document.querySelector('[data-testid=mark-note]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Дуже довга нотатка '.repeat(30)); t.dispatchEvent(new Event('input', { bubbles: true })); await __h.sleep(300)`
  }
]
