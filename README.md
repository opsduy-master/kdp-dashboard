# KDP Dashboard

Ein privates Dashboard für deine Bücher auf **amazon.de**: Preis, Bewertung, Anzahl der Rezensionen,
BSR (Haupt- und Unterkategorien) und Verkäufe, Tantiemen und KENP auf einer Seite, ohne Amazon oder KDP öffnen zu müssen.

- **Amazon-Daten** (Preis, Bewertung, Rezensionen, BSR) werden automatisch abgerufen: Alle 15 Minuten läuft ein Job,
  der die fälligen Bücher aktualisiert (jedes Buch standardmäßig etwa alle 3 Stunden). Der Verlauf wird gespeichert (BSR-Chart, Rezensionen-Chart, Veränderungen 24 h / 7 Tage).
- **Verkäufe** kommen aus deinen KDP-Berichten (XLSX), die du per Drag & Drop hochlädst. KDP hat keine offizielle API.
  Mehrfaches Hochladen desselben Zeitraums überschreibt die Werte und zählt nichts doppelt.
- Läuft vollständig auf **Netlify** (Static Site + Functions + Scheduled Function + Netlify Blobs als Speicher). Keine Datenbank, kein Server.

## Einrichtung auf Netlify

1. Dieses Repo bei Netlify verbinden: **Add new site → Import an existing project → GitHub → kdp-dashboard**.
   Die Build-Einstellungen kommen aus der `netlify.toml`, du musst nichts eintragen.
2. Unter **Site configuration → Environment variables** anlegen:
   | Variable | Wert |
   |---|---|
   | `DASHBOARD_PASSWORD` | ein langes Passwort für das Dashboard (**Pflicht**) |
   | `SCRAPERAPI_KEY` o. Ä. | *optional*, siehe „Wenn Amazon blockiert“ |
3. Neu deployen (**Deploys → Trigger deploy**).
4. Seite öffnen, mit dem Passwort anmelden, **+ Buch** klicken und die ASIN eintragen (steht in der Amazon-URL nach `/dp/`).
   Bei „Weitere IDs“ kannst du eBook-ASIN und Taschenbuch-ISBN ergänzen, damit Verkäufe aller Ausgaben zum Buch gezählt werden.
5. In KDP unter **Berichte** den Tantiemen- oder Bestellbericht als XLSX herunterladen und über **⇪ KDP-Report** hochladen.
   IDs aus dem Report, die keinem Buch zugeordnet sind, zeigt das Dashboard unter der Tabelle an. Dort kannst du sie mit einem Klick zuordnen.

## KDP-Berichte automatisch aus Google Drive

Statt den Bericht jedes Mal hochzuladen, kann das Dashboard die **neueste `KDP_Dashboard-*.xlsx`** aus einem Google-Drive-Ordner
selbst holen: bei jedem Klick auf **„Jetzt aktualisieren“** und stündlich im Hintergrund. Heruntergeladen wird nur, wenn sich die Datei
geändert hat. Da sich Zeiträume überschneiden dürfen, werden bereits importierte Tage einfach aktualisiert.

Der Zugriff läuft über ein kleines Google Apps Script unter deinem Konto, ohne Google-Cloud-Projekt:

