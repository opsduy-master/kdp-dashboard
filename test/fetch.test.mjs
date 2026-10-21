import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { fetchProductHtml, fetchMode, proxyProvider, transport, httpsGet } from '../netlify/lib/fetch-amazon.mjs'
import http from 'node:http'
import zlib from 'node:zlib'
import { nextDueAt } from '../netlify/lib/refresh.mjs'

const realTransport = { ...transport }
const ENV_KEYS = ['SCRAPERAPI_KEY', 'SCRAPINGBEE_KEY', 'SCRAPEDO_TOKEN', 'SCRAPER_URL_TEMPLATE', 'SCRAPER_MODE']
let calls

function mockFetch(handler) {
  calls = []
  const fake = (kind) => async (url, opts = {}) => {
    calls.push({ kind, url: String(url), headers: opts.headers || {} })
    const { status = 200, body = '', cookies = [] } = handler(String(url), calls.length)
    return { status, ok: status >= 200 && status < 300, headers: { getSetCookie: () => cookies }, text: async () => body }
  }
  transport.direct = fake('direct')
  transport.proxy = fake('proxy')
}

beforeEach(() => { for (const k of ENV_KEYS) delete process.env[k] })
afterEach(() => Object.assign(transport, realTransport))

const PAGE = '<span id="productTitle">Buch</span>'

test('direkt: Cookie-Sitzung und Browser-Header werden mitgeschickt', async () => {
  mockFetch((url) => url === 'https://www.amazon.de/'
    ? { body: 'home', cookies: ['session-id=123-456; Path=/', 'i18n-prefs=EUR; Path=/'] }
    : { body: PAGE })
  const r = await fetchProductHtml('https://www.amazon.de/dp/B0TEST1234', { deadline: Date.now() + 5000 })
  assert.equal(r.method, 'direkt')
  const product = calls.find((c) => c.url.includes('/dp/'))
  assert.match(product.headers.Cookie, /session-id=123-456/)
  assert.equal(product.headers['Sec-Fetch-Mode'], 'navigate')
  assert.match(product.headers['User-Agent'], /Chrome\/\d+/)
})

test('direkt: 503 wird mit frischer Sitzung wiederholt und dann verständlich gemeldet', async () => {
  mockFetch((url) => url.includes('/dp/') ? { status: 503, body: 'To discuss automated access to Amazon data' } : { body: 'home' })
  await assert.rejects(
    fetchProductHtml('https://www.amazon.de/dp/B0TEST1234', { deadline: Date.now() + 15000 }),
    (err) => err.status === 503 && err.blocked && /Bot-Schutz/.test(err.message),
  )
  assert.equal(calls.filter((c) => c.url.includes('/dp/')).length, 2)
})

test('fallback: nach 503 übernimmt der Scraping-Dienst', async () => {
  process.env.SCRAPERAPI_KEY = 'geheim'
  process.env.SCRAPER_MODE = 'fallback'
  mockFetch((url) => url.startsWith('https://api.scraperapi.com/') ? { body: PAGE } : url.includes('amazon.de/dp') ? { status: 503 } : { body: 'home' })
  const r = await fetchProductHtml('https://www.amazon.de/dp/B0TEST1234', { deadline: Date.now() + 20000 })
  assert.equal(r.method, 'ScraperAPI')
  assert.match(calls.at(-1).url, /country_code=de&url=https%3A%2F%2Fwww\.amazon\.de%2Fdp%2FB0TEST1234/)
})

test('proxy-Modus ist Standard, sobald ein Dienst konfiguriert ist; 403 = Key/Kontingent', async () => {
  process.env.SCRAPEDO_TOKEN = 'x'
  assert.equal(fetchMode(), 'proxy')
  assert.equal(proxyProvider().name, 'Scrape.do')
  mockFetch(() => ({ status: 403 }))
  await assert.rejects(fetchProductHtml('https://www.amazon.de/dp/B0TEST1234'), /Kontingent/)
  assert.equal(calls.length, 1)
  assert.ok(calls[0].url.startsWith('https://api.scrape.do/'))
})

test('Backoff nach Fehlern, Warteschlange sofort fällig', () => {
  const H = 3600e3
  const t = Date.parse('2026-10-21T10:00:00Z')
  const iso = (ms) => new Date(ms).toISOString()
  assert.equal(nextDueAt({ lastSuccess: iso(t) }, 3 * H), t + 3 * H)
  assert.equal(nextDueAt({ lastSuccess: iso(t), lastAttempt: iso(t), lastError: 'x', failCount: 1 }, 3 * H), t + 0.5 * H)
  assert.equal(nextDueAt({ lastAttempt: iso(t), lastError: 'x', failCount: 3 }, 3 * H), t + 2 * H)
  assert.equal(nextDueAt({ lastAttempt: iso(t), lastError: 'x', failCount: 9 }, 3 * H), t + 3 * H)
  assert.equal(nextDueAt({ lastAttempt: iso(t), lastError: 'x', queued: true }, 3 * H), 0)
})

test('httpsGet: entpackt gzip/br und folgt Weiterleitungen mit Cookies (echter Socket)', async () => {
  // Lokaler Server ohne TLS: httpsGet nutzt https, daher hier nur die Logik über einen http-Server prüfen
  const srv = http.createServer((req, res) => {
    if (req.url === '/start') { res.writeHead(302, { location: '/ziel', 'set-cookie': 'session-id=abc; Path=/' }); return res.end() }
    res.writeHead(200, { 'content-encoding': 'br' })
    res.end(zlib.brotliCompressSync(JSON.stringify(req.headers)))
  })
  await new Promise((r) => srv.listen(0, r))
  const { port } = srv.address()
  const httpModule = await import('node:https')
  const orig = httpModule.default.get
  httpModule.default.get = (url, opts, cb) => http.get(String(url).replace('https:', 'http:'), opts, cb)
  try {
    const res = await httpsGet(`https://localhost:${port}/start`, { headers: { 'Sec-Fetch-Mode': 'navigate', Cookie: 'a=1' } })
    const got = JSON.parse(await res.text())
    assert.equal(got['sec-fetch-mode'], 'navigate')
    assert.equal(got.cookie, 'a=1; session-id=abc')
    assert.equal(got.accept, undefined)
  } finally {
    httpModule.default.get = orig
    srv.close()
  }
})
