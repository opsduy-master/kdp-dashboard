# KDP Dashboard

Ein privates Dashboard für deine Bücher auf **amazon.de**: Preis, Bewertung, Anzahl der Rezensionen,
BSR (Haupt- und Unterkategorien) und Verkäufe, Tantiemen und KENP auf einer Seite, ohne Amazon oder KDP öffnen zu müssen.

- **Amazon-Daten** (Preis, Bewertung, Rezensionen, BSR) werden automatisch abgerufen: stündlich läuft ein Job,
  der jedes Buch etwa alle 3 Stunden aktualisiert. Der Verlauf wird gespeichert (BSR-Chart, Rezensionen-Chart, Veränderungen 24 h / 7 Tage).
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
   | `SCRAPER_URL_TEMPLATE` | *optional*, siehe „Wenn Amazon blockiert“ |
3. Neu deployen (**Deploys → Trigger deploy**).
4. Seite öffnen, mit dem Passwort anmelden, **+ Buch** klicken und die ASIN eintragen (steht in der Amazon-URL nach `/dp/`).
   Bei „Weitere IDs“ kannst du eBook-ASIN und Taschenbuch-ISBN ergänzen, damit Verkäufe aller Ausgaben zum Buch gezählt werden.
5. In KDP unter **Berichte** den Tantiemen- oder Bestellbericht als XLSX herunterladen und über **⇪ KDP-Report** hochladen.
   IDs aus dem Report, die keinem Buch zugeordnet sind, zeigt das Dashboard unter der Tabelle an. Dort kannst du sie mit einem Klick zuordnen.

## Wenn Amazon blockiert

Die Daten werden von den öffentlichen Produktseiten gelesen. Amazon blockiert Anfragen aus Rechenzentren (also auch von Netlify) gelegentlich
mit einem Captcha. Das Dashboard zeigt dann „⚠ Von Amazon blockiert“ und versucht es beim nächsten stündlichen Lauf erneut.
Die zuletzt erfolgreich abgerufenen Werte bleiben stehen.

Passiert das dauerhaft, kannst du einen Scraping-Dienst zwischenschalten (z. B. ScraperAPI, ScrapingBee, Zyte; viele haben ein Gratis-Kontingent,
das für einige Bücher alle 3 Stunden reicht). Trage dazu die URL-Vorlage des Dienstes ein, `{url}` wird durch die Amazon-URL ersetzt:

```
SCRAPER_URL_TEMPLATE=https://api.scraperapi.com/?api_key=DEIN_KEY&country_code=de&url={url}
```

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
| `netlify/functions/scheduled-refresh.mjs` | stündlicher Job, der fällige Bücher abruft |
| `netlify/lib/scrape.mjs` | Abruf & Auswertung der amazon.de-Produktseite |
| `netlify/lib/store.mjs` | Speicherung in Netlify Blobs |

Wenn Amazon das Seitenlayout ändert und Werte fehlen, liegen die Selektoren gesammelt in `netlify/lib/scrape.mjs`.
