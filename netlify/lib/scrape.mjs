import * as cheerio from 'cheerio'

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
]

export const productUrl = (asin) => `https://www.amazon.de/dp/${asin}`

/** "12,99 €" -> 12.99, "1.234" -> 1234 (deutsche Schreibweise) */
export function parseNumber(text) {
  if (text == null) return null
  const cleaned = String(text).replace(/[^\d.,]/g, '')
  if (!cleaned) return null
  let normalized
  if (cleaned.includes(',')) normalized = cleaned.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) normalized = cleaned.replace(/\./g, '')
  else normalized = cleaned
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export function isBlocked(html) {
  return /validateCaptcha|Geben Sie die angezeigten Zeichen|Enter the characters you see below|api-services-support@amazon\.com/i.test(html)
}

function firstText($, selectors) {
  for (const sel of selectors) {
    const t = $(sel).first().text().trim()
    if (t) return t
  }
  return ''
}

function parsePrice($) {
  const raw = firstText($, [
    '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
    '#corePrice_feature_div .a-price .a-offscreen',
    '#kindle-price',
    '#price',
    '#tmmSwatches .a-button-selected .slot-price',
    '#tmmSwatches .a-button-selected .a-color-price',
    '#booksHeaderSection + * .a-price .a-offscreen',
    '.a-price .a-offscreen',
  ])
  return parseNumber(raw)
}

function parseRating($) {
  const candidates = [
    $('#acrPopover').attr('title'),
    $('#acrPopover .a-icon-alt').first().text(),
    $('[data-hook="rating-out-of-text"]').first().text(),
    $('#averageCustomerReviews .a-icon-alt').first().text(),
  ]
  for (const c of candidates) {
    const m = c && c.match(/([\d]+[,.]?\d*)\s*(von|out of)\s*5/i)
    if (m) return parseNumber(m[1])
  }
  return null
}

function parseReviewCount($) {
  const raw = firstText($, ['#acrCustomerReviewText', '[data-hook="total-review-count"]'])
  if (!raw) return null
  const m = raw.match(/[\d.,]+/)
  return m ? parseNumber(m[0]) : null
}

function parseBsr($) {
  const blocks = [
    '#detailBulletsWrapper_feature_div',
    '#detailBullets_feature_div',
    '#productDetails_detailBullets_sections1',
    '#productDetails_db_sections',
    '#prodDetails',
    '#SalesRank',
  ]
  let text = ''
  for (const sel of blocks) text += ' ' + $(sel).text()
  text = text.replace(/\s+/g, ' ')
  const idx = text.search(/Bestseller-Rang|Best Sellers Rank/i)
  if (idx === -1) return { bsr: null, bsrCategory: null, subRanks: [] }
  const section = text.slice(idx, idx + 1200)
  const ranks = []
  const re = /(?:Nr\.|#)\s*([\d.,]+)\s+in\s+(.+?)(?=\s*\(|\s*(?:Nr\.|#)\s*\d|\s*Kundenrezensionen|\s*Customer Reviews|$)/gi
  let m
  while ((m = re.exec(section)) && ranks.length < 6) {
    const rank = parseNumber(m[1])
    const category = m[2].trim().replace(/[\s:.]+$/, '')
    if (rank != null && category) ranks.push({ rank, category })
  }
  if (!ranks.length) return { bsr: null, bsrCategory: null, subRanks: [] }
  const [main, ...rest] = ranks
  return { bsr: main.rank, bsrCategory: main.category, subRanks: rest }
}

function parseFormat($) {
  const sub = $('#productSubtitle').text().replace(/\s+/g, ' ').trim()
  if (sub) return sub.split('–')[0].split('-')[0].trim()
  const sel = $('#tmmSwatches .a-button-selected .slot-title, #tmmSwatches .a-button-selected a span').first().text().trim()
  return sel || null
}

export function parseProduct(html) {
  const $ = cheerio.load(html)
  const title = $('#productTitle').text().trim() || $('#ebooksProductTitle').text().trim() || null
  const image =
    $('#landingImage').attr('data-old-hires') ||
    $('#landingImage').attr('src') ||
    $('#imgBlkFront').attr('src') ||
    $('#ebooksImgBlkFront').attr('src') ||
    $('#main-image').attr('src') ||
    null
  return {
    title,
    image,
    format: parseFormat($),
    price: parsePrice($),
    currency: 'EUR',
    rating: parseRating($),
    reviews: parseReviewCount($),
    ...parseBsr($),
  }
}

/** Lädt die Produktseite (direkt oder über einen optionalen Scraping-Proxy) und parst sie. */
export async function scrapeProduct(asin, { timeoutMs = 12000 } = {}) {
  const target = productUrl(asin)
  const template = process.env.SCRAPER_URL_TEMPLATE
  const url = template ? template.replace('{url}', encodeURIComponent(target)) : target
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'de-DE,de;q=0.9,en;q=0.6',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 404) throw new Error('Produkt nicht gefunden (404) – ASIN prüfen')
  if (!res.ok) throw new Error(`HTTP ${res.status} von Amazon`)
  const html = await res.text()
  if (isBlocked(html)) throw new Error('Von Amazon blockiert (Captcha) – wird beim nächsten Lauf erneut versucht')
  const data = parseProduct(html)
  if (!data.title && data.price == null && data.bsr == null) {
    throw new Error('Seite enthielt keine Produktdaten (evtl. Layout geändert oder blockiert)')
  }
  return data
}
