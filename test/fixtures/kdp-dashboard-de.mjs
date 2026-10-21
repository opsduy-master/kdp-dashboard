// Nachbau der Struktur von KDP_Dashboard-*.xlsx (deutscher KDP-Export, Oktober 2026).
// Kontrollsummen laut Blatt „Übersicht“: 7 eBooks, 5 Taschenbücher, 967 KENP, 25,44 € Tantiemen.
const T = { ali: 'Alltagsschlau', klo: 'Ideen, die man nur auf dem Klo erfindet', was: 'Was wäre, wenn...?', krimi: 'Krimi Sudoku', tor: 'Die Tor-Detektive' }
const royHead = ['Tantiemendatum', 'Titel', 'Name des Autors', 'ASIN', 'Marketplace', 'Tantiementyp', 'Transaktionsart', 'Verkaufte Einheiten', 'Rückerstattete Einheiten', 'Verkaufte Einheiten (netto)', 'Durchschn. Listenpreis ohne Steuer', 'Durchschn. Angebotspreis ohne Steuer', 'Durchschn. Dateigröße (MB)', 'Durchschn. Lieferkosten', 'Tantiemen', 'Währung']
const eb = (d, t, a, u, r) => [d, t, 'Duy Vu', a, 'Amazon.de', '35%', 'Standard', u, 0, u, 0.93, 0.93, 1.06, 'n. z.', r, 'EUR']
const pbHead = ['Tantiemendatum', 'Bestelldatum', 'Titel', 'Name des Autors', 'ISBN', 'Marketplace', 'Tantiementyp', 'Transaktionsart', 'Verkaufte Einheiten', 'Rückerstattete Einheiten', 'Verkaufte Einheiten (netto)', 'Durchschn. Listenpreis ohne Steuer', 'Durchschn. Angebotspreis ohne Steuer', 'Durchschn. Herstellungskosten', 'Tantiemen', 'Währung', 'ASIN']
const pb = (d, t, isbn, r, asin) => [d, '2026-10-10', t, 'Duy Vu', isbn, 'Amazon.de', '60%', 'Standard – Taschenbuch', 1, 0, 1, 12.99, 11.68, 2.86, r, 'EUR', asin]
const ordHead = ['Datum', 'Titel', 'Name des Autors', 'ASIN', 'Marketplace', 'Bezahlte Einheiten', 'Kostenlose Exemplare']
const kenpHead = ['Datum', 'Titel', 'Name des Autors', 'eBook-ASIN', 'Hörbuch-ASIN', 'Audible-ASIN', 'Marketplace', 'Gelesene Seiten', 'Angehörte Seiten', 'KENP insgesamt']
const kenpRows = [['2026-10-21', 'B0HNJZKLMX', 49], ['2026-10-20', 'B0HMV9C6BL', 170], ['2026-10-19', 'B0HNJZKLMX', 122], ['2026-10-19', 'B0HNLG7DLD', 220], ['2026-10-18', 'B0HMV9C6BL', 22], ['2026-10-17', 'B0HMV9C6BL', 40], ['2026-10-16', 'B0HMV9C6BL', 101], ['2026-10-15', 'B0HMV9C6BL', 237], ['2026-10-14', 'B0HMV9C6BL', 6]]
  .map(([d, a, k]) => [d, 'x', 'Duy Vu', a, 'n. z.', 'n. z.', 'Amazon.de', k, 0, k])
const ebookRows = [eb('2026-10-20', T.ali, 'B0HNJZKLMX', 1, 0.33), eb('2026-10-20', T.klo, 'B0HNLG7DLD', 2, 1.16), eb('2026-10-18', T.was, 'B0HMV9C6BL', 1, 0.33), eb('2026-10-15', T.was, 'B0HMV9C6BL', 1, 0.33), eb('2026-10-14', T.was, 'B0HMV9C6BL', 1, 0.33), eb('2026-10-13', T.was, 'B0HMV9C6BL', 1, 0.33)]
export const sheets = [
  { name: 'Berichtsdefinitionen', rows: [['Bericht', 'Definition'], ['KENP', 'Die von Kunden …']] },
  { name: 'Übersicht', rows: [['Datum', 'Netto verkaufte Einheiten (eBook)', 'Gelesene KENP-Seiten (Kindle Edition Normalized Pages Read)', 'Tantiemen (EUR)'], ['Oktober 2026', 7, 967, 25.44]] },
  { name: 'Zusammenfassung der Verkäufe', rows: [['Tantiemendatum', 'Titel', 'Name des Autors', 'ASIN/ISBN', 'Marketplace', 'Verkaufte Einheiten (netto)', 'Tantiemen', 'Währung'], ['2026-10-20', T.ali, 'Duy Vu', 'B0HNJZKLMX', 'Amazon.de', 1, 0.33, 'EUR']] },
  { name: 'eBook-Tantiemen', rows: [royHead, ...ebookRows] },
  { name: 'Taschenbuchtantiemen', rows: [pbHead, pb('2026-10-16', T.krimi, '9798160231266', 3.13, 'B0HM7F67KW'), pb('2026-10-13', T.krimi, '9798160231266', 4.93, 'B0HM7F67KW'), pb('2026-10-12', T.krimi, '9798160231266', 4.93, 'B0HM7F67KW'), pb('2026-10-11', T.tor, '9798160278155', 4.71, 'B0HM87ZY2C'), pb('2026-10-11', T.krimi, '9798160231266', 4.93, 'B0HM7F67KW')] },
  { name: 'Tantiemen für gebundene Ausgabe', rows: [pbHead] },
  { name: 'Verarbeitete Bestellungen', rows: [ordHead, ['2026-10-20', T.klo, 'Duy Vu', 'B0HNLG7DLD', 'Amazon.de', 2, 0]] },
  { name: 'Aufgegebene eBook-Bestellungen', rows: [ordHead, ['2026-10-20', T.klo, 'Duy Vu', 'B0HNLG7DLD', 'Amazon.de', 2, 0]] },
  { name: 'KENP', rows: [kenpHead, ...kenpRows] },
]
