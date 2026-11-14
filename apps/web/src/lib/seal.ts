/**
 * Seal a secret in the browser, so the plaintext never reaches the server.
 *
 * The key is an AES-256-GCM key made in this browser and kept in IndexedDB as
 * a key that cannot be exported: script on the page can use it but never read
 * it. It is this browser's counterpart of the key `sx` keeps beside its
 * settings; values are re-encrypted to each recipient's key once recipients
 * publish theirs.
 */
const DB = 'source-code'
const STORE = 'keys'
const NAME = 'seal'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'))
  })
}

async function stored(): Promise<CryptoKey | undefined> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(NAME)
    req.onsuccess = () => resolve(req.result as CryptoKey | undefined)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'))
  })
}

async function keep(key: CryptoKey) {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(key, NAME)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'))
  })
}

async function sealKey(): Promise<CryptoKey> {
  const have = await stored()
  if (have) return have
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  await keep(key)
  return key
}

/** `sxw1.` and the IV and ciphertext, base64. */
export async function seal(value: string): Promise<string> {
  const key = await sealKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(value),
    ),
  )
  const all = new Uint8Array(iv.length + body.length)
  all.set(iv)
  all.set(body, iv.length)
  let bin = ''
  for (const b of all) bin += String.fromCharCode(b)
  return `sxw1.${btoa(bin)}`
}
