import https from 'node:https'
import zlib from 'node:zlib'
import { getJSON, setJSON } from './store.mjs'

// Nur Chrome-UAs, damit User-Agent und Client-Hints (sec-ch-ua) zusammenpassen
const BROWSERS = [
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', platform: '"Windows"' },
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', platform: '"macOS"' },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36', platform: '"Windows"' },
]
const HOME = 'https://www.amazon.de/'
const SESSION_KEY = 'amazon-session'
const SESSION_MAX_AGE = 6 * 3600 * 1000

export class FetchError extends Error {
  constructor(message, { status = null, blocked = false, method = null } = {}) {
    super(message)
    this.status = status
    this.blocked = blocked
    this.method = method
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const enc = encodeURIComponent

export function isBlocked(html) {
  return /validateCaptcha|Geben Sie die angezeigten Zeichen|Enter the characters you see below|api-services-support@amazon\.com|To discuss automated access to Amazon data/i.test(html)
}

/** Konfigurierter Scraping-Dienst (per Umgebungsvariable), sonst null. */
export function proxyProvider(env = process.env) {
  if (env.SCRAPERAPI_KEY) return { name: 'ScraperAPI', url: (u) => `https://api.scraperapi.com/?api_key=${enc(env.SCRAPERAPI_KEY)}&country_code=de&url=${enc(u)}` }
  if (env.SCRAPINGBEE_KEY) return { name: 'ScrapingBee', url: (u) => `https://app.scrapingbee.com/api/v1/?api_key=${enc(env.SCRAPINGBEE_KEY)}&premium_proxy=true&country_code=de&render_js=false&url=${enc(u)}` }
  if (env.SCRAPEDO_TOKEN) return { name: 'Scrape.do', url: (u) => `https://api.scrape.do/?token=${enc(env.SCRAPEDO_TOKEN)}&geoCode=de&url=${enc(u)}` }
  if (env.SCRAPER_URL_TEMPLATE) return { name: 'Proxy', url: (u) => env.SCRAPER_URL_TEMPLATE.replace('{url}', enc(u)) }
  return null
}

/** direct | fallback (erst direkt, dann Dienst) | proxy (nur Dienst) */
export function fetchMode(env = process.env) {
  const provider = proxyProvider(env)
  const mode = (env.SCRAPER_MODE || '').toLowerCase()
  if (!provider) return 'direct'
  return ['direct', 'fallback', 'proxy'].includes(mode) ? mode : 'proxy'
}

function browserHeaders(browser, { cookies, referer } = {}) {
  const h = {
    'User-Agent': browser.ua,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'max-age=0',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': referer ? 'same-origin' : 'none',
    'Sec-Fetch-User': '?1',
    'sec-ch-ua': `"Google Chrome";v="${browser.ua.match(/Chrome\/(\d+)/)[1]}", "Chromium";v="${browser.ua.match(/Chrome\/(\d+)/)[1]}", "Not_A Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': browser.platform,
  }
  if (referer) h.Referer = referer
  if (cookies && Object.keys(cookies).length) h.Cookie = cookieHeader(cookies)
  return h
}

function mergeCookies(jar, res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  for (const c of list) {
    const [pair] = c.split(';')
    const i = pair.indexOf('=')
    if (i > 0) {
      const name = pair.slice(0, i).trim()
      const value = pair.slice(i + 1).trim()
      if (value && value !== '-') jar[name] = value
      else delete jar[name]
    }
  }
  return jar
}

const remaining = (deadline) => deadline - Date.now()

/**
 * GET über node:https statt fetch(): fetch() setzt erzwungen `sec-fetch-mode: cors` und eigene Accept-Header,
 * was Amazons Bot-Erkennung sofort auffällt. Liefert ein fetch-ähnliches Objekt.
 */
export function httpsGet(url, { headers = {}, timeoutMs = 10000, redirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      const status = res.statusCode
      const setCookies = [].concat(res.headers['set-cookie'] || [])
      if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
        res.resume()
        const next = new URL(res.headers.location, url).toString()
        // Cookies aus der Weiterleitung mitnehmen
        const jar = mergeCookies(parseCookieHeader(headers.Cookie), { headers: { getSetCookie: () => setCookies } })
        const h = { ...headers }
        if (Object.keys(jar).length) h.Cookie = cookieHeader(jar)
        return httpsGet(next, { headers: h, timeoutMs, redirects: redirects - 1 }).then(resolve, reject)
      }
      const enc = String(res.headers['content-encoding'] || '').toLowerCase()
      const stream = enc === 'br' ? res.pipe(zlib.createBrotliDecompress())
        : enc === 'gzip' ? res.pipe(zlib.createGunzip())
        : enc === 'deflate' ? res.pipe(zlib.createInflate())
        : res
      const chunks = []
      stream.on('data', (c) => chunks.push(c))
      stream.on('error', reject)
      stream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({ status, ok: status >= 200 && status < 300, headers: { getSetCookie: () => setCookies }, text: async () => body })
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('Timeout'), { name: 'TimeoutError' })))
    req.on('error', reject)
  })
}

// Austauschbar für Tests
export const transport = { direct: httpsGet, proxy: (url, { headers, timeoutMs }) => fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) }) }

const parseCookieHeader = (h) => Object.fromEntries(String(h || '').split(/;\s*/).filter(Boolean).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]))
const cookieHeader = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')

async function timedFetch(url, headers, deadline, log, label, kind = 'direct') {
  const t = Date.now()
  const ms = Math.max(1000, remaining(deadline))
  try {
    const res = await transport[kind](url, { headers, timeoutMs: ms })
    const html = await res.text()
    log?.push({ step: label, status: res.status, ms: Date.now() - t, bytes: html.length, blocked: isBlocked(html) })
    return { res, html }
  } catch (err) {
    log?.push({ step: label, error: err?.name === 'TimeoutError' ? 'Zeitüberschreitung' : String(err?.message || err), ms: Date.now() - t })
    if (err?.name === 'TimeoutError') throw new FetchError(`Zeitüberschreitung beim Abruf (${label})`, { method: label })
    throw new FetchError(`Netzwerkfehler (${label}): ${err?.message || err}`, { method: label })
  }
}

/** Holt (oder erneuert) eine Cookie-Sitzung über die Startseite – Amazon lehnt cookielose Erstaufrufe häufiger ab. */
async function getSession({ fresh = false, deadline, log }) {
  let session = fresh ? null : await getJSON(SESSION_KEY, null).catch(() => null)
  if (session && Date.now() - session.created < SESSION_MAX_AGE && session.cookies?.['session-id']) return session
  const browser = BROWSERS[Math.floor(Math.random() * BROWSERS.length)]
  session = { browser, cookies: {}, created: Date.now() }
  try {
    const { res } = await timedFetch(HOME, browserHeaders(browser), Math.min(deadline, Date.now() + 5000), log, 'Startseite (Cookies)')
    mergeCookies(session.cookies, res)
  } catch { /* ohne Cookies weitermachen */ }
  return session
}

async function fetchDirect(target, { deadline, log }) {
  let lastStatus = null
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      if (remaining(deadline) < 4000) break
      await sleep(1500 + Math.random() * 1500)
    }
    const session = await getSession({ fresh: attempt > 0, deadline, log })
    const { res, html } = await timedFetch(
      target,
      browserHeaders(session.browser, { cookies: session.cookies, referer: Object.keys(session.cookies).length ? HOME : undefined }),
      deadline, log, attempt ? 'Amazon direkt (2. Versuch)' : 'Amazon direkt',
    )
    mergeCookies(session.cookies, res)
    lastStatus = res.status
    if (res.status === 404) throw new FetchError('Produkt nicht gefunden (404) – ASIN prüfen', { status: 404, method: 'direkt' })
    if (res.ok && !isBlocked(html)) {
      await setJSON(SESSION_KEY, session).catch(() => {})
      return html
    }
    await setJSON(SESSION_KEY, null).catch(() => {}) // verbrannte Sitzung verwerfen
  }
  throw new FetchError(
    `Amazon-Bot-Schutz (HTTP ${lastStatus ?? '–'}): Netlify-Server werden von Amazon oft abgewiesen. Abhilfe: Scraping-Dienst in Netlify hinterlegen (siehe README).`,
    { status: lastStatus, blocked: true, method: 'direkt' },
  )
}

async function fetchViaProxy(target, provider, { deadline, log }) {
  const { res, html } = await timedFetch(provider.url(target), { Accept: 'text/html' }, deadline, log, provider.name, 'proxy')
  if (res.status === 401 || res.status === 403) {
    throw new FetchError(`${provider.name}: API-Key ungültig oder Kontingent aufgebraucht (HTTP ${res.status})`, { status: res.status, method: provider.name })
  }
  if (res.status === 404) throw new FetchError('Produkt nicht gefunden (404) – ASIN prüfen', { status: 404, method: provider.name })
  if (!res.ok) throw new FetchError(`${provider.name} konnte die Seite nicht laden (HTTP ${res.status}) – nächster Versuch folgt automatisch`, { status: res.status, method: provider.name })
  if (isBlocked(html)) throw new FetchError(`${provider.name}: Amazon hat trotz Proxy ein Captcha gezeigt – nächster Versuch folgt automatisch`, { blocked: true, method: provider.name })
  return html
}

/**
 * Lädt die Produktseite je nach Modus direkt, über einen Scraping-Dienst oder beides nacheinander.
 * @returns {Promise<{html: string, method: string}>}
 */
export async function fetchProductHtml(target, { deadline = Date.now() + 20000, log } = {}) {
  const provider = proxyProvider()
  const mode = fetchMode()
  if (mode === 'proxy') return { html: await fetchViaProxy(target, provider, { deadline, log }), method: provider.name }
  try {
    // Im Fallback-Modus nur kurz direkt probieren, damit Zeit für den Dienst bleibt
    const directDeadline = mode === 'fallback' ? Math.min(deadline, Date.now() + 6000) : deadline
    return { html: await fetchDirect(target, { deadline: directDeadline, log }), method: 'direkt' }
  } catch (err) {
    if (mode !== 'fallback' || err.status === 404) throw err
    return { html: await fetchViaProxy(target, provider, { deadline, log }), method: provider.name }
  }
}
