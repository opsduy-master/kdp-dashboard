import { parseKdpWorkbook } from './kdp-parser.js'

const $ = (sel) => document.querySelector(sel)
const TOKEN_KEY = 'kdp-dashboard-token'
const PREFS_KEY = 'kdp-dashboard-prefs'
const AUTO_RELOAD_MS = 10 * 60 * 1000
const DAY = 86400000

const store = {
  get(key) { try { return localStorage.getItem(key) } catch { return null } },
  set(key, v) { try { localStorage.setItem(key, v) } catch {} },
  del(key) { try { localStorage.removeItem(key) } catch {} },
}
const prefs = (() => { try { return JSON.parse(store.get(PREFS_KEY)) || {} } catch { return {} } })()
const savePrefs = () => store.set(PREFS_KEY, JSON.stringify(prefs))

const state = {
  data: null,
  days: prefs.days ?? 30,
  marketplace: prefs.marketplace ?? 'all',
  selected: null,
  charts: {},
}

// ---------- Formatierung ----------
const nf = new Intl.NumberFormat('de-DE')
const nf1 = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const money = (v, cur = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur || 'EUR' }).format(v)
const fmtNum = (v) => (v == null ? '–' : nf.format(v))
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const rel = (iso) => {
  if (!iso) return 'nie'
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return 'gerade eben'
  if (m < 60) return `vor ${m} Min.`
  const h = Math.round(m / 60)
  if (h < 48) return `vor ${h} Std.`
  return `vor ${Math.round(h / 24)} Tagen`
}
const isoDay = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()
const seriesColor = (i) => (i < 8 ? cssVar(`--s${i + 1}`) : cssVar('--muted'))

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch(`/api/${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-dashboard-token': store.get(TOKEN_KEY) || '', ...(opts.headers || {}) },
  })
  const body = await res.json().catch(() => ({}))
  if (res.status === 401) { showLogin('Passwort falsch oder abgelaufen.'); throw new Error('unauthorized') }
  if (!res.ok) throw new Error(body.error || `Fehler ${res.status}`)
  return body
}

// ---------- Login ----------
function showLogin(msg = '') {
  $('#app').hidden = true
  $('#login').hidden = false
  $('#login-error').textContent = msg
  $('#login-password').focus()
}
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  store.set(TOKEN_KEY, $('#login-password').value)
  $('#login-error').textContent = ''
  try { await load() } catch (err) { if (err.message !== 'unauthorized') $('#login-error').textContent = err.message }
})

// ---------- Daten ableiten ----------
function latestOf(asin) {
  const { status, histories } = state.data
  const h = histories[asin] || []
  return status[asin]?.latest || h[h.length - 1] || null
}

/** Letzter Snapshot, der mindestens `ageMs` alt ist (für Veränderungen). */
function snapshotBefore(asin, ageMs) {
  const h = state.data.histories[asin] || []
  const cutoff = Date.now() - ageMs
  for (let i = h.length - 1; i >= 0; i--) if (Date.parse(h[i].t) <= cutoff) return h[i]
  return null
}

function rangeStart() {
  if (!state.days) return null
  return isoDay(Date.now() - (state.days - 1) * DAY)
}

function filteredSales({ from = rangeStart(), to = null } = {}) {
  return state.data.sales.filter((r) =>
    (state.marketplace === 'all' || r.marketplace === state.marketplace) &&
    (!from || r.date >= from) && (!to || r.date <= to))
}

function idToBook() {
  const map = new Map()
  for (const b of state.data.books) for (const id of [b.asin, ...(b.ids || [])]) map.set(id, b.asin)
  return map
}

function sumSales(rows) {
  const out = { units: 0, kenp: 0, royalty: {} }
  for (const r of rows) {
    out.units += r.units
    out.kenp += r.kenp
    if (r.royalty) out.royalty[r.currency || 'EUR'] = (out.royalty[r.currency || 'EUR'] || 0) + r.royalty
  }
  return out
}

function royaltyText(royalty) {
  const entries = Object.entries(royalty).filter(([, v]) => Math.abs(v) > 0.004)
  if (!entries.length) return { main: money(0), rest: '' }
  entries.sort((a, b) => (a[0] === 'EUR' ? -1 : b[0] === 'EUR' ? 1 : b[1] - a[1]))
  const [[cur, val], ...rest] = entries
  return { main: money(val, cur), rest: rest.map(([c, v]) => money(v, c)).join(' · ') }
}

function deltaHtml(diff, { goodWhenNegative = false, suffix = '', fmt = fmtNum } = {}) {
  if (diff == null || !Number.isFinite(diff)) return ''
  if (diff === 0) return `<span class="delta flat">± 0${suffix}</span>`
  const good = goodWhenNegative ? diff < 0 : diff > 0
  const arrow = good ? '▲' : '▼'
  const sign = diff > 0 ? '+' : '−'
  return `<span class="delta ${good ? 'up' : 'down'}" title="${good ? 'besser' : 'schlechter'}">${arrow} ${sign}${fmt(Math.abs(diff))}${suffix}</span>`
}

// ---------- Rendering ----------
function render() {
  const { books, status } = state.data
  $('#updated').textContent = `Stand: ${new Date(state.data.now).toLocaleString('de-DE')} · neuester Amazon-Abruf ${
    rel(Object.values(status).map((s) => s.lastSuccess).filter(Boolean).sort().pop())}`

  document.querySelectorAll('#range button').forEach((b) =>
    b.setAttribute('aria-checked', String(Number(b.dataset.days) === state.days)))
  renderMarketplaces()
  renderKpis()
  renderTable()
  renderUnmapped()
  renderCharts()
  $('#empty').hidden = books.length > 0
  const d = state.data.drive || {}
  $('#footer-info').textContent = fetchingText() + (d.configured
    ? ` Verkäufe: automatisch aus Google Drive${d.importedAt ? ` (zuletzt ${d.name}, ${rel(d.importedAt)})` : ''}.`
    : ' Verkäufe stammen aus deinen hochgeladenen KDP-Berichten.')
  $('#books-table').hidden = books.length === 0
}

function renderMarketplaces() {
  const mps = [...new Set(state.data.sales.map((r) => r.marketplace))].sort()
  if (state.marketplace !== 'all' && !mps.includes(state.marketplace)) state.marketplace = 'all'
  $('#marketplace').innerHTML = `<option value="all">Alle</option>` +
    mps.map((m) => `<option ${m === state.marketplace ? 'selected' : ''}>${esc(m)}</option>`).join('')
}

function renderKpis() {
  const cur = sumSales(filteredSales())
  let prev = null
  if (state.days) {
    const from = isoDay(Date.now() - (2 * state.days - 1) * DAY)
    const to = isoDay(Date.now() - state.days * DAY)
    prev = sumSales(filteredSales({ from, to }))
  }
  const rt = royaltyText(cur.royalty)
  const prevEur = prev ? prev.royalty.EUR || 0 : null

  const latest = state.data.books.map((b) => ({ b, l: latestOf(b.asin) })).filter((x) => x.l)
  const totalReviews = latest.reduce((s, x) => s + (x.l.reviews || 0), 0)
  const weighted = latest.reduce((s, x) => s + (x.l.rating || 0) * (x.l.reviews || 0), 0)
  const avgRating = totalReviews ? weighted / totalReviews : null
  const reviewsWeekAgo = state.data.books.reduce((s, b) => {
    const old = snapshotBefore(b.asin, 7 * DAY)
    return old?.reviews != null ? s + old.reviews : s
  }, 0)
  const best = latest.filter((x) => x.l.bsr).sort((a, b) => a.l.bsr - b.l.bsr)[0]
  const periodLabel = state.days ? `letzte ${state.days === 365 ? '12 Monate' : state.days + ' Tage'}` : 'gesamt'
  const vsPrev = prev ? ' ggü. Vorperiode' : ''

  const tiles = [
    { label: `Verkaufte Einheiten · ${periodLabel}`, value: fmtNum(cur.units), sub: prev ? deltaHtml(cur.units - prev.units) + vsPrev : '' },
    {
      label: `Tantiemen · ${periodLabel}`, value: rt.main,
      sub: [prev && cur.royalty.EUR != null ? deltaHtml((cur.royalty.EUR || 0) - prevEur, { fmt: (v) => money(v) }) + vsPrev : '', rt.rest && `+ ${rt.rest}`].filter(Boolean).join('<br>'),
    },
    { label: `KENP gelesen · ${periodLabel}`, value: fmtNum(cur.kenp), sub: prev ? deltaHtml(cur.kenp - prev.kenp) + vsPrev : '' },
    {
      label: 'Rezensionen gesamt', value: fmtNum(totalReviews),
      sub: (avgRating ? `Ø ${nf1.format(avgRating)} ★ ` : '') + (reviewsWeekAgo ? deltaHtml(totalReviews - reviewsWeekAgo) + ' in 7 Tagen' : ''),
    },
    {
      label: 'Bester BSR', value: best ? `#${fmtNum(best.l.bsr)}` : '–',
      sub: best ? esc(best.b.label || best.l.title || best.b.asin) : 'noch keine Daten',
    },
  ]
  $('#kpis').innerHTML = tiles.map((t) =>
    `<div class="kpi"><div class="label">${t.label}</div><div class="value">${t.value}</div><div class="sub">${t.sub || '&nbsp;'}</div></div>`).join('')
}

