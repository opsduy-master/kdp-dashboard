/**
 * Liefert dem KDP-Dashboard die neueste KDP_Dashboard-*.xlsx aus dem Google-Drive-Ordner.
 *
 * Einrichtung (einmalig, siehe README):
 *  1. https://script.google.com → Neues Projekt → diesen Code einfügen.
 *  2. TOKEN unten durch ein langes, zufälliges Geheimnis ersetzen.
 *  3. Bereitstellen → Neue Bereitstellung → Typ „Web-App“, Ausführen als „Ich“, Zugriff „Jeder“.
 *  4. Web-App-URL und TOKEN in Netlify als DRIVE_SCRIPT_URL und DRIVE_SCRIPT_TOKEN eintragen.
 */
const FOLDER_ID = '1QqhLbM0RAVXXT2pcFqCNRViYkGVZEeRA'
const FILE_PREFIX = 'KDP_Dashboard'
const TOKEN = 'HIER-EIN-LANGES-GEHEIMNIS-EINTRAGEN'

function doGet(e) {
  const params = (e && e.parameter) || {}
  if (!TOKEN || TOKEN.indexOf('HIER-') === 0 || params.token !== TOKEN) {
    return json({ error: 'Nicht autorisiert (Token prüfen)' })
  }

  const files = DriveApp.getFolderById(FOLDER_ID).getFiles()
  let latest = null
  while (files.hasNext()) {
    const f = files.next()
    const name = f.getName()
    if (name.indexOf(FILE_PREFIX) !== 0 || !/\.xlsx$/i.test(name) || f.isTrashed()) continue
    if (!latest || f.getLastUpdated() > latest.getLastUpdated()) latest = f
  }
  if (!latest) return json({ error: `Keine ${FILE_PREFIX}-*.xlsx im Ordner gefunden` })

  const meta = { id: latest.getId(), name: latest.getName(), modifiedTime: latest.getLastUpdated().toISOString() }
  // Unverändert seit dem letzten Import → nur Metadaten zurückgeben
  if (params.since && params.since === meta.modifiedTime && params.id === meta.id) {
    return json(Object.assign({ unchanged: true }, meta))
  }
  return json(Object.assign({ data: Utilities.base64Encode(latest.getBlob().getBytes()) }, meta))
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON)
}
