import { refreshDue } from '../lib/refresh.mjs'

// Läuft alle 15 Minuten und arbeitet in kleinen Portionen ab: Scheduled Functions dürfen max. 30 s laufen,
// und Abrufe über einen Scraping-Dienst brauchen oft 5–20 s. Wie oft ein Buch abgefragt wird,
// steuert REFRESH_INTERVAL_HOURS (Standard 3).
export default async () => {
  const { results, due } = await refreshDue({ startWindowMs: 8000, hardDeadline: Date.now() + 26000 })
  const summary = Object.fromEntries(Object.entries(results).map(([asin, r]) => [asin, r.lastError || `ok (${r.method})`]))
  console.log(`Fällig: ${due}, abgerufen: ${JSON.stringify(summary)}`)
}

export const config = { schedule: '*/15 * * * *' }