function stars(r) {
  if (r == null) return ''
  const full = Math.round(r)
  return `<span class="stars" aria-hidden="true">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`
}

function renderTable() {
  const { books, status } = state.data
  const owner = idToBook()
  const salesByBook = new Map()
  for (const r of filteredSales()) {
    const asin = owner.get(r.id)
    if (!asin) continue
    if (!salesByBook.has(asin)) salesByBook.set(asin, [])
    salesByBook.get(asin).push(r)
  }

  $('#books-table tbody').innerHTML = books.map((b, i) => {
    const l = latestOf(b.asin) || {}
    const st = status[b.asin] || {}
    const d24 = snapshotBefore(b.asin, 20 * 3600 * 1000)
    const d7 = snapshotBefore(b.asin, 7 * DAY)
    const s = sumSales(salesByBook.get(b.asin) || [])
    const rt = royaltyText(s.royalty)
    const title = b.label || l.title || b.asin
    const top = (l.subRanks || [])[0]
    return `<tr data-asin="${b.asin}" class="${state.selected === b.asin ? 'selected' : ''}">
      <td><div class="book-cell">
        ${l.image ? `<img src="${esc(l.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<div class="ph"></div>'}
        <div>
          <div class="book-title"><span class="swatch" style="background:${seriesColor(i)}"></span>${esc(title)}</div>
          <div class="book-meta"><a href="https://www.amazon.de/dp/${b.asin}" target="_blank" rel="noopener noreferrer">${b.asin}</a>${l.format ? ' · ' + esc(l.format) : ''}</div>
        </div></div></td>
      <td class="num">${l.price != null ? money(l.price, l.currency) : '–'}</td>
      <td class="num">${l.rating != null ? `${nf1.format(l.rating)} ${stars(l.rating)}` : '–'}</td>
      <td class="num">${fmtNum(l.reviews)}<br>${d7 && l.reviews != null && d7.reviews != null ? `<span class="nowrap">${deltaHtml(l.reviews - d7.reviews)} <span class="muted small">7 T.</span></span>` : ''}</td>
      <td class="num"><strong>${l.bsr ? '#' + fmtNum(l.bsr) : '–'}</strong><br>${d24 && l.bsr && d24.bsr ? `<span class="nowrap">${deltaHtml(l.bsr - d24.bsr, { goodWhenNegative: true })} <span class="muted small">24 h</span></span>` : ''}</td>
      <td class="cat">${top ? `#${fmtNum(top.rank)} in ${esc(top.category)}` : '–'}</td>
      <td class="num">${fmtNum(s.units)}</td>
      <td class="num">${fmtNum(s.kenp)}</td>
      <td class="num">${rt.main}${rt.rest ? `<br><span class="muted small">+ ${rt.rest}</span>` : ''}</td>
      <td><span class="small">${rel(st.lastSuccess)}</span>${st.lastError ? `<br><span class="status-err" title="${esc(st.lastError)}">⚠ ${esc(shortError(st.lastError))}</span>` : ''}${st.queued ? '<br><span class="muted small">⏳ wird im Hintergrund erneut versucht</span>' : ''}</td>
      <td><button class="btn icon" data-edit="${b.asin}" title="Bearbeiten" aria-label="Bearbeiten">✎</button><button class="btn icon" data-del="${b.asin}" title="Entfernen" aria-label="Entfernen">✕</button></td>
    </tr>`
  }).join('')
}

function renderUnmapped() {
  const owner = idToBook()
  const groups = new Map()
  for (const r of state.data.sales) {
    if (owner.has(r.id)) continue
    const g = groups.get(r.id) || { id: r.id, title: r.title, units: 0 }
    g.units += r.units
    g.title ||= r.title
    groups.set(r.id, g)
  }
  if (!groups.size || !state.data.books.length) { $('#unmapped').innerHTML = ''; return }
  const opts = state.data.books.map((b) => `<option value="${b.asin}">${esc(b.label || latestOf(b.asin)?.title || b.asin)}</option>`).join('')
  $('#unmapped').innerHTML = `<div class="unmapped">
    <strong class="small">Nicht zugeordnete IDs aus dem KDP-Report</strong>
    <span class="muted small">(z. B. ISBN des Taschenbuchs oder eBook-ASIN), bitte einem Buch zuordnen:</span>
    <ul>${[...groups.values()].map((g) => `<li>
      <code>${esc(g.id)}</code> ${esc(g.title)} <span class="muted">(${fmtNum(g.units)} Einh. gesamt)</span>
      <select data-map-select="${esc(g.id)}">${opts}</select>
      <button class="btn" data-map="${esc(g.id)}">Zuordnen</button></li>`).join('')}</ul></div>`
}

// ---------- Charts ----------
function chartDefaults() {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily
  Chart.defaults.font.size = 12
  Chart.defaults.color = cssVar('--text-2')
  Chart.defaults.borderColor = cssVar('--grid')
}

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: cssVar('--surface'), titleColor: cssVar('--text'), bodyColor: cssVar('--text'),
        borderColor: cssVar('--border'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
      },
    },
    ...extra,
  }
}

function setChart(id, config) {
  state.charts[id]?.destroy()
  state.charts[id] = new Chart(document.getElementById(id), config)
}

function dailySeries(field) {
  const rows = filteredSales()
  const byDay = new Map()
  for (const r of rows) byDay.set(r.date, (byDay.get(r.date) || 0) + r[field])
  let start = rangeStart()
  if (!start) start = rows[0]?.date || isoDay(Date.now() - 29 * DAY)
  const out = []
  for (let t = Date.parse(start + 'T12:00:00'); t <= Date.now(); t += DAY) {
    const d = isoDay(t)
    out.push({ x: d, y: byDay.get(d) || 0 })
  }
  return out
}

function barChart(id, field, label, subId) {
  const data = dailySeries(field)
  const total = data.reduce((s, p) => s + p.y, 0)
  $(`#${subId}`).textContent = state.data.sales.length ? `Summe ${fmtNum(total)}` : 'Noch kein KDP-Report importiert'
  setChart(id, {
    type: 'bar',
    data: { datasets: [{ label, data, backgroundColor: cssVar('--s1'), borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 22, categoryPercentage: 0.9, barPercentage: 0.9 }] },
    options: baseOptions({
      scales: {
        x: { type: 'time', time: { unit: data.length > 120 ? 'month' : data.length > 21 ? 'week' : 'day', tooltipFormat: 'dd.MM.yyyy', displayFormats: { day: 'dd.MM.', week: 'dd.MM.', month: 'MMM yy' } }, grid: { display: false }, border: { color: cssVar('--axis') } },
        y: { beginAtZero: true, ticks: { precision: 0 }, border: { display: false } },
      },
    }),
  })
}

function historyDatasets(field) {
  const from = state.days ? Date.now() - state.days * DAY : 0
  return state.data.books.map((b, i) => {
    const pts = (state.data.histories[b.asin] || [])
      .filter((s) => s[field] != null && Date.parse(s.t) >= from)
      .map((s) => ({ x: s.t, y: s[field] }))
    const dim = state.selected && state.selected !== b.asin
    const color = seriesColor(i)
    return {
      label: b.label || latestOf(b.asin)?.title || b.asin,
      data: pts,
      borderColor: dim ? color + '33' : color,
      backgroundColor: color,
      borderWidth: state.selected === b.asin ? 3 : 2,
      pointRadius: pts.length < 40 ? 3 : 0,
      pointHoverRadius: 5,
      tension: 0.2,
      order: state.selected === b.asin ? 0 : 1,
    }
  })
}

function lineChart(id, field, { reverseLog = false } = {}) {
  const datasets = historyDatasets(field)
  setChart(id, {
    type: 'line',
    data: { datasets },
    options: baseOptions({
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        ...baseOptions().plugins,
        legend: { display: datasets.length > 1, position: 'bottom', labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, color: cssVar('--text-2') } },
        tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => ` ${c.dataset.label}: ${reverseLog ? '#' : ''}${fmtNum(c.parsed.y)}` } },
      },
      scales: {
        x: { type: 'time', time: { tooltipFormat: 'dd.MM.yyyy HH:mm', displayFormats: { hour: 'HH:mm', day: 'dd.MM.', week: 'dd.MM.', month: 'MMM yy' } }, ticks: { maxRotation: 0, autoSkipPadding: 16 }, grid: { display: false }, border: { color: cssVar('--axis') } },
        y: reverseLog
          ? { type: 'logarithmic', reverse: true, border: { display: false }, ticks: { callback: (v) => (/^[125]/.test(String(v)) ? '#' + fmtNum(v) : '') } }
          : { beginAtZero: false, ticks: { precision: 0 }, border: { display: false } },
      },
    }),
  })
}

