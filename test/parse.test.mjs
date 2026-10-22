import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProduct, parseNumber, isBlocked } from '../netlify/lib/scrape.mjs'
import { mergeSales } from '../netlify/lib/sales.mjs'
import { parseKdpWorkbook, toISODate } from '../public/kdp-parser.js'
import { sheets as kdpDashboardDe } from './fixtures/kdp-dashboard-de.mjs'

const PRODUCT_HTML = `<html><body>
<span id="productTitle"> Mein Testbuch: Ein Roman </span>
<span id="productSubtitle">Taschenbuch – 12. März 2025</span>
<img id="landingImage" data-old-hires="https://m.media-amazon.com/images/I/abc.jpg">
<div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">14,99 €</span></span></div>
<span id="acrPopover" title="4,6 von 5 Sternen"></span>
<span id="acrCustomerReviewText">1.234 Sternebewertungen</span>
<div id="detailBulletsWrapper_feature_div"><ul><li><span><span class="a-text-bold">Amazon Bestseller-Rang: </span>
 Nr. 12.345 in Bücher (<a href="#">Siehe Top 100 in Bücher</a>)
 <ul><li>Nr. 5 in Fantasy-Romane</li><li>Nr. 17 in Liebesromane für Jugendliche</li></ul></span></li></ul>
 <span>Kundenrezensionen:</span></div>
</body></html>`

test('parst Produktseite', () => {
  const p = parseProduct(PRODUCT_HTML)
  assert.equal(p.title, 'Mein Testbuch: Ein Roman')
  assert.equal(p.price, 14.99)
  assert.equal(p.rating, 4.6)
  assert.equal(p.reviews, 1234)
  assert.equal(p.bsr, 12345)
  assert.equal(p.bsrCategory, 'Bücher')
  assert.deepEqual(p.subRanks, [
    { rank: 5, category: 'Fantasy-Romane' },
    { rank: 17, category: 'Liebesromane für Jugendliche' },
  ])
  assert.equal(p.format, 'Taschenbuch')
  assert.equal(p.image, 'https://m.media-amazon.com/images/I/abc.jpg')
})

test('Zahlen und Captcha', () => {
  assert.equal(parseNumber('1.234.567'), 1234567)
  assert.equal(parseNumber('9,99 €'), 9.99)
  assert.equal(parseNumber('3.5'), 3.5)
  assert.ok(isBlocked('<form action="/errors/validateCaptcha">'))
})

test('KDP-Report: Einzelblätter, Combined wird übersprungen', () => {
  const sheets = [
    { name: 'Combined Sales', rows: [['Royalty Date', 'ASIN/ISBN', 'Net Units Sold', 'Royalty'], ['2026-10-01', 'B0TEST1234', 99, 99]] },
    {
      name: 'eBook Royalty',
      rows: [
        ['Sales Period', 'Oct 2026'],
        ['Royalty Date', 'Title', 'Author Name', 'ASIN', 'Marketplace', 'Royalty Type', 'Units Sold', 'Units Refunded', 'Net Units Sold', 'Royalty', 'Currency'],
        ['2026-10-01', 'Buch', 'X', 'B0TEST1234', 'Amazon.de', '70%', 3, 0, 3, '7,50', 'EUR'],
        ['2026-10-01', 'Buch', 'X', 'B0TEST1234', 'Amazon.de', '35%', 1, 0, 1, '1,00', 'EUR'],
      ],
    },
    { name: 'KENP Read', rows: [['Date', 'Title', 'ASIN', 'Marketplace', 'Kindle Edition Normalized Page (KENP) Read'], ['02.10.2026', 'Buch', 'B0TEST1234', 'Amazon.de', 420]] },
  ]
  const { rows, sheetsUsed, skipped } = parseKdpWorkbook(sheets)
  assert.deepEqual(skipped, ['Combined Sales'])
  assert.deepEqual(sheetsUsed, ['eBook Royalty', 'KENP Read'])
  const ebook = rows.find((r) => r.format === 'ebook')
  assert.equal(ebook.units, 4)
  assert.equal(ebook.royalty, 8.5)
  assert.equal(ebook.currency, 'EUR')
  const kenp = rows.find((r) => r.format === 'kenp')
  assert.equal(kenp.kenp, 420)
  assert.equal(kenp.date, '2026-10-02')
})

