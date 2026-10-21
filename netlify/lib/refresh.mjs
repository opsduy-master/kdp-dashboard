import { scrapeProduct } from './scrape.mjs'
import { appendHistory, getBooks, getStatus, saveBooks, saveStatus } from './store.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Aktualisiert ein einzelnes Buch und speichert Snapshot bzw. Fehler. */
export async function refreshBook(asin, { timeoutMs } = {}) {
  const status = await getStatus()
  const entry = { ...(status[asin] || {}), lastAttempt: new Date().toISOString() }
  try {
    const data = await scrapeProduct(asin, { timeoutMs })
    const snapshot = { t: entry.lastAttempt, ...data }
    await appendHistory(asin, snapshot)
    entry.lastSuccess = entry.lastAttempt
    entry.lastError = null
    entry.latest = snapshot
    const books = await getBooks()
    const book = books.find((b) => b.asin === asin)
    if (book && data.title && book.title !== data.title) {
      book.title = data.title
      await saveBooks(books)
    }
  } catch (err) {
    entry.lastError = err?.name === 'TimeoutError' ? 'Zeitüberschreitung beim Abruf' : String(err?.message || err)
  }
  // Status neu laden, damit parallele Läufe sich nicht überschreiben
  const fresh = await getStatus()
  fresh[asin] = entry
  await saveStatus(fresh)
  return entry
}

/**
 * Aktualisiert die Bücher, deren letzter erfolgreicher Abruf am längsten zurückliegt,
 * bis das Zeitbudget aufgebraucht ist.
 */
export async function refreshDue({ budgetMs, minAgeMs }) {
  const started = Date.now()
  const [books, status] = await Promise.all([getBooks(), getStatus()])
  const due = books
    .map((b) => ({ asin: b.asin, last: Date.parse(status[b.asin]?.lastSuccess || 0) || 0 }))
    .filter((b) => started - b.last >= minAgeMs)
    .sort((a, b) => a.last - b.last)
  const results = {}
  for (const { asin } of due) {
    if (Date.now() - started > budgetMs) break
    results[asin] = await refreshBook(asin)
    await sleep(1000 + Math.random() * 2000)
  }
  return results
}