function renderCharts() {
  chartDefaults()
  barChart('chart-units', 'units', 'Einheiten', 'units-sub')
  barChart('chart-kenp', 'kenp', 'KENP-Seiten', 'kenp-sub')
  lineChart('chart-bsr', 'bsr', { reverseLog: true })
  lineChart('chart-reviews', 'reviews')
}

// ---------- Laden ----------
async function load() {
  const data = await api('data')
  state.data = data
  if (state.selected && !data.books.some((b) => b.asin === state.selected)) state.selected = null
  $('#login').hidden = true
  $('#app').hidden = false
  render()
}

function progress(text, kind = 'warn') {
  $('#progress').hidden = !text
  $('#progress').className = `banner ${kind}`
  $('#progress').textContent = text || ''
}

function driveResultText(r) {
  if (!r?.configured) return ''
  if (r.error) return `⚠ ${r.error}`
  if (r.imported) return `✓ KDP-Bericht „${r.name}“ aus Google Drive importiert (${fmtNum(r.added)} neu, ${fmtNum(r.replaced)} aktualisiert).`
  if (r.unchanged) return 'KDP-Bericht in Google Drive unverändert.'
  return ''
}

async function importDrive({ force = false } = {}) {
  progress('Prüfe Google Drive auf einen neuen KDP-Bericht …', 'info')
  try {
    return await api(`drive-import${force ? '?force=1' : ''}`, { method: 'POST' })
  } catch (e) {
    return { configured: true, error: e.message }
  }
}

