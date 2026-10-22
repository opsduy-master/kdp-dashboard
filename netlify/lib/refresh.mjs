import { scrapeProduct } from './scrape.mjs'
import { appendHistory, getBooks, getStatus, saveBooks, saveStatus } from './store.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const MIN = 60 * 1000

export const refreshIntervalMs = () => (Number(process.env.REFRESH_INTERVAL_HOURS) || 3) * 60 * MIN

/** Wann ein Buch wieder dran ist: regulär nach dem Intervall, nach Fehlern mit wachsendem Abstand (30 min, 1 h, 2 h …). */
export function nextDueAt(entry, intervalMs = refreshIntervalMs()) {
  if (!entry) return 0
  if (entry.queued) return 0
  const last = Date.parse(entry.lastSuccess || 0) || 0
  if (!entry.lastError) return last + intervalMs
  const fails = Math.max(1, entry.failCount || 1)
  const backoff = Math.min(intervalMs, 30 * MIN * 2 ** (fails - 1))
  return (Date.parse(entry.lastAttempt || 0) || 0) + backoff
}

/** Aktualisiert ein einzelnes Buch und speichert Snapshot bzw. Fehler. */
export async function refreshBook(asin, { deadline, queueOnFailure = false } = {}) {
  const status = await getStatus()
  const entry = { ...(status[asin] || {}), lastAttempt: new Date().toISOString() }
  try {
    const { method, ...data } = await scrapeProduct(asin, { deadline })
    const snapshot = { t: entry.lastAttempt, ...data }
    await appendHistory(asin, snapshot)
    Object.assign(entry, { lastSuccess: entry.lastAttempt, lastError: null, failCount: 0, queued: false, method, latest: snapshot })
    const books = await getBooks()
    const book = books.find((b) => b.asin === asin)
    if (book) {
      let changed = false
      if (data.title && book.title !== data.title) { book.title = data.title; changed = true }
      // ASINs der anderen Ausgaben (Kindle, Taschenbuch, …) übernehmen, damit deren Verkäufe diesem Buch zugeordnet werden
      for (const f of data.formats || []) {
        if (f.asin && !(book.ids || []).includes(f.asin)) { book.ids = [...(book.ids || [book.asin]), f.asin]; changed = true }
      }
      if (changed) await saveBooks(books)
    }
  } catch (err) {
    entry.lastError = String(err?.message || err)
    entry.failCount = (entry.failCount || 0) + 1
    entry.method = err?.method || entry.method
    // Manueller Abruf zu langsam/abgelehnt → im Hintergrundjob erneut versuchen (der hat mehr Zeit)
    entry.queued = queueOnFailure && err?.status !== 404
  }
  // Status neu laden, damit parallele Läufe sich nicht überschreiben
  const fresh = await getStatus()
  fresh[asin] = entry
  await saveStatus(fresh)
  return entry
}

/**
 * Aktualisiert fällige Bücher (älteste zuerst). Neue Abrufe starten nur innerhalb von `startWindowMs`,
 * jeder Abruf muss bis `hardDeadline` fertig sein (Scheduled Functions dürfen max. 30 s laufen).
 */
export async function refreshDue({ startWindowMs = 8000, hardDeadline = Date.now() + 26000 } = {}) {
  const started = Date.now()
  const [books, status] = await Promise.all([getBooks(), getStatus()])
  const due = books
    .map((b) => ({ asin: b.asin, at: nextDueAt(status[b.asin]) }))
    .filter((b) => b.at <= started)
    .sort((a, b) => a.at - b.at)
  const results = {}
  for (const [i, { asin }] of due.entries()) {
    if (Date.now() - started > startWindowMs || hardDeadline - Date.now() < 6000) break
    if (i > 0) await sleep(1000 + Math.random() * 2000)
    results[asin] = await refreshBook(asin, { deadline: hardDeadline })
  }
  return { results, due: due.length }
}
