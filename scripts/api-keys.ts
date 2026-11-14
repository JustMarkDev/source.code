/**
 * Makes the key pair the HTTP API signs its Convex JWTs with, and prints
 * where each half goes. Run it once per deployment:
 *
 *   bun scripts/api-keys.ts https://source.code
 *
 * The private key goes to the API servers (API_JWT_PRIVATE_KEY), the public
 * one to Convex (API_JWT_JWKS). The issuer is any stable URL you own.
 */
import { exportJWK, generateKeyPair } from 'jose'

const issuer = process.argv[2] ?? 'https://source.code'
const { publicKey, privateKey } = await generateKeyPair('ES256', {
  extractable: true,
})
const kid = `api-${new Date().toISOString().slice(0, 10)}`
const pub = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }
const priv = { ...(await exportJWK(privateKey)), kid, alg: 'ES256' }
const jwks = `data:text/plain;charset=utf-8;base64,${btoa(JSON.stringify({ keys: [pub] }))}`

console.log('# Convex (the forge trusts the API):')
console.log(`npx convex env set API_JWT_ISSUER '${issuer}'`)
console.log(`npx convex env set API_JWT_JWKS '${jwks}'`)
console.log('\n# The API servers (keep this one secret):')
console.log(`API_JWT_ISSUER='${issuer}'`)
console.log(`API_JWT_PRIVATE_KEY='${JSON.stringify(priv)}'`)