async function refreshAll(asins = state.data.books.map((b) => b.asin), { withDrive = true } = {}) {
  const btn = $('#btn-refresh')
  btn.disabled = true
  const errors = []
  let queued = 0
  let driveMsg = ''
  try {
    if (withDrive && state.data.drive?.configured) driveMsg = driveResultText(await importDrive())
    for (let i = 0; i < asins.length; i++) {
      progress(`Rufe Amazon-Daten ab … ${i + 1} / ${asins.length}`, 'info')
      try {
        const r = await api(`refresh/${asins[i]}`, { method: 'POST' })
        if (r.lastError) errors.push(`${asins[i]}: ${r.lastError}`)
        if (r.queued) queued++
      } catch (e) { errors.push(`${asins[i]}: ${e.message}`) }
    }
    await load()
    const first = (errors[0]?.replace(/^[A-Z0-9]{10}: /, '') || '').replace(/([^.])$/, '$1.')
    const amazonMsg = errors.length
      ? `⚠ ${errors.length} von ${asins.length} Abruf(en) fehlgeschlagen: ${first}` +
        (queued ? ` Der Hintergrundjob versucht es innerhalb von 15 Minuten erneut.` : '')
      : ''
    const msg = [amazonMsg, driveMsg].filter(Boolean).join(' ')
    progress(msg, /⚠/.test(msg) ? 'warn' : 'ok')
  } finally {
    btn.disabled = false
  }
}

