import { getStore } from '@netlify/blobs'

const HISTORY_LIMIT = 3000

export const store = () => getStore({ name: 'kdp-dashboard', consistency: 'strong' })

export async function getJSON(key, fallback) {
  const v = await store().get(key, { type: 'json' })
  return v ?? fallback
}

export const setJSON = async (key, value) => store().setJSON(key, value)

export const getBooks = () => getJSON('books', [])
export const saveBooks = (books) => setJSON('books', books)

export const getHistory = (asin) => getJSON(`history/${asin}`, [])
export async function appendHistory(asin, snapshot) {
  const history = await getHistory(asin)
  history.push(snapshot)
  await setJSON(`history/${asin}`, history.slice(-HISTORY_LIMIT))
}

export const getStatus = () => getJSON('status', {})
export const saveStatus = (status) => setJSON('status', status)

export const getSales = () => getJSON('sales', [])
export const saveSales = (rows) => setJSON('sales', rows)
