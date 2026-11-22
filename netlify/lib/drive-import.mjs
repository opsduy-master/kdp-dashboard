import * as XLSX from 'xlsx'
import { parseAdsWorkbook, parseKdpWorkbook } from '../../public/kdp-parser.js'
import { mergeAds, mergeSales } from './sales.mjs'
import { getAds, getJSON, getSales, saveAds, saveSales, setJSON } from './store.mjs'

/** Welche Dateien aus dem Drive-Ordner importiert werden. */
const KINDS = {
  sales: { prefix: 'KDP_Dashboard', stateKey: 'drive-import', label: 'KDP-Bericht', parse: parseKdpWorkbook, get: getSales, save: saveSales, merge: mergeSales },
  ads: { prefix: 'Sponsored_Products', stateKey: 'drive-import-ads', label: 'Werbebericht', parse: parseAdsWorkbook, get: getAds, save: saveAds, merge: mergeAds },
  // Werbebericht aus der US-Werbekonsole (amazon.com): Datei in Drive mit „US_“ vor dem Namen ablegen.
  // optional: fehlt die Datei oder ist das Apps Script älter als Version 4, gilt das nicht als Fehler.
  // Erkannt werden „US_Sponsored_Products…“ und „Sponsored_Products…_US.csv/.xlsx“ (ab Apps Script Version 5).
  adsUs: { prefix: 'US_Sponsored_Products', stateKey: 'drive-import-ads-us', label: 'Werbebericht USA', parse: parseAdsWorkbook, get: getAds, save: saveAds, merge: mergeAds, optional: true, minScript: 5 },
}

/** Kurzform der Bereitstellungs-ID aus der Web-App-URL, z. B. „AKfycb…X4PoA“ – zum Abgleich mit „Bereitstellungen verwalten“. */
export function deploymentLabel(url) {
  const id = String(url).match(/\/macros\/s\/([^/]+)\//)?.[1]
  return id ? `${id.slice(0, 6)}…${id.slice(-5)}` : 'unbekannte URL'
}

export const driveConfigured = () => Boolean(process.env.DRIVE_SCRIPT_URL)

export async function getDriveState() {
  const [sales, ads, adsUs] = await Promise.all(Object.values(KINDS).map((k) => getJSON(k.stateKey, {})))
  return { sales, ads, adsUs }
}

/**
 * Liest XLSX oder CSV. CSV wird ohne automatische Typerkennung gelesen, weil SheetJS sonst
 * deutsche Datumsangaben wie „10.11.2026“ amerikanisch (als 11. Oktober) deutet.
 */
export function readSheets(buf, name = '') {
  const wb = /\.csv$/i.test(name)
    ? XLSX.read(Buffer.from(buf).toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true })
    : XLSX.read(buf, { type: 'buffer', cellDates: true })
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }),
  }))
}

/** Liest eine XLSX-Datei (Buffer) und liefert die KDP-Verkaufszeilen. */
export const parseWorkbookBuffer = (buf) => parseKdpWorkbook(readSheets(buf))

/**
 * Holt über die Apps-Script-Web-App die neueste Datei einer Art (KDP-Bericht oder Werbebericht) und importiert sie.
 * Ist die Datei seit dem letzten Import unverändert, wird nichts heruntergeladen (außer bei force).
 */
