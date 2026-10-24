// UI harness scenes: the Statistics window (see ../main.cjs). Each starts from a fresh app (first shop selected).
//
// `open` opens the statistics of the selected shop: the shop header's
// "Статистика" button, or — when the header's action bar folded it into its
// "⋯" menu (narrow window) — the menu item.

const open = `
  const openStats = async () => {
    const visible = (e) => e.offsetParent !== null
    const btn = [...document.querySelectorAll('button')].find((b) => visible(b) && /Статистика/.test(b.textContent) && !b.closest('.ui-modal'))
    if (btn) { btn.click() } else {
      const more = [...document.querySelectorAll('.ui-actionbar-more button, button[aria-label="Ще дії"]')].find(visible)
      if (!more) throw new Error('no Статистика button')
      more.click(); await __h.sleep(300)
      const item = [...document.querySelectorAll('[role=menuitem]')].find((m) => /Статистика/.test(m.textContent))
      if (!item) throw new Error('no Статистика menu item')
      item.click()
    }
    await __h.waitFor('.stats-modal .stats-body', 5000)
    await __h.sleep(600)
  }
  const selectShop = async (name) => { await __h.click(name, '.shop-item'); await __h.sleep(500) }
  const card = async (testId, offset = 12) => {
    const el = document.querySelector('[data-testid="' + testId + '"]')
    const body = document.querySelector('.stats-modal .ui-modal-body')
    if (el && body) body.scrollTop = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - offset
    await __h.sleep(300)
  }
  // Hover a chart at a fraction of its width (the readout follows the pointer).
  const hover = async (sel, fx = 0.7) => {
    const el = document.querySelector(sel)
    if (!el) throw new Error('no chart: ' + sel)
    const r = el.getBoundingClientRect()
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left + r.width * fx, clientY: r.top + r.height / 2 }))
    await __h.sleep(300)
  }
  const period = async (label) => { await __h.click(label, '.stats-period label'); await __h.sleep(700) }
`

const scene = (name, code) => ({ name, code: open + code })

module.exports = [
  scene('stats', 'await openStats()'),
  scene('stats-90d', "await openStats(); await period('90 днів')"),
  scene('stats-30d', "await openStats(); await period('30 днів')"),
  scene('stats-7d', "await openStats(); await period('7 днів')"),
  scene('stats-sales', "await openStats(); await card('chart-sales')"),
  scene('stats-sales-table', "await openStats(); await __h.open('Дані'); await card('chart-sales', -150)"),
  scene('stats-reviews', "await openStats(); await card('chart-reviews')"),
  scene('stats-reviews-weeks', "await openStats(); await card('chart-reviews'); await __h.click('Тижні', '.stats-card label'); await card('chart-reviews')"),
  scene('stats-favorers', "await openStats(); await card('chart-favorers')"),
  scene('stats-shop-reviews', "await openStats(); await card('chart-shop-reviews')"),
  scene('stats-active', "await openStats(); await card('chart-active')"),
  scene('stats-listing-sums', "await openStats(); await card('chart-listing-sums')"),
  scene('stats-changes', "await openStats(); await card('chart-changes')"),
  scene('stats-discounted', "await openStats(); await card('chart-discounted')"),
  scene('stats-top', "await openStats(); await card('stats-top')"),
  scene('stats-bottom', "await openStats(); await __h.scroll('.stats-modal .ui-modal-body', 99999)"),
  // Hover readout (keyboard focus on the sales line) and an open ⓘ.
  scene('stats-tooltip', "await openStats(); await card('chart-sales'); await hover('[data-testid=chart-sales] .chart', 0.97)"),
  scene('stats-tooltip-rate', "await openStats(); await card('chart-sales', -200); await hover('[data-testid=chart-sales] .chart:nth-of-type(2), [data-testid=chart-sales] .chart-subhead ~ .chart', 0.3)"),
  scene('stats-tooltip-reviews', "await openStats(); await card('chart-reviews'); await hover('[data-testid=chart-reviews] .chart', 0.9)"),
  scene('stats-infotip', "await openStats(); await __h.clickSel('.stats-kpis .ui-infotip')"),
  // A shop with 3 scans and no reviews; a shop with one scan (empty states).
  scene('stats-few', "await selectShop('TidyFoxSheets'); await openStats()"),
  scene('stats-few-bottom', "await selectShop('TidyFoxSheets'); await openStats(); await card('stats-top')"),
  scene('stats-few-changes', "await selectShop('TidyFoxSheets'); await openStats(); await card('chart-changes')"),
  scene('stats-few-sums', "await selectShop('TidyFoxSheets'); await openStats(); await card('chart-shop-reviews')"),
  scene('stats-few-infotip', "await selectShop('TidyFoxSheets'); await openStats(); await __h.clickSel('.stats-kpis .ui-stat:nth-child(6) .ui-infotip')"),
  scene('stats-datatip', "await openStats(); await card('chart-favorers'); await __h.clickSel('[data-testid=chart-favorers] .chart-table-tip .ui-infotip')"),
  scene('stats-data-open', "await openStats(); await card('chart-favorers'); await __h.clickSel('[data-testid=chart-favorers] summary'); await __h.sleep(300)"),
  scene('stats-one', "await selectShop('OneWayCollection'); await openStats()"),
  scene('stats-one-scrolled', "await selectShop('OneWayCollection'); await openStats(); await card('chart-favorers')"),
  scene('stats-one-7d', "await selectShop('OneWayCollection'); await openStats(); await period('7 днів'); await card('chart-reviews')")
]
