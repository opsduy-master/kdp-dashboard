import { refreshDue } from '../lib/refresh.mjs'

// Läuft stündlich; jedes Buch wird höchstens alle ~3 Stunden abgefragt.
// Scheduled Functions dürfen max. 30 s laufen, daher das Zeitbudget.
export default async () => {
  const results = await refreshDue({ budgetMs: 14_000, minAgeMs: 170 * 60 * 1000 })
  console.log('Aktualisiert:', JSON.stringify(results))
}

export const config = { schedule: '7 * * * *' }
