import * as XLSX from 'xlsx'
import { parseKdpWorkbook } from '../../public/kdp-parser.js'
import { mergeSales } from './sales.mjs'
import { getJSON, getSales, saveSales, setJSON } from './store.mjs'

const STATE_KEY = 'drive-import'

export const driveConfigured = () => Boolean(process.env.DRIVE_SCRIPT_URL)
export const getDriveState = () => getJSON(STATE_KEY, {})

/** Liest eine XLSX-Datei (Buffer) und liefert die KDP-Verkaufszeilen. */
export function parseWorkbookBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
  const sheets = wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' }),
  }))
  return parseKdpWorkbook(sheets)
}

/**
 * Holt über die Apps-Script-Web-App die neueste KDP_Dashboard-*.xlsx aus Google Drive und importiert sie.
 * Ist die Datei seit dem letzten Import unverändert, wird nichts heruntergeladen (außer bei force).
 */
export async function importFromDrive({ force = false, timeoutMs = 8000 } = {}) {
  if (!driveConfigured()) return { configured: false }
  const state = await getDriveState()
  const url = new URL(process.env.DRIVE_SCRIPT_URL)
  url.searchParams.set('token', process.env.DRIVE_SCRIPT_TOKEN || '')
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
    if (body.error) throw new Error(`Google Drive: ${body.error}`)
    if (body.unchanged) {
      const next = { ...state, checkedAt, error: null }
      await setJSON(STATE_KEY, next)
      return { configured: true, unchanged: true, ...next }
    }
    const { rows, sheetsUsed } = parseWorkbookBuffer(Buffer.from(body.data, 'base64'))
    if (!rows.length) throw new Error(`${body.name}: keine Verkaufsdaten erkannt`)
    const { rows: merged, added, replaced } = mergeSales(await getSales(), rows)
    await saveSales(merged)
    const next = {
      fileId: body.id, name: body.name, modifiedTime: body.modifiedTime,
      importedAt: checkedAt, checkedAt, rows: rows.length, added, replaced, sheetsUsed, error: null,
    }
    await setJSON(STATE_KEY, next)
    return { configured: true, imported: true, ...next }
  } catch (err) {
    const msg = err?.name === 'TimeoutError' ? 'Google Drive: Zeitüberschreitung' : String(err?.message || err)
    await setJSON(STATE_KEY, { ...state, checkedAt, error: msg })
    return { configured: true, error: msg, ...state }
  }
}