export async function importFromDrive({ kind = 'sales', force = false, timeoutMs = 8000 } = {}) {
  if (!driveConfigured()) return { configured: false }
  const k = KINDS[kind]
  const state = await getJSON(k.stateKey, {})
  const url = new URL(process.env.DRIVE_SCRIPT_URL.trim())
  url.searchParams.set('token', (process.env.DRIVE_SCRIPT_TOKEN || '').trim())
  url.searchParams.set('prefix', k.prefix)
  if (!force && state.modifiedTime) {
    url.searchParams.set('since', state.modifiedTime)
    url.searchParams.set('id', state.fileId || '')
  }
  const checkedAt = new Date().toISOString()
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch {
      throw new Error(`Apps Script antwortet nicht mit JSON (HTTP ${res.status}) – ist die Web-App mit Zugriff „Jeder“ bereitgestellt?`)
    }
    // Scripts vor Version 3 kennen „prefix“ nicht, vor Version 4 kennen sie den US-Werbebericht nicht
    if (k.optional && ((body.prefix || 'KDP_Dashboard') !== k.prefix || (body.scriptVersion || 0) < k.minScript)) {
      const next = { ...state, checkedAt, error: null, notFound: true, needsScript: k.minScript }
      await setJSON(k.stateKey, next)
      return { configured: true, kind, notFound: true, ...next }
    }
    if (body.notFound) {
      const next = { ...state, checkedAt, error: null, notFound: true, needsScript: null }
      await setJSON(k.stateKey, next)
      return { configured: true, kind, notFound: true, ...next }
    }
    if (body.error) {
      // Alte Script-Version (vor scriptVersion 2) liefert nur die knappe Meldung
      const hint = body.scriptVersion ? '' : ` – Hinweis: Die aufgerufene Bereitstellung (${deploymentLabel(url)}) liefert noch den alten Code. ` +
        'Im Apps Script unter „Bereitstellen → Bereitstellungen verwalten“ genau diese Bereitstellung bearbeiten und „Neue Version“ wählen – oder die URL in DRIVE_SCRIPT_URL auf die neue Bereitstellung ändern.'
      throw new Error(`Google Drive: ${body.error}${hint}`)
    }
    // Scripts vor Version 3 kennen „prefix“ nicht und liefern immer den KDP-Bericht
    if ((body.prefix || 'KDP_Dashboard') !== k.prefix) {
      throw new Error('Google Drive: Für Werbeberichte bitte den Apps-Script-Code aus dem Repo (Version 3) einfügen und eine neue Version bereitstellen.')
    }
    if (body.unchanged) {
      const next = { ...state, checkedAt, error: null, notFound: false }
      await setJSON(k.stateKey, next)
      return { configured: true, kind, unchanged: true, ...next }
    }
    const { rows, sheetsUsed, headers } = k.parse(readSheets(Buffer.from(body.data, 'base64'), body.name))
    if (!rows.length) {
      const cols = (headers?.[0] || []).slice(0, 14).join(', ')
      throw new Error(`${body.name}: keine Daten erkannt${cols ? ` – unbekanntes Spaltenformat (${cols} …)` : ''}`)
    }
    const { rows: merged, added, replaced } = k.merge(await k.get(), rows)
    await k.save(merged)
    const next = {
      fileId: body.id, name: body.name, modifiedTime: body.modifiedTime,
      importedAt: checkedAt, checkedAt, rows: rows.length, added, replaced, sheetsUsed, error: null, notFound: false, needsScript: null,
    }
    await setJSON(k.stateKey, next)
    return { configured: true, kind, imported: true, ...next }
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? 'Google Drive: Zeitüberschreitung' : String(err?.message || err)
    await setJSON(k.stateKey, { ...state, checkedAt, error: msg })
    return { configured: true, kind, error: msg, ...state }
  }
}

/** KDP-Bericht und Werbeberichte (DE und USA) parallel abholen. */
export async function importAllFromDrive(opts = {}) {
  if (!driveConfigured()) return { configured: false }
  // Werbeberichte nacheinander, weil beide in dieselbe Liste „ads“ schreiben
  const [sales, ads] = await Promise.all([
    importFromDrive({ ...opts, kind: 'sales' }),
    importFromDrive({ ...opts, kind: 'ads' }).then(async (ads) => [ads, await importFromDrive({ ...opts, kind: 'adsUs' })]),
  ])
  return { configured: true, sales, ads: ads[0], adsUs: ads[1] }
}
