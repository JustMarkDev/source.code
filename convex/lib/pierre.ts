/**
 * code.storage's webhook signature: `X-Pierre-Signature: t=<seconds>,sha256=<hex>`,
 * an HMAC-SHA256 of `<t>.<body>` with the webhook's secret. Good for five
 * minutes, and never from more than a minute in the future.
 */
export async function verifyPierre(
  body: string,
  header: string | null,
  secret: string | undefined,
  nowMs: number,
) {
  if (!secret) return 'This deployment has no webhook secret.'
  if (!header) return 'No signature.'
  let t = ''
  let sig = ''
  for (const part of header.split(',')) {
    const [k, v] = part.trim().split('=', 2)
    if (k === 't') t = v
    if (k === 'sha256') sig = v
  }
  const ts = Number.parseInt(t, 10)
  if (!t || !sig || Number.isNaN(ts))
    return 'The signature header is not valid.'
  const age = Math.floor(nowMs / 1000) - ts
  if (age > 300) return 'The webhook is too old.'
  if (age < -60) return 'The webhook is from the future.'
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(`${t}.${body}`),
    ),
  )
  const want = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('')
  // Compared in full, so the answer does not leak how much matched.
  let diff = want.length ^ sig.length
  for (let i = 0; i < Math.max(want.length, sig.length); i++)
    diff |= (want.charCodeAt(i) || 0) ^ (sig.charCodeAt(i) || 0)
  return diff === 0 ? null : 'The signature does not match.'
}
