/**
 * Web Crypto API client-side key pair helpers for X25519 (ECDH) and Ed25519 (Signatures).
 */

export interface ExportedKeyPair {
  publicKeyJwk: JsonWebKey;
  privateKeyJwk?: JsonWebKey;
}

// Generate X25519 key pair for ECDH Room Key Exchange
export async function generateX25519KeyPair(): Promise<CryptoKeyPair> {
  return (await window.crypto.subtle.generateKey(
    {
      name: 'X25519',
    },
    true, // extractable
    ['deriveKey', 'deriveBits']
  )) as CryptoKeyPair;
}

// Generate Ed25519 key pair for peer identity signing (MITM protection)
export async function generateEd25519KeyPair(): Promise<CryptoKeyPair> {
  return (await window.crypto.subtle.generateKey(
    {
      name: 'Ed25519',
    },
    true, // extractable
    ['sign', 'verify']
  )) as CryptoKeyPair;
}

// Export a public or private key to JSON Web Key (JWK) format
export async function exportKeyToJwk(key: CryptoKey): Promise<JsonWebKey> {
  return await window.crypto.subtle.exportKey('jwk', key);
}

// Import an X25519 Public Key from JWK
export async function importX25519PublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'X25519',
    },
    true,
    [] // Public keys for deriveKey have empty usages on import
  );
}

// Import an X25519 Private Key from JWK
export async function importX25519PrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'X25519',
    },
    true,
    ['deriveKey', 'deriveBits']
  );
}

// Import an Ed25519 Public Key from JWK
export async function importEd25519PublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'Ed25519',
    },
    true,
    ['verify']
  );
}

// Import an Ed25519 Private Key from JWK
export async function importEd25519PrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    'jwk',
    jwk,
    {
      name: 'Ed25519',
    },
    true,
    ['sign']
  );
}

// Sign data using Ed25519 Private Key
export async function signData(privateKey: CryptoKey, data: ArrayBuffer): Promise<ArrayBuffer> {
  return await window.crypto.subtle.sign(
    {
      name: 'Ed25519',
    },
    privateKey,
    data
  );
}

// Verify signature using Ed25519 Public Key
export async function verifySignature(
  publicKey: CryptoKey,
  signature: ArrayBuffer,
  data: ArrayBuffer
): Promise<boolean> {
  return await window.crypto.subtle.verify(
    {
      name: 'Ed25519',
    },
    publicKey,
    signature,
    data
  );
}
