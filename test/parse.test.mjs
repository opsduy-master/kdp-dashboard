import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseProduct, parseNumber, isBlocked } from '../netlify/lib/scrape.mjs'
import { mergeSales } from '../netlify/lib/sales.mjs'
import { parseKdpWorkbook, toISODate } from '../public/kdp-parser.js'

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
