/** Schlüssel einer Verkaufszeile – gleiche Schlüssel aus einem neuen Upload ersetzen alte Werte. */
export const salesKey = (r) => [r.date, r.id, r.marketplace, r.format].join('|')

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export function sanitizeRow(r) {
  if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !r.id) return null
  return {
    date: r.date,
    id: String(r.id).trim().toUpperCase().slice(0, 20),
    title: String(r.title || '').slice(0, 300),
    marketplace: String(r.marketplace || 'unbekannt').slice(0, 40),
    format: String(r.format || 'unbekannt').slice(0, 20),
    units: num(r.units),
    kenp: num(r.kenp),
    royalty: num(r.royalty),
    currency: String(r.currency || '').slice(0, 5).toUpperCase(),
  }
}

/** Führt neue Zeilen mit bestehenden zusammen (neue gewinnen bei gleichem Schlüssel). */
export function mergeSales(existing, incoming) {
  const map = new Map(existing.map((r) => [salesKey(r), r]))
  let added = 0
  let replaced = 0
  for (const raw of incoming) {
    const r = sanitizeRow(raw)
    if (!r) continue
    const k = salesKey(r)
    if (map.has(k)) replaced++
    else added++
    map.set(k, r)
  }
  const rows = [...map.values()].sort((a, b) => a.date.localeCompare(b.date))
  return { rows, added, replaced }
}
