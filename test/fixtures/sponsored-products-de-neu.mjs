// Nachbau von Sponsored_Products_Targeting_Bericht.xlsx aus der neuen Amazon-Ads-Konsole (Okt. 2026):
// andere Spaltennamen („Gesamtkosten“, „Verkäufe“, „Käufe“) und deutsches Datum.
export const header = ['Datum', 'Portfolioname', 'Währung des Budgets', 'Kampagnenname', 'Land der Kampagne', 'Targeting', 'Übereinstimmungstyp für Targeting', 'Impressions', 'Klicks', 'CTR', 'CPC', 'Gesamtkosten', 'ROAS durch Klicks', 'Verkäufe', 'KENP-Lesestatistik', 'Geschätzte KENP Tantiemen', 'Käufe', 'Durch Klicks verkaufte Einheiten', '„Käufe durch Klicks“-Rate', '„Auf meinen Wunschzettel“ aus Klicks', 'Portfolio-ID', 'Kampagnen-ID']
const row = (d, c, t, m, imp, clicks, cost, sales, kenp, orders, units) =>
  [d, 'No Portfolio', 'EUR', c, 'DE', t, m, imp, clicks, '0.0000%', '', cost, '', sales, kenp, '0.00', orders, units, '0.0000%', '', -1, 213498017551459]
export const sheets = [{
  name: 'Sponsored_Products_Targeting_Be',
  rows: [header,
    row('20.10.2026', 'Krimi Sodoku / Kampagne A', 'krimi sudoku', 'EXACT', 1, 0, '0.00', '0.00', 0, 0, 0),
    row('21.10.2026', 'Was wäre wenn / Kampagne AB', 'was wäre wenn buch', 'EXACT', 1, 0, '0.00', '0.00', 0, 0, 0),
    row('21.10.2026', 'Krimi Sodoku / Kampagne A', 'krimi soduku', 'EXACT', 0, 0, '0.00', '0.00', 0, 0, 0),
    row('21.10.2026', 'Krimi Sodoku / Kampagne A', 'krimi sudoku auf deutsch', 'EXACT', 1, 0, '0.00', '0.00', 0, 0, 0),
    row('21.10.2026', 'Was wäre wenn / Kampagne D', 'close-match', 'TARGETING_EXPRESSION_PREDEFINED', 4, 0, '0.00', '0.00', 0, 0, 0),
    row('20.10.2026', 'Krimi Sodoku / Kampagne A', 'krimi soduku', 'EXACT', 0, 0, '0.00', '0.00', 0, 0, 0),
    row('21.10.2026', 'Krimi Sodoku / Kampagne A', 'krimi sudoku', 'EXACT', 3, 2, '1.10', '12.99', 35, 1, 1),
  ],
}]