test('Datumsformate', () => {
  assert.equal(toISODate(46296), '2026-10-01')
  assert.equal(toISODate('10/21/2026'), '2026-10-21')
  assert.equal(toISODate('2026-09'), '2026-09-01')
})

test('Merge ersetzt gleiche Schlüssel', () => {
  const a = mergeSales([], [{ date: '2026-10-01', id: 'b0x', marketplace: 'Amazon.de', format: 'ebook', units: 2 }])
  const b = mergeSales(a.rows, [{ date: '2026-10-01', id: 'B0X', marketplace: 'Amazon.de', format: 'ebook', units: 5 }, { date: 'kaputt', id: 'Y' }])
  assert.equal(b.replaced, 1)
  assert.equal(b.added, 0)
  assert.equal(b.rows[0].units, 5)
})

test('Deutscher KDP-Dashboard-Export (Struktur wie KDP_Dashboard-*.xlsx)', () => {
  const { rows, sheetsUsed } = parseKdpWorkbook(kdpDashboardDe)
  assert.deepEqual(sheetsUsed, ['eBook-Tantiemen', 'Taschenbuchtantiemen', 'Tantiemen für gebundene Ausgabe', 'KENP'])
  const sum = (f, fmt) => rows.filter((r) => !fmt || r.format === fmt).reduce((s, r) => s + r[f], 0)
  // Kontrollsummen aus dem Blatt "Übersicht"
  assert.equal(sum('units', 'ebook'), 7)
  assert.equal(sum('units', 'paperback'), 5)
  assert.equal(sum('kenp'), 967)
  assert.equal(Math.round(sum('royalty') * 100) / 100, 25.44)
  // Taschenbuch wird der Taschenbuch-ASIN zugeordnet (passt zur ASIN im Dashboard)
  assert.ok(rows.some((r) => r.format === 'paperback' && r.id === 'B0HM7F67KW'))
})

test('Server-Import: echte XLSX-Datei (Buffer) ergibt dieselben Summen', async () => {
  const XLSX = await import('xlsx')
  const { parseWorkbookBuffer } = await import('../netlify/lib/drive-import.mjs')
  const wb = XLSX.utils.book_new()
  for (const s of kdpDashboardDe) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name)
  const { rows } = parseWorkbookBuffer(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  assert.equal(rows.reduce((s, r) => s + r.units, 0), 12)
  assert.equal(rows.reduce((s, r) => s + r.kenp, 0), 967)
  assert.equal(Math.round(rows.reduce((s, r) => s + r.royalty, 0) * 100) / 100, 25.44)
})

test('Sponsored-Products-Bericht (Amazon Ads, deutsch)', async () => {
  const { parseAdsWorkbook, guessBookForCampaign } = await import('../public/kdp-parser.js')
  const { sheets } = await import('./fixtures/sponsored-products-de.mjs')
  const { rows, sheetsUsed } = parseAdsWorkbook(sheets)
  assert.deepEqual(sheetsUsed, ['Sponsored_Products_Targeting_Be'])
  assert.equal(rows.length, 5)
  const r = rows.find((x) => x.date === '2026-10-20')
  assert.deepEqual(
    { campaign: r.campaign, targeting: r.targeting, matchType: r.matchType, impressions: r.impressions, clicks: r.clicks, spend: r.spend, sales: r.sales, orders: r.orders, units: r.units },
    { campaign: 'Krimi Sodoku / Kampagne A', targeting: 'krimi sudoku', matchType: 'EXACT', impressions: 120, clicks: 3, spend: 1.23, sales: 12.99, orders: 1, units: 1 },
  )
  const w = rows.find((x) => x.targeting === 'was wäre wenn buch')
  assert.equal(w.kenp, 120)
  assert.equal(w.kenpRoyalty, 0.52)
  // KDP-Parser ignoriert Werbeberichte
  assert.equal(parseKdpWorkbook(sheets).rows.length, 0)
  // Zuordnungsvorschlag trotz Tippfehler "Sodoku"
  const books = [{ asin: 'B0HM7F67KW', name: 'Krimi Sudoku: Die Akte Uhrmacher' }, { asin: 'B0HMV9C6BL', name: 'Was wäre, wenn...?: Das Buch für Teenager' }]
  assert.equal(guessBookForCampaign('Krimi Sodoku / Kampagne A', books), 'B0HM7F67KW')
  assert.equal(guessBookForCampaign('Was wäre wenn / Kampagne D', books), 'B0HMV9C6BL')
  assert.equal(guessBookForCampaign('Ganz andere Kampagne', books), null)
})

