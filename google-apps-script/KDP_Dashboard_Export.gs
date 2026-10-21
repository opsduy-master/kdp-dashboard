/**
 * Liefert dem KDP-Dashboard die neueste KDP_Dashboard-*.xlsx bzw. Sponsored_Products*.xlsx aus dem Google-Drive-Ordner.
 *
 * Einrichtung (einmalig, siehe README):
 *  1. https://script.google.com → Neues Projekt → diesen Code einfügen.
 *  2. TOKEN unten durch ein langes, zufälliges Geheimnis ersetzen.
 *  3. Bereitstellen → Neue Bereitstellung → Typ „Web-App“, Ausführen als „Ich“, Zugriff „Jeder“.
 *  4. Web-App-URL und TOKEN in Netlify als DRIVE_SCRIPT_URL und DRIVE_SCRIPT_TOKEN eintragen.
 */
const FOLDER_ID = '1QqhLbM0RAVXXT2pcFqCNRViYkGVZEeRA'
// Erlaubte Dateiarten (Parameter „prefix“), die erste ist der Standard
const PREFIXES = ['KDP_Dashboard', 'Sponsored_Products']
const TOKEN = 'HIER-EIN-LANGES-GEHEIMNIS-EINTRAGEN'
const SCRIPT_VERSION = 3

function doGet(e) {
  const params = (e && e.parameter) || {}
  const expected = String(TOKEN || '').trim()
  const given = String(params.token || '').trim()
  if (!expected || expected.indexOf('HIER-') === 0) {
    return json({ error: 'TOKEN im Apps Script ist noch der Platzhalter. Token eintragen, speichern und unter „Bereitstellen → Bereitstellungen verwalten“ eine NEUE VERSION bereitstellen.', scriptVersion: SCRIPT_VERSION })
  }
  if (!given) {
    return json({ error: 'Netlify schickt keinen Token: DRIVE_SCRIPT_TOKEN in Netlify setzen und neu deployen.', scriptVersion: SCRIPT_VERSION })
  }
  if (given !== expected) {
    // Nur Längen und erstes Zeichen verraten, nie den Token selbst
    return json({
      error: `Token stimmt nicht überein (Netlify: ${given.length} Zeichen, beginnt mit „${given[0]}“ · Script: ${expected.length} Zeichen, beginnt mit „${expected[0]}“). ` +
        'Nach Änderungen im Script eine NEUE VERSION bereitstellen; nach Änderungen in Netlify neu deployen.',
      scriptVersion: SCRIPT_VERSION,
    })
  }

  const prefix = PREFIXES.indexOf(params.prefix) >= 0 ? params.prefix : PREFIXES[0]
  const files = DriveApp.getFolderById(FOLDER_ID).getFiles()
  let latest = null
  while (files.hasNext()) {
    const f = files.next()
    const name = f.getName()
    if (name.indexOf(prefix) !== 0 || !/\.xlsx$/i.test(name) || f.isTrashed()) continue
    if (!latest || f.getLastUpdated() > latest.getLastUpdated()) latest = f
  }
  if (!latest) return json({ notFound: true, prefix, scriptVersion: SCRIPT_VERSION, error: `Keine ${prefix}*.xlsx im Ordner gefunden` })

  const meta = { id: latest.getId(), name: latest.getName(), modifiedTime: latest.getLastUpdated().toISOString(), prefix, scriptVersion: SCRIPT_VERSION }
  // Unverändert seit dem letzten Import → nur Metadaten zurückgeben
  if (params.since && params.since === meta.modifiedTime && params.id === meta.id) {
    return json(Object.assign({ unchanged: true }, meta))
  }
  return json(Object.assign({ data: Utilities.base64Encode(latest.getBlob().getBytes()) }, meta))
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}
