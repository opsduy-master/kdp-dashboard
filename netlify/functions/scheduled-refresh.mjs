import { driveConfigured, getDriveState, importAllFromDrive } from '../lib/drive-import.mjs'
import { refreshDue } from '../lib/refresh.mjs'

const DRIVE_CHECK_EVERY_MS = 60 * 60 * 1000

// Läuft alle 15 Minuten und arbeitet in kleinen Portionen ab: Scheduled Functions dürfen max. 30 s laufen,
// und Abrufe über einen Scraping-Dienst brauchen oft 5–20 s. Wie oft ein Buch abgefragt wird,
// steuert REFRESH_INTERVAL_HOURS (Standard 3).
export default async () => {
  const start = Date.now()
  // Stündlich prüfen, ob in Google Drive ein neuer KDP- oder Werbebericht liegt (lädt nur bei Änderung herunter)
  if (driveConfigured()) {
    const { sales } = await getDriveState()
    if (!sales.checkedAt || start - Date.parse(sales.checkedAt) >= DRIVE_CHECK_EVERY_MS) {
      const r = await importAllFromDrive({ timeoutMs: 8000 })
      for (const x of [r.sales, r.ads]) {
        console.log(`Drive-Import (${x.kind}):`, x.error || (x.notFound ? 'keine Datei' : x.unchanged ? 'unverändert' : `${x.name}: ${x.added} neu, ${x.replaced} aktualisiert`))
      }
    }
  }
  const { results, due } = await refreshDue({ startWindowMs: Math.max(0, 8000 - (Date.now() - start)), hardDeadline: start + 26000 })
  const summary = Object.fromEntries(Object.entries(results).map(([asin, r]) => [asin, r.lastError || `ok (${r.method})`]))
  console.log(`Fällig: ${due}, abgerufen: ${JSON.stringify(summary)}`)
}

export const config = { schedule: '*/15 * * * *' }