// ---------- Events ----------
$('#range').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-days]')
  if (!b) return
  state.days = Number(b.dataset.days)
  prefs.days = state.days; savePrefs()
  render()
})
$('#marketplace').addEventListener('change', (e) => {
  state.marketplace = e.target.value
  prefs.marketplace = state.marketplace; savePrefs()
  render()
})
$('#btn-refresh').addEventListener('click', () => refreshAll())

$('#books-table tbody').addEventListener('click', async (e) => {
  const del = e.target.closest('[data-del]')
  const edit = e.target.closest('[data-edit]')
  if (del) {
    const asin = del.dataset.del
    if (!confirm(`Buch ${asin} aus dem Dashboard entfernen?`)) return
    const keep = confirm('BSR-/Bewertungsverlauf behalten (falls du es später wieder hinzufügst)?\nOK = behalten, Abbrechen = löschen')
    await api(`books/${asin}${keep ? '' : '?history=delete'}`, { method: 'DELETE' })
    return load()
  }
  if (edit) return openBookDialog(state.data.books.find((b) => b.asin === edit.dataset.edit))
  if (e.target.closest('a')) return
  const row = e.target.closest('tr[data-asin]')
  if (!row) return
  state.selected = state.selected === row.dataset.asin ? null : row.dataset.asin
  renderTable()
  lineChart('chart-bsr', 'bsr', { reverseLog: true })
  lineChart('chart-reviews', 'reviews')
})

