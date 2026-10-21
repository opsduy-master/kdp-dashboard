// Nachbau von Sponsored_Products_Targeting_Bericht.xlsx (Amazon Ads, deutsch, Datum im US-Format)
export const header = ['Datum', 'Portfolioname', 'Währung', 'Kampagnen-Name', 'Land', 'Ausrichtung', 'Übereinstimmungstyp', 'Impressionen', 'Impression Share oberste Suchergebnisse', 'Klicks', 'Klickrate (CTR)', 'Kosten pro Klick (CPC)', 'Ausgaben', 'Zugeschriebene Umsatzkosten (ACOS) gesamt ', 'Gesamte Rentabilität der Anzeigenkosten (ROAS)', '14 Tage, Umsatz gesamt (€)', 'KENP Read-Gesamtwert (Anzahl gelesener Seiten) für 14 Tage', 'Geschätzte KENP Tantiemen', 'Gesamtaufträge in 14 Tagen (Anzahl)', 'Gesamte Einheiten in 14 Tagen (Anzahl)', '14-Tage-Konversionsrate', 'Zur Liste hinzufügen']
const row = (d, c, t, m, imp, clicks, cpc, spend, sales, kenp, kenpR, orders, units) =>
  [d, 'No Portfolio', 'EUR', c, 'Deutschland', t, m, imp, '', clicks, '0.0000%', cpc, spend, '', '', sales, kenp, kenpR, orders, units, '', 0]
export const sheets = [{
  name: 'Sponsored_Products_Targeting_Be',
  rows: [header,
    row('Oct 21, 2026', 'Was wäre wenn / Kampagne D', 'close-match', '-', 4, 0, '€0.00', '€0.00', '€0.00', 0, '€0.00', 0, 0),
    row('Oct 20, 2026', 'Krimi Sodoku / Kampagne A', 'krimi sudoku', 'EXACT', 120, 3, '€0.41', '€1.23', '€12.99', 0, '€0.00', 1, 1),
    row('Oct 21, 2026', 'Krimi Sodoku / Kampagne A', 'krimi sudoku', 'EXACT', 3, 0, '€0.00', '€0.00', '€0.00', 0, '€0.00', 0, 0),
    row('Oct 21, 2026', 'Krimi Sodoku / Kampagne A', 'krimi sudoku auf deutsch', 'EXACT', 1, 1, '€0.35', '€0.35', '€0.00', 0, '€0.00', 0, 0),
    row('Oct 21, 2026', 'Was wäre wenn / Kampagne AB', 'was wäre wenn buch', 'EXACT', 50, 2, '€0.30', '€0.60', '€0.00', 120, '€0.52', 0, 0),
  ],
}]
