import { getJSON, setJSON } from './store.mjs'

// Referenzkurse der Europäischen Zentralbank (werktags gegen 16 Uhr aktualisiert, kein API-Key nötig)
export const ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'
const KEY = 'fx-rates'
const MAX_AGE_MS = 12 * 3600 * 1000

/** Liest die EZB-XML: liefert { date, rates: { USD: 1.08, GBP: 0.86, … } } (Einheiten pro 1 EUR). */
export function parseEcbXml(xml) {
  const date = String(xml).match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1] || null
  const rates = {}
  for (const m of String(xml).matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)) rates[m[1]] = Number(m[2])
  return { date, rates }
}

/** Manueller Kurs aus der Umgebung, z. B. FX_USD=1.08 (USD pro 1 EUR) – überschreibt den EZB-Kurs. */
function envOverrides(env = process.env) {
  const out = {}
  for (const [k, v] of Object.entries(env)) {
    const m = k.match(/^FX_([A-Z]{3})$/)
    if (m && Number(v) > 0) out[m[1]] = Number(v)
  }
  return out
}

/**
 * Aktuelle Wechselkurse (Basis EUR). Gespeichert in Netlify Blobs und höchstens alle 12 Stunden neu geholt.
 * Schlägt der Abruf fehl, bleiben die zuletzt gespeicherten Kurse gültig.
 * @returns {Promise<{base: 'EUR', date: string|null, rates: Record<string, number>, source: string, fetchedAt?: string, error?: string}>}
 */
export async function getRates({ fetchImpl = fetch, now = Date.now(), timeoutMs = 2500 } = {}) {
  let cached = await getJSON(KEY, null).catch(() => null)
  if (!cached || now - Date.parse(cached.fetchedAt || 0) > MAX_AGE_MS) {
    try {
      const res = await fetchImpl(ECB_URL, { signal: AbortSignal.timeout(timeoutMs) })
      const parsed = parseEcbXml(await res.text())
      if (!res.ok || !parsed.rates.USD) throw new Error(`EZB-Kurse nicht lesbar (HTTP ${res.status})`)
      cached = { ...parsed, fetchedAt: new Date(now).toISOString() }
      await setJSON(KEY, cached).catch(() => {})
    } catch (err) {
      cached = { ...(cached || { date: null, rates: {} }), error: String(err?.message || err) }
    }
  }
  const overrides = envOverrides()
  return {
    base: 'EUR',
    date: cached.date,
    rates: { ...cached.rates, ...overrides },
    source: Object.keys(overrides).length ? 'EZB + manuell (FX_…)' : 'EZB',
    fetchedAt: cached.fetchedAt,
    ...(cached.error ? { error: cached.error } : {}),
  }
}