$('#unmapped').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-map]')
  if (!btn) return
  const id = btn.dataset.map
  const asin = document.querySelector(`[data-map-select="${CSS.escape(id)}"]`).value
  const book = state.data.books.find((b) => b.asin === asin)
  await api('books', { method: 'POST', body: JSON.stringify({ asin, ids: [...(book.ids || []), id] }) })
  load()
})

function openBookDialog(book) {
  const f = $('#form-add')
  f.reset()
  $('#add-error').textContent = ''
  $('#add-title').textContent = book ? 'Buch bearbeiten' : 'Buch hinzufügen'
  f.asin.readOnly = !!book
  if (book) {
    f.asin.value = book.asin
    f.label.value = book.label || ''
    f.ids.value = (book.ids || []).filter((x) => x !== book.asin).join(', ')
  }
  $('#dlg-add').showModal()
}
$('#btn-add').addEventListener('click', () => openBookDialog(null))
$('#btn-add-empty').addEventListener('click', () => openBookDialog(null))

$('#add-submit').addEventListener('click', async (e) => {
  e.preventDefault()
  const f = $('#form-add')
  if (!f.reportValidity()) return
  const asin = f.asin.value.trim().toUpperCase()
  const isNew = !state.data.books.some((b) => b.asin === asin)
  try {
    await api('books', { method: 'POST', body: JSON.stringify({ asin, label: f.label.value.trim(), ids: f.ids.value }) })
    $('#dlg-add').close()
    await load()
    if (isNew) refreshAll([asin], { withDrive: false })
  } catch (err) {
    $('#add-error').textContent = err.message
  }
})

// Upload
let pendingRows = null
$('#btn-upload').addEventListener('click', () => {
  pendingRows = null
  $('#form-upload').reset()
  $('#upload-preview').innerHTML = ''
  $('#upload-error').textContent = ''
  $('#upload-submit').disabled = true
  $('#dlg-upload').showModal()
})

