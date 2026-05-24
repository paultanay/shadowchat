/**
 * HKDF-SHA-256 key derivation helpers using Web Crypto API.
 */

// Derive an AES-256-GCM room session key from a shared secret using HKDF
export async function deriveRoomKey(
  sharedSecret: ArrayBuffer,
  salt: Uint8Array,
  info: Uint8Array
): Promise<CryptoKey> {
  // Import the raw shared secret as a CryptoKey for HKDF import
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    sharedSecret,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  // Derive the room key (AES-GCM 256 bits)
  return await window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as Uint8Array<ArrayBuffer>,
      info: info as Uint8Array<ArrayBuffer>,
    },
    baseKey,
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // Extractable
    ['encrypt', 'decrypt']
  );
}

// Derive arbitrary length bits using HKDF-SHA-256
export async function deriveBitsHKDF(
  ikm: ArrayBuffer,
  salt: Uint8Array,
  info: Uint8Array,
  bitLength: number
): Promise<ArrayBuffer> {
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    ikm,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );

  return await window.crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as Uint8Array<ArrayBuffer>,
      info: info as Uint8Array<ArrayBuffer>,
    },
    baseKey,
    bitLength
  );
}
