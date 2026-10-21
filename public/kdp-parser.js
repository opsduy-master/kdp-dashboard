// Wertet KDP-Berichte (XLSX/CSV) aus. Erwartet pro Tabellenblatt ein Array von Zeilen (Arrays),
// so wie SheetJS es mit sheet_to_json(ws, { header: 1 }) liefert. Erkennt englische und deutsche Spaltennamen.

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

// Reihenfolge = Priorität (Strings = Teilwort, RegExp für ganze Wörter, z. B. damit "Dateigröße" kein Datum ist).
// exclude verhindert Verwechslungen (z. B. "Royalty Date" ist keine Tantieme).
const COLUMNS = {
  date: { match: ['royalty date', 'tantiemendatum', 'datum der tantieme', 'order date', /\bdate\b/, /^datum$/, 'datum'] },
  id: { match: ['asin/isbn', 'asin', 'isbn'] },
  title: { match: ['title', 'titel'] },
  marketplace: { match: ['marketplace', 'marktplatz'] },
  units: {
    match: ['net units sold', 'verkaufte einheiten (netto)', 'netto verkaufte einheiten', 'netto-einheiten', 'paid units', 'bezahlte einheiten', 'units sold', 'verkaufte einheiten'],
    exclude: ['refund', 'erstatt', 'free', 'kostenlos'],
  },
  kenp: { match: ['kenp'] },
  royalty: { match: ['royalty', 'tantiemen', 'tantieme'], exclude: ['date', 'datum', 'type', 'typ', 'rate', 'satz'] },
  currency: { match: ['currency', 'währung', 'waehrung'] },
}

function findColumns(header) {
  const h = header.map(norm)
  const cols = {}
  for (const [key, { match, exclude = [] }] of Object.entries(COLUMNS)) {
    outer: for (const m of match) {
      for (let i = 0; i < h.length; i++) {
        if (Object.values(cols).includes(i)) continue
        const hit = m instanceof RegExp ? m.test(h[i]) : h[i].includes(m)
        if (hit && !exclude.some((x) => h[i].includes(x))) {
          cols[key] = i
          break outer
        }
      }
    }
  }
  return cols
}

// Bestell-Blätter ("Verarbeitete/Aufgegebene Bestellungen", "Orders") überschneiden sich mit den Tantiemen-Blättern
const isOrdersSheet = (name) => /bestellung|order/.test(norm(name))

function formatFromSheet(name) {
  const n = norm(name)
  if (isOrdersSheet(name)) return null
  if (n.includes('kenp')) return 'kenp'
  if (n.includes('ebook') || n.includes('e-book') || n.includes('kindle')) return 'ebook'
  if (n.includes('paperback') || n.includes('taschenbuch')) return 'paperback'
  if (n.includes('hardcover') || n.includes('gebunden')) return 'hardcover'
  return null
}

const pad = (n) => String(n).padStart(2, '0')

export function toISODate(v) {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    // Excel-Seriennummer
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  const s = String(v).trim()
  let m
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  if ((m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/))) return `${m[3]}-${pad(m[1])}-${pad(m[2])}`
  if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return `${m[1]}-${pad(m[2])}-01`
  return null
}

export function toNumber(v) {
  if (typeof v === 'number') return v
  if (v == null) return 0
  let s = String(v).replace(/[^\d,.\-]/g, '')
  if (!s) return 0
  if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * @param {{name: string, rows: any[][]}[]} sheets
 * @returns {{rows: object[], sheetsUsed: string[], skipped: string[]}}
 */
export function parseKdpWorkbook(sheets) {
  const hasFormatSheets = sheets.some((s) => formatFromSheet(s.name))
  const hasRoyaltySheets = sheets.some((s) => !isOrdersSheet(s.name) && /royalt|tantieme|kenp/.test(norm(s.name)))
  const agg = new Map()
  const sheetsUsed = []
  const skipped = []

  for (const sheet of sheets) {
    const format = formatFromSheet(sheet.name)
    // "Combined Sales"/"Summary" doppelt die Einzelblätter – nur nutzen, wenn es keine gibt
    if (!format && hasFormatSheets) { skipped.push(sheet.name); continue }
    if (isOrdersSheet(sheet.name) && hasRoyaltySheets) { skipped.push(sheet.name); continue }

    const headerIdx = sheet.rows.slice(0, 15).findIndex((r) => {
      const c = findColumns(r || [])
      return c.date !== undefined && c.id !== undefined
    })
    if (headerIdx === -1) { skipped.push(sheet.name); continue }
    const cols = findColumns(sheet.rows[headerIdx])
    if (cols.units === undefined && cols.kenp === undefined && cols.royalty === undefined) {
      skipped.push(sheet.name); continue
    }
    sheetsUsed.push(sheet.name)

    for (const r of sheet.rows.slice(headerIdx + 1)) {
      if (!r) continue
      const date = toISODate(r[cols.date])
      const id = String(r[cols.id] ?? '').trim().toUpperCase().replace(/-/g, '')
      if (!date || !id) continue
      const row = {
        date,
        id,
        title: cols.title !== undefined ? String(r[cols.title] ?? '').trim() : '',
        marketplace: cols.marketplace !== undefined ? String(r[cols.marketplace] ?? '').trim() || 'unbekannt' : 'unbekannt',
        format: format || 'unbekannt',
        units: cols.units !== undefined ? toNumber(r[cols.units]) : 0,
        kenp: cols.kenp !== undefined ? toNumber(r[cols.kenp]) : 0,
        royalty: cols.royalty !== undefined ? toNumber(r[cols.royalty]) : 0,
        currency: cols.currency !== undefined ? String(r[cols.currency] ?? '').trim().toUpperCase() : '',
      }
      // Mehrere Zeilen pro Tag/Titel (z. B. 35 %/70 % Tantiemen) zusammenfassen
      const key = [row.date, row.id, row.marketplace, row.format].join('|')
      const prev = agg.get(key)
      if (prev) {
        prev.units += row.units
        prev.kenp += row.kenp
        prev.royalty += row.royalty
        prev.currency ||= row.currency
        prev.title ||= row.title
      } else agg.set(key, row)
    }
  }
  return { rows: [...agg.values()], sheetsUsed, skipped }
}