async function handleFile(file) {
  $('#upload-error').textContent = ''
  $('#upload-preview').textContent = 'Lese Datei …'
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true })
    const sheets = wb.SheetNames.map((name) => ({
      name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }),
    }))
    const { rows, sheetsUsed, skipped } = parseKdpWorkbook(sheets)
    if (!rows.length) throw new Error('Keine Verkaufsdaten erkannt. Ist das ein KDP-Bericht (Tantiemen/Bestellungen)?')
    const dates = rows.map((r) => r.date).sort()
    const s = sumSales(rows)
    pendingRows = rows
    $('#upload-preview').innerHTML = `<strong>${fmtNum(rows.length)} Datensätze</strong> erkannt
      (${new Date(dates[0]).toLocaleDateString('de-DE')} – ${new Date(dates[dates.length - 1]).toLocaleDateString('de-DE')})<br>
      ${fmtNum(s.units)} Einheiten · ${fmtNum(s.kenp)} KENP · ${royaltyText(s.royalty).main}${royaltyText(s.royalty).rest ? ' + ' + royaltyText(s.royalty).rest : ''}<br>
      <span class="muted">Blätter: ${sheetsUsed.map(esc).join(', ')}${skipped.length ? ` · übersprungen: ${skipped.map(esc).join(', ')}` : ''}</span>`
    $('#upload-submit').disabled = false
  } catch (err) {
    pendingRows = null
    $('#upload-preview').innerHTML = ''
    $('#upload-error').textContent = err.message
    $('#upload-submit').disabled = true
  }
}
$('#file').addEventListener('change', (e) => e.target.files[0] && handleFile(e.target.files[0]))
const drop = $('#drop')
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
drop.addEventListener('dragleave', () => drop.classList.remove('over'))
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('over')
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0])
})
$('#upload-submit').addEventListener('click', async (e) => {
  e.preventDefault()
  if (!pendingRows) return
  $('#upload-submit').disabled = true
  try {
    let added = 0, replaced = 0
    for (let i = 0; i < pendingRows.length; i += 3000) {
      const r = await api('sales', { method: 'POST', body: JSON.stringify({ rows: pendingRows.slice(i, i + 3000) }) })
      added += r.added; replaced += r.replaced
    }
    $('#dlg-upload').close()
    progress(`✓ Import abgeschlossen: ${fmtNum(added)} neu, ${fmtNum(replaced)} aktualisiert.`, 'ok')
    setTimeout(() => progress(''), 6000)
    load()
  } catch (err) {
    $('#upload-error').textContent = err.message
    $('#upload-submit').disabled = false
  }
})

// Einstellungen
$('#btn-settings').addEventListener('click', () => {
  const n = state.data.sales.length
  const dates = state.data.sales.map((r) => r.date)
  $('#settings-info').textContent = n
    ? `${fmtNum(n)} Verkaufsdatensätze gespeichert (${dates[0]} bis ${dates[dates.length - 1]}).`
    : 'Noch keine Verkaufsdaten importiert.'
  $('#fetch-info').textContent = fetchingText().replace(/^Amazon-Abruf: /, '')
  renderDriveInfo()
  $('#diag-asin').innerHTML = state.data.books.map((b) => `<option value="${b.asin}">${esc(b.label || latestOf(b.asin)?.title || b.asin)}</option>`).join('')
  $('#diag-row').hidden = !state.data.books.length
  $('#diag-out').innerHTML = ''
  $('#dlg-settings').showModal()
})
function renderDriveInfo() {
  const d = state.data.drive || {}
  $('#drive-section').hidden = !d.configured
  if (!d.configured) return
  $('#drive-info').innerHTML = [
    d.name ? `Zuletzt importiert: <strong>${esc(d.name)}</strong> (Datei vom ${new Date(d.modifiedTime).toLocaleString('de-DE')}, importiert ${rel(d.importedAt)})` : 'Noch nichts importiert.',
    d.checkedAt ? `Zuletzt geprüft ${rel(d.checkedAt)}. Wird stündlich und bei „Jetzt aktualisieren“ geprüft.` : '',
    d.error ? `<span class="error">⚠ ${esc(d.error)}</span>` : '',
  ].filter(Boolean).join('<br>')
}

