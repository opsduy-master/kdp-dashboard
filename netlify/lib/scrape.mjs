import * as cheerio from 'cheerio'

import { fetchProductHtml, isBlocked } from './fetch-amazon.mjs'

export { isBlocked }

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

function firstText($, selectors) {
  for (const sel of selectors) {
    const t = $(sel).first().text().trim()
    if (t) return t
  }
  return ''
}

// Nur Preise aus der Buybox des angezeigten Produkts – kein seitenweiter Fallback, sonst landet z. B. der Preis
// aus „Wird oft zusammen gekauft“ oder aus Werbung für ein anderes Buch im Dashboard.
function parsePrice($) {
  const raw = firstText($, [
    '#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen',
    '#corePrice_feature_div .a-price:not(.a-text-price) .a-offscreen',
    '#corePrice_desktop .a-price:not(.a-text-price) .a-offscreen',
    '#apex_desktop .a-price:not(.a-text-price) .a-offscreen',
    '#newBuyBoxPrice',
    '#kindle-price',
    '#price',
    '#buybox .a-price:not(.a-text-price) .a-offscreen',
  ])
  return parseNumber(raw)
}

/** Normiert Formatnamen der Ausgaben-Kacheln: Kindle/eBook, Taschenbuch, gebundene Ausgabe, Hörbuch. */
export function formatKey(name) {
  const n = String(name || '').toLowerCase()
  if (/kindle|ebook|e-book/.test(n)) return 'ebook'
  if (/taschenbuch|paperback|broschiert/.test(n)) return 'paperback'
  if (/gebunden|hardcover/.test(n)) return 'hardcover'
  if (/hörbuch|audible|audio/.test(n)) return 'audio'
  return null
}

/**
 * Liest alle Ausgaben aus den Format-Kacheln (Kindle, Taschenbuch, …) mit Preis und – falls verlinkt – ASIN.
 * Unterstützt das neue Raster (#tmm-grid-swatch-*) und die ältere Liste (#tmmSwatches li.swatchElement).
 */
const isSelected = (e) => /(^|\s)selected(\s|$)/.test(e.attr('class') || '')

export function parseFormats($) {
  const out = []
  const push = (name, priceText, href, selected) => {
    const key = formatKey(name)
    if (!key || out.some((f) => f.key === key)) return
    const asin = String(href || '').match(/\/dp\/([A-Z0-9]{10})/)?.[1] || null
    out.push({ key, name: name.replace(/\s+/g, ' ').trim(), price: parseNumber(priceText), asin, selected })
  }
  $('[id^="tmm-grid-swatch-"]').each((_, el) => {
    const e = $(el)
    const title = e.find('.slot-title').first().text() || e.find('[aria-label$="Format:"]').first().text()
    const price = e.find('.slot-price').first().text()
    push(title, price, e.find('a[href*="/dp/"]').attr('href'), isSelected(e))
  })
  $('#tmmSwatches li.swatchElement, #tmmSwatches .swatchElement').each((_, el) => {
    const e = $(el)
    const title = e.find('.a-button-text > span').first().text() || e.find('a span').first().text()
    const price = e.find('.a-color-price, .slot-price, .a-color-secondary').first().text()
    push(title, price, e.find('a[href*="/dp/"]').attr('href'), isSelected(e) || e.find('.a-button-selected').length > 0)
  })
  return out
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
    formats: parseFormats($),
    currency: 'EUR',
    rating: parseRating($),
    reviews: parseReviewCount($),
    ...parseBsr($),
  }
}

/** Lädt die Produktseite und parst sie. `deadline` begrenzt die Gesamtdauer inkl. Wiederholungen. */
export async function scrapeProduct(asin, { deadline, log } = {}) {
  const { html, method } = await fetchProductHtml(productUrl(asin), { deadline, log })
  const data = parseProduct(html)
  if (!data.title && data.price == null && data.bsr == null) {
    throw new Error('Seite enthielt keine Produktdaten (evtl. Layout geändert oder blockiert)')
  }
  return { ...data, method }
}
