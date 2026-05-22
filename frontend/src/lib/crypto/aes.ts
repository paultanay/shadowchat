/**
 * AES-256-GCM symmetric encryption helpers using Web Crypto API.
 */

export interface EncryptedPayload {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
}

// Encrypt data with AES-256-GCM
export async function encryptAESGCM(
  key: CryptoKey,
  plaintext: ArrayBuffer,
  iv?: Uint8Array,
  additionalData?: ArrayBuffer
): Promise<EncryptedPayload> {
  const nonce = iv || window.crypto.getRandomValues(new Uint8Array(12));
  
  const algorithm: AesGcmParams = {
    name: 'AES-GCM',
    iv: nonce as any,
    tagLength: 128, // 16-byte authentication tag
  };

  if (additionalData) {
    algorithm.additionalData = additionalData;
  }

  const ciphertext = await window.crypto.subtle.encrypt(algorithm, key, plaintext);

  return {
    ciphertext,
    iv: nonce,
  };
}

// Decrypt data with AES-256-GCM
export async function decryptAESGCM(
  key: CryptoKey,
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
  additionalData?: ArrayBuffer
): Promise<ArrayBuffer> {
  const algorithm: AesGcmParams = {
    name: 'AES-GCM',
    iv: iv as any,
    tagLength: 128,
  };

  if (additionalData) {
    algorithm.additionalData = additionalData;
  }

  return await window.crypto.subtle.decrypt(algorithm, key, ciphertext);
}