$('#btn-drive').addEventListener('click', async () => {
  $('#btn-drive').disabled = true
  const r = await importDrive({ force: true })
  await load()
  renderDriveInfo()
  progress(driveResultText(r), r.error ? 'warn' : 'ok')
  $('#btn-drive').disabled = false
})

function shortError(msg) {
  if (/Bot-Schutz|Captcha|blockiert/i.test(msg)) return 'Von Amazon blockiert'
  if (/Kontingent|API-Key/i.test(msg)) return 'Scraping-Dienst: Key/Kontingent'
  if (/Zeitüberschreitung/i.test(msg)) return 'Zeitüberschreitung'
  if (/404/.test(msg)) return 'Nicht gefunden (ASIN?)'
  return msg.split(' – ')[0]
}

function fetchingText() {
  const f = state.data.fetching || {}
  const via = { direct: 'direkt von amazon.de', proxy: `über ${f.provider}`, fallback: `direkt, bei Ablehnung über ${f.provider}` }[f.mode] || 'direkt'
  return `Amazon-Abruf: ${via}, jedes Buch etwa alle ${nf.format(f.intervalHours || 3)} Std.`
}

$('#btn-diag').addEventListener('click', async () => {
  const out = $('#diag-out')
  out.innerHTML = '<p class="muted">Teste Abruf … (bis zu 10 Sekunden)</p>'
  $('#btn-diag').disabled = true
  try {
    const r = await api(`diagnose/${$('#diag-asin').value}`)
    const steps = r.log.map((l) => `<tr><td>${esc(l.step)}</td><td class="num">${l.status ?? '–'}</td><td class="num">${fmtNum(l.ms)} ms</td><td>${
      l.error ? esc(l.error) : l.blocked ? '⚠ Bot-Schutz/Captcha' : l.status >= 400 ? '⚠ abgelehnt' : '✓'}</td></tr>`).join('')
    const p = r.parsed
    out.innerHTML = `<p><strong>${r.ok ? `✓ Erfolgreich (${esc(r.via)})` : '⚠ Fehlgeschlagen'}</strong>${r.error ? ` – ${esc(r.error)}` : ''}</p>
      <table class="diag"><thead><tr><th>Schritt</th><th class="num">HTTP</th><th class="num">Dauer</th><th>Ergebnis</th></tr></thead><tbody>${steps}</tbody></table>
      ${p ? `<p class="muted">Gelesen: Preis ${p.price != null ? money(p.price) : '–'} · Bewertung ${p.rating != null ? nf1.format(p.rating) : '–'} · Rezensionen ${fmtNum(p.reviews)} · BSR ${p.bsr ? '#' + fmtNum(p.bsr) : '–'}</p>` : ''}`
  } catch (err) {
    out.innerHTML = `<p class="error">${esc(err.message)}</p>`
  } finally {
    $('#btn-diag').disabled = false
  }
})

$('#btn-clear-sales').addEventListener('click', async () => {
  if (!confirm('Wirklich alle importierten Verkaufsdaten löschen? Amazon-Daten (BSR, Bewertungen) bleiben erhalten.')) return
  await api('sales', { method: 'DELETE' })
  $('#dlg-settings').close()
  load()
})
$('#btn-logout').addEventListener('click', () => {
  store.del(TOKEN_KEY)
  $('#dlg-settings').close()
  showLogin()
})

// Automatisch neu laden, solange die Seite offen ist
setInterval(() => { if (!document.hidden && state.data) load().catch(() => {}) }, AUTO_RELOAD_MS)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.data && Date.now() - Date.parse(state.data.now) > AUTO_RELOAD_MS) load().catch(() => {})
})
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.data && render())

// Start
if (store.get(TOKEN_KEY)) load().catch((err) => { if (err.message !== 'unauthorized') showLogin(err.message) })
else showLogin()