1. [script.google.com](https://script.google.com) → **Neues Projekt**, Namen vergeben (z. B. „KDP Dashboard Export“).
2. Den Inhalt von [`google-apps-script/KDP_Dashboard_Export.gs`](google-apps-script/KDP_Dashboard_Export.gs) einfügen.
   `FOLDER_ID` ist bereits dein Ordner. `TOKEN` durch ein langes, zufälliges Geheimnis ersetzen und speichern.
3. **Bereitstellen → Neue Bereitstellung** → Zahnrad → **Web-App**, *Ausführen als*: **Ich**, *Zugriff*: **Jeder** → Bereitstellen.
   Beim ersten Mal den Zugriff auf Google Drive erlauben. (Zugriff „Jeder“ ist nötig, damit Netlify die Web-App ohne Google-Login
   aufrufen kann; ohne den richtigen Token liefert sie nichts aus.)
4. Die angezeigte **Web-App-URL** (endet auf `/exec`) und den Token in Netlify eintragen und neu deployen:

   | Variable | Wert |
   |---|---|
   | `DRIVE_SCRIPT_URL` | `https://script.google.com/macros/s/…/exec` |
   | `DRIVE_SCRIPT_TOKEN` | derselbe Token wie im Script |

5. Im Dashboard unter **⚙ → KDP-Berichte aus Google Drive → Neueste Datei jetzt importieren** testen.

**Wichtig:** Eine Web-App läuft immer mit der Code-Version, die beim Bereitstellen gespeichert wurde. Änderst du danach etwas am
Script (z. B. den `TOKEN`), musst du unter **Bereitstellen → Bereitstellungen verwalten → ✎ Bearbeiten → Version: „Neue Version“ →
Bereitstellen** eine neue Version veröffentlichen. Die URL bleibt dabei gleich.

Meldet das Dashboard „Token stimmt nicht überein“, zeigt es die Länge und das erste Zeichen beider Tokens. So erkennst du, auf welcher
Seite der falsche Wert steht, ohne dass der Token selbst angezeigt wird.

## Werbung (Amazon Ads / Sponsored Products)

Sponsored-Products-Berichte (z. B. **Targeting-Bericht** oder **Keyword-Bericht** als XLSX) werden genauso eingelesen: automatisch die
neueste `Sponsored_Products*.xlsx` aus dem Google-Drive-Ordner (dafür Apps Script **Version 3** bereitstellen) oder per **⇪ KDP-Report**.

- Der Bereich **„Werbung“** zeigt Kampagnen und Top-Keywords mit Impressionen, Klicks, CTR, CPC, Ausgaben, 14-Tage-Umsatz und ACOS
  (Ausgaben ÷ Werbeumsatz) sowie die Werbekosten pro Tag.
- Die Berichte enthalten keine ASIN. Deshalb wird jede **Kampagne einem Buch zugeordnet**: Das Dashboard schlägt anhand des
  Kampagnennamens ein Buch vor, mit **✓ Übernehmen** wird die Zuordnung gespeichert. Erst dann erscheinen Werbekosten und ACOS in der
  Bücher-Tabelle.
- Die Kennzahl **„Ergebnis nach Werbung“** ist Tantiemen (EUR) minus Werbekosten im gewählten Zeitraum.

## Wenn Amazon blockiert (HTTP 503 / Captcha)

Die Daten werden von den öffentlichen Produktseiten gelesen. Amazon weist Anfragen aus Rechenzentren (also auch von Netlify/AWS)
häufig mit **HTTP 503** oder einem Captcha ab. Das Dashboard tut, was ohne Fremddienst möglich ist: Es sendet die Header eines echten
Chrome-Browsers, baut über die Startseite eine Cookie-Sitzung auf und versucht es bei Ablehnung einmal mit frischer Sitzung.
Fehlgeschlagene Bücher werden mit wachsendem Abstand erneut versucht (30 min, 1 h, 2 h …), die zuletzt erfolgreichen Werte bleiben stehen.

Ob es klappt, siehst du unter **⚙ → Abruf testen**: Dort wird jeder Schritt mit HTTP-Status angezeigt.

Wenn weiterhin 503 kommt, ist ein **Scraping-Dienst** die zuverlässige Lösung (Anfragen laufen über Privat-IPs in Deutschland).
Es reicht, **eine** dieser Variablen in Netlify zu setzen (Site configuration → Environment variables) und neu zu deployen:

| Variable | Dienst |
|---|---|
| `SCRAPERAPI_KEY` | [ScraperAPI](https://www.scraperapi.com) |
| `SCRAPINGBEE_KEY` | [ScrapingBee](https://www.scrapingbee.com) (nutzt Premium-Proxys) |
| `SCRAPEDO_TOKEN` | [Scrape.do](https://scrape.do) |
| `SCRAPER_URL_TEMPLATE` | beliebiger anderer Dienst, `{url}` wird durch die Amazon-URL ersetzt |

Weitere optionale Variablen:

| Variable | Wirkung |
|---|---|
| `SCRAPER_MODE` | `proxy` (Standard, sobald ein Dienst gesetzt ist): immer über den Dienst. `fallback`: erst direkt, nur bei Ablehnung über den Dienst (spart Credits). `direct`: Dienst ignorieren. |
| `REFRESH_INTERVAL_HOURS` | wie oft jedes Buch abgefragt wird (Standard `3`). Mit einem Gratis-Kontingent lieber `6`–`12` wählen. |

**Credits abschätzen:** Bücher × (24 / Intervall) × 30 Tage, also z. B. 5 Bücher alle 6 Stunden ≈ 600 Abrufe pro Monat.
Manche Dienste berechnen für Amazon mehrere Credits pro Abruf, das steht in deren Preisliste.

Hinweis: Automatisiertes Auslesen von Amazon-Seiten ist laut Amazons Nutzungsbedingungen nicht vorgesehen. Das Dashboard fragt nur
deine eigenen Bücher in sehr geringer Frequenz ab, die Nutzung erfolgt aber auf eigenes Risiko.

## Lokal entwickeln

```bash
npm install
npm test                       # Parser-Tests (Amazon-Seite & KDP-Report)
echo "DASHBOARD_PASSWORD=test" > .env
npx netlify-cli dev            # http://localhost:8888
```

## Aufbau

| Pfad | Zweck |
|---|---|
| `public/` | Dashboard (HTML/CSS/JS, Chart.js, SheetJS zum Lesen der XLSX im Browser) |
| `public/kdp-parser.js` | erkennt KDP-Berichte (englische & deutsche Spalten, eBook/Taschenbuch/Hardcover/KENP) |
| `netlify/lib/drive-import.mjs` | holt die neueste `KDP_Dashboard-*.xlsx` über das Apps Script und importiert sie |
| `google-apps-script/KDP_Dashboard_Export.gs` | Apps Script (Web-App), das die Datei aus Google Drive ausliefert |
| `netlify/functions/api.mjs` | API unter `/api/*` (Daten, Bücher, manueller Abruf, Verkaufsimport), passwortgeschützt |
| `netlify/functions/scheduled-refresh.mjs` | Job alle 15 Minuten, ruft fällige Bücher ab |
| `netlify/lib/fetch-amazon.mjs` | Abruf: Browser-Header, Cookie-Sitzung, Wiederholung, Scraping-Dienste |
| `netlify/lib/scrape.mjs` | Auswertung der amazon.de-Produktseite |
| `netlify/lib/store.mjs` | Speicherung in Netlify Blobs |

Wenn Amazon das Seitenlayout ändert und Werte fehlen, liegen die Selektoren gesammelt in `netlify/lib/scrape.mjs`.
