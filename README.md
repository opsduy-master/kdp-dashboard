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
| `netlify/functions/api.mjs` | API unter `/api/*` (Daten, Bücher, manueller Abruf, Verkaufsimport), passwortgeschützt |
| `netlify/functions/scheduled-refresh.mjs` | Job alle 15 Minuten, ruft fällige Bücher ab |
| `netlify/lib/fetch-amazon.mjs` | Abruf: Browser-Header, Cookie-Sitzung, Wiederholung, Scraping-Dienste |
| `netlify/lib/scrape.mjs` | Auswertung der amazon.de-Produktseite |
| `netlify/lib/store.mjs` | Speicherung in Netlify Blobs |

Wenn Amazon das Seitenlayout ändert und Werte fehlen, liegen die Selektoren gesammelt in `netlify/lib/scrape.mjs`.
