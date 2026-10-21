import { timingSafeEqual, createHash } from 'node:crypto'
import { refreshBook } from '../lib/refresh.mjs'
import { mergeSales } from '../lib/sales.mjs'
import { getBooks, getHistory, getSales, getStatus, saveBooks, saveSales, saveStatus, store } from '../lib/store.mjs'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })

const digest = (s) => createHash('sha256').update(String(s)).digest()

function authorized(req) {
  const expected = process.env.DASHBOARD_PASSWORD
  if (!expected) return 'missing'
  const given = req.headers.get('x-dashboard-token') || ''
  return timingSafeEqual(digest(given), digest(expected))
}

const ASIN_RE = /^[A-Z0-9]{10}$/
const normalizeIds = (ids) =>
  [...new Set((Array.isArray(ids) ? ids : String(ids || '').split(/[\s,;]+/))
    .map((s) => String(s).trim().toUpperCase().replace(/-/g, ''))
    .filter((s) => /^[A-Z0-9]{10,13}$/.test(s)))]

export default async (req) => {
  const auth = authorized(req)
  if (auth === 'missing') return json({ error: 'DASHBOARD_PASSWORD ist in Netlify nicht gesetzt.' }, 500)
  if (!auth) return json({ error: 'Falsches Passwort' }, 401)

  const url = new URL(req.url)
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '')
  const method = req.method

  try {
    if (route === 'data' && method === 'GET') {
      const [books, status, sales] = await Promise.all([getBooks(), getStatus(), getSales()])
      const histories = Object.fromEntries(
        await Promise.all(books.map(async (b) => [b.asin, await getHistory(b.asin)])),
      )
      return json({ books, status, histories, sales, now: new Date().toISOString() })
    }

    if (route === 'books' && method === 'POST') {
      const body = await req.json()
      const asin = String(body.asin || '').trim().toUpperCase()
      if (!ASIN_RE.test(asin)) return json({ error: 'Ungültige ASIN (10 Zeichen, z. B. B0ABC12345)' }, 400)
      const books = await getBooks()
      const existing = books.find((b) => b.asin === asin)
      const ids = normalizeIds([asin, ...normalizeIds(body.ids)])
      if (existing) {
        existing.ids = ids
        if (body.label !== undefined) existing.label = String(body.label).slice(0, 120)
      } else {
        books.push({ asin, ids, label: String(body.label || '').slice(0, 120), added: new Date().toISOString() })
      }
      await saveBooks(books)
      return json({ books })
    }

    const del = route.match(/^books\/([A-Z0-9]{10})$/i)
    if (del && method === 'DELETE') {
      const asin = del[1].toUpperCase()
      const books = (await getBooks()).filter((b) => b.asin !== asin)
      await saveBooks(books)
      const status = await getStatus()
      delete status[asin]
      await saveStatus(status)
      if (url.searchParams.get('history') === 'delete') await store().delete(`history/${asin}`)
      return json({ books })
    }

    const ref = route.match(/^refresh\/([A-Z0-9]{10})$/i)
    if (ref && method === 'POST') {
      // Synchrone Functions haben ~10 s Limit, daher kürzerer Timeout
      return json(await refreshBook(ref[1].toUpperCase(), { timeoutMs: 7000 }))
    }

    if (route === 'sales' && method === 'POST') {
      const body = await req.json()
      if (!Array.isArray(body.rows)) return json({ error: 'rows fehlt' }, 400)
      const { rows, added, replaced } = mergeSales(await getSales(), body.rows)
      await saveSales(rows)
      return json({ added, replaced, total: rows.length })
    }

    if (route === 'sales' && method === 'DELETE') {
      await saveSales([])
      return json({ total: 0 })
    }

    return json({ error: 'Nicht gefunden' }, 404)
  } catch (err) {
    console.error(err)
    return json({ error: String(err?.message || err) }, 500)
  }
}

export const config = { path: '/api/*' }