test('Sponsored-Products-Bericht, neues Konsolen-Format („Gesamtkosten“, „Verkäufe“, „Käufe“)', async () => {
  const { parseAdsWorkbook } = await import('../public/kdp-parser.js')
  const { sheets, header } = await import('./fixtures/sponsored-products-de-neu.mjs')
  const { rows } = parseAdsWorkbook(sheets)
  assert.equal(rows.length, 7)
  const r = rows.find((x) => x.date === '2026-10-21' && x.targeting === 'krimi sudoku')
  assert.deepEqual(
    { campaign: r.campaign, matchType: r.matchType, impressions: r.impressions, clicks: r.clicks, spend: r.spend, sales: r.sales, kenp: r.kenp, orders: r.orders, units: r.units, currency: r.currency },
    { campaign: 'Krimi Sodoku / Kampagne A', matchType: 'EXACT', impressions: 3, clicks: 2, spend: 1.1, sales: 12.99, kenp: 35, orders: 1, units: 1, currency: 'EUR' },
  )
  assert.ok(header.includes('Gesamtkosten'))
  // Automatische Ausrichtung: altes („-“) und neues Format landen auf demselben Schlüssel
  const { sheets: alt } = await import('./fixtures/sponsored-products-de.mjs')
  assert.equal(rows.find((x) => x.targeting === 'close-match').matchType, 'AUTO')
  assert.equal(parseAdsWorkbook(alt).rows.find((x) => x.targeting === 'close-match').matchType, 'AUTO')
})

// Kindle-Produktseite mit Format-Kacheln (neues Raster) und einem fremden Preis im Karussell
const KINDLE_PAGE = `<html><body>
<span id="productTitle">Was wäre, wenn...?: Das Buch für Teenager ab 12</span>
<span id="productSubtitle">Kindle Ausgabe</span>
<div id="tmmSwatches">
  <div id="tmm-grid-swatch-KINDLE" class="a-row swatchElement selected">
    <a href="javascript:void(0)"><span class="slot-title"><span aria-label="Kindle Format:">Kindle</span></span>
    <span class="slot-price"><span aria-label="0,99 €">0,99 €</span></span></a></div>
  <div id="tmm-grid-swatch-PAPERBACK" class="a-row swatchElement">
    <a href="/Was-w%C3%A4re-wenn/dp/B0HPAPER12/ref=tmm_pap_swatch_0"><span class="slot-title"><span aria-label="Taschenbuch Format:">Taschenbuch</span></span>
    <span class="slot-price"><span aria-label="12,99 €">12,99 €</span></span></a></div>
</div>
<div id="kindle-price">0,99 €</div>
<div id="sp_detail"><span class="a-price"><span class="a-offscreen">7,49 €</span></span></div>
</body></html>`

// Ältere Taschenbuch-Seite mit Listen-Kacheln, ohne Buybox-Preis
const PAPERBACK_OLD = `<html><body>
<span id="productTitle">Krimi Sudoku</span>
<div id="tmmSwatches"><ul>
  <li class="swatchElement unselected"><span class="a-button"><a class="a-button-text" href="/dp/B0HKINDLE1"><span>Kindle</span><br><span class="a-color-secondary">2,99 €</span></a></span></li>
  <li class="swatchElement selected"><span class="a-button a-button-selected"><a class="a-button-text" href="javascript:void(0)"><span>Taschenbuch</span><br><span class="a-color-price">14,99 €</span></a></span></li>
</ul></div>
<div class="similarities"><span class="a-price"><span class="a-offscreen">9,95 €</span></span></div>
</body></html>`

test('Preise: Ausgaben-Kacheln, kein fremder Karussell-Preis', () => {
  const k = parseProduct(KINDLE_PAGE)
  assert.equal(k.price, 0.99)
  assert.deepEqual(k.formats.map((f) => [f.key, f.price, f.asin, f.selected]), [['ebook', 0.99, null, true], ['paperback', 12.99, 'B0HPAPER12', false]])
  const p = parseProduct(PAPERBACK_OLD)
  assert.equal(p.price, null) // früher: 9,95 € aus „Ähnliche Artikel“
  assert.deepEqual(p.formats.map((f) => [f.key, f.price, f.asin, f.selected]), [['ebook', 2.99, 'B0HKINDLE1', false], ['paperback', 14.99, null, true]])
})
