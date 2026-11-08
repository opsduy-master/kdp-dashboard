/** Amazon-Marktplätze, auf denen Bücher abgefragt werden können. Schlüssel steht in book.marketplace. */
export const MARKETPLACES = {
  de: {
    key: 'de', label: 'amazon.de', host: 'www.amazon.de', currency: 'EUR', locale: 'de', country: 'de',
    acceptLanguage: 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7', sessionKey: 'amazon-session',
  },
  com: {
    key: 'com', label: 'amazon.com', host: 'www.amazon.com', currency: 'USD', locale: 'en', country: 'us',
    acceptLanguage: 'en-US,en;q=0.9', sessionKey: 'amazon-session-com',
  },
}

export const DEFAULT_MARKETPLACE = 'de'

/** Marktplatz-Objekt zu einem Schlüssel (unbekannt/leer → amazon.de, damit bestehende Bücher unverändert bleiben). */
export const marketplace = (key) => MARKETPLACES[key] || MARKETPLACES[DEFAULT_MARKETPLACE]

/** Marktplatz anhand einer Amazon-URL. */
export function marketplaceForUrl(url) {
  let host = ''
  try { host = new URL(url).hostname } catch {}
  return Object.values(MARKETPLACES).find((m) => m.host === host) || marketplace()
}
