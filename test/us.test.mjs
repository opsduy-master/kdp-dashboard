import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { parseProduct, parseNumber, productUrl } from '../netlify/lib/scrape.mjs'
import { fetchProductHtml, proxyProvider, transport } from '../netlify/lib/fetch-amazon.mjs'
import { parseEcbXml } from '../netlify/lib/fx.mjs'
import { marketplace, marketplaceForUrl } from '../netlify/lib/marketplaces.mjs'
import { currencyForMarketplace, parseAdsWorkbook, parseKdpWorkbook } from '../public/kdp-parser.js'

const realTransport = { ...transport }
afterEach(() => Object.assign(transport, realTransport))

// Ausschnitt einer amazon.com-Produktseite (Taschenbuch, US-Zahlenformat)
const US_PAGE = `
<span id="productTitle">JuniorDoku: Detective Sudoku for Kids</span>
<div id="tmmSwatches"><ul>
  <li class="swatchElement selected"><span class="a-button a-button-selected"><a class="a-button-text" href="javascript:void(0)"><span>Paperback</span><br><span class="a-color-price">$11.99</span></a></span></li>
</ul></div>
<div id="corePriceDisplay_desktop_feature_div"><span class="a-price"><span class="a-offscreen">$11.99</span></span></div>
<span id="acrPopover" title="4.8 out of 5 stars"></span>
<span id="acrCustomerReviewText">1,234 ratings</span>
<div id="detailBulletsWrapper_feature_div"><ul>
  <li><span class="a-text-bold">Best Sellers Rank:</span> #12,345 in Books (See Top 100 in Books)
    <ul><li>#7 in Children's Logic Puzzles</li><li>#1,024 in Children's Mysteries &amp; Detectives</li></ul></li>
</ul></div>`

test('amazon.com: US-Zahlen, USD und BSR werden richtig gelesen', () => {
  const p = parseProduct(US_PAGE, { marketplace: 'com' })
  assert.equal(p.currency, 'USD')
  assert.equal(p.price, 11.99)
  assert.equal(p.rating, 4.8)
  assert.equal(p.reviews, 1234)
  assert.equal(p.bsr, 12345)
  assert.equal(p.bsrCategory, 'Books')
  assert.deepEqual(p.subRanks.map((r) => r.rank), [7, 1024])
  assert.equal(p.formats[0].key, 'paperback')
})

test('amazon.de bleibt Standard (deutsches Zahlenformat, EUR)', () => {
  assert.equal(parseProduct('<span id="productTitle">x</span>').currency, 'EUR')
  assert.equal(parseNumber('1.234'), 1234)
  assert.equal(parseNumber('1,234', 'en'), 1234)
  assert.equal(parseNumber('$1,299.50', 'en'), 1299.5)
  assert.equal(productUrl('B0HQF5HHGX', 'com'), 'https://www.amazon.com/dp/B0HQF5HHGX')
  assert.equal(productUrl('B0HQF5HHGX'), 'https://www.amazon.de/dp/B0HQF5HHGX')
  assert.equal(marketplace('xx').key, 'de')
  assert.equal(marketplaceForUrl('https://www.amazon.com/dp/X').key, 'com')
})

test('amazon.com: Cookie-Sitzung über amazon.com, englische Sprache, Proxy mit Land us', async () => {
  const calls = []
  transport.direct = async (url, { headers }) => {
    calls.push({ url, headers })
    return { status: 200, ok: true, headers: { getSetCookie: () => ['session-id=1; Path=/'] }, text: async () => '<span id="productTitle">x</span>' }
  }
  await fetchProductHtml('https://www.amazon.com/dp/B0HQF5HHGX', { deadline: Date.now() + 5000 })
  assert.ok(calls.some((c) => c.url === 'https://www.amazon.com/'))
  assert.match(calls.at(-1).headers['Accept-Language'], /^en-US/)
  const p = proxyProvider({ SCRAPERAPI_KEY: 'k' })
  assert.match(p.url('https://www.amazon.com/dp/B0HQF5HHGX'), /country_code=us&/)
  assert.match(p.url('https://www.amazon.de/dp/B0HQF5HHGX'), /country_code=de&/)
})

test('EZB-Kurse lesen', () => {
  const xml = `<gesmes:Envelope><Cube><Cube time='2026-11-06'>
    <Cube currency='USD' rate='1.0812'/><Cube currency='GBP' rate='0.8421'/></Cube></Cube></gesmes:Envelope>`
  assert.deepEqual(parseEcbXml(xml), { date: '2026-11-06', rates: { USD: 1.0812, GBP: 0.8421 } })
})

test('KDP-Report: Amazon.com-Zeilen bekommen USD, auch ohne Währungsspalte', () => {
  assert.equal(currencyForMarketplace('Amazon.com'), 'USD')
  assert.equal(currencyForMarketplace('Amazon.co.uk'), 'GBP')
  assert.equal(currencyForMarketplace('Amazon.com.au'), 'AUD')
  assert.equal(currencyForMarketplace('Amazon.de'), 'EUR')
  const { rows } = parseKdpWorkbook([{
    name: 'Paperback Royalty',
    rows: [['Royalty Date', 'Title', 'ASIN', 'Marketplace', 'Net Units Sold', 'Royalty'],
      ['2026-11-08', 'JuniorDoku', 'B0HQF5HHGX', 'Amazon.com', 2, 9.6],
      ['2026-11-08', 'JuniorDoku', 'B0HP8S61SH', 'Amazon.de', 3, 17.4]],
  }])
  assert.deepEqual(rows.map((r) => [r.marketplace, r.currency, r.royalty]), [['Amazon.com', 'USD', 9.6], ['Amazon.de', 'EUR', 17.4]])
})

test('US-Werbebericht: Währung aus Spalte oder aus „($)“ im Spaltennamen', () => {
  const withCol = parseAdsWorkbook([{ name: 'x', rows: [
    ['Date', 'Budget currency', 'Campaign name', 'Targeting', 'Match type', 'Impressions', 'Clicks', 'Total cost', 'Sales', 'Purchases'],
    ['Nov 08, 2026', 'USD', 'JuniorDoku US / B Exact', 'detective books for kids', 'EXACT', 100, 3, 1.5, 11.99, 1],
  ] }])
  assert.equal(withCol.rows[0].currency, 'USD')
  assert.equal(withCol.rows[0].spend, 1.5)
  const withSymbol = parseAdsWorkbook([{ name: 'x', rows: [
    ['Date', 'Campaign Name', 'Targeting', 'Match Type', 'Impressions', 'Clicks', 'Spend ($)', '14 Day Total Sales ($)', '14 Day Total Orders (#)'],
    ['Nov 08, 2026', 'JuniorDoku US / A Auto', 'close-match', '-', 50, 1, 0.4, 0, 0],
  ] }])
  assert.equal(withSymbol.rows[0].currency, 'USD')
  assert.equal(withSymbol.rows[0].matchType, 'AUTO')
})
