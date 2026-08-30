import {
  exportKeyToJwk,
  importX25519PublicKey,
  importEd25519PublicKey,
  signData,
  verifySignature,
} from '../crypto/keys';
import { encryptAESGCM, decryptAESGCM } from '../crypto/aes';
import { deriveRoomKey } from '../crypto/hkdf';

// Helper: Convert string to ArrayBuffer
export function stringToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer.slice(0);
}

// Helper: Convert ArrayBuffer to string
export function bufferToString(buf: ArrayBuffer): string {
  return new TextDecoder().decode(buf);
}

// Helper: Base64 decode to Uint8Array
export function base64ToBytes(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Helper: Uint8Array/ArrayBuffer to Base64
export function bytesToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const chars = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    chars[i] = String.fromCharCode(bytes[i]);
  }
  return window.btoa(chars.join(''));
}

export interface EncryptedData {
  ciphertext: string; // Base64
  iv: string; // Base64
}

// Encrypt a UTF-8 string with an AES-GCM Key
export async function encryptText(key: CryptoKey, text: string): Promise<EncryptedData> {
  const plaintext = stringToBuffer(text);
  const { ciphertext, iv } = await encryptAESGCM(key, plaintext);
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
  };
}

// Decrypt a UTF-8 string with an AES-GCM Key
export async function decryptText(key: CryptoKey, ciphertextBase64: string, ivBase64: string): Promise<string> {
  const ciphertext = base64ToBytes(ciphertextBase64);
  const iv = base64ToBytes(ivBase64);
  const decrypted = await decryptAESGCM(key, ciphertext.buffer as ArrayBuffer, iv);
  return bufferToString(decrypted);
}

// Generate the key exchange packet containing signed X25519 identity keys
export interface KeyExchangePacket {
  x25519Jwk: JsonWebKey;
  ed25519Jwk: JsonWebKey;
  signature: string; // Base64 signature of x25519Jwk
}

export async function prepareKeyExchange(
  x25519KeyPair: CryptoKeyPair,
  ed25519KeyPair: CryptoKeyPair
): Promise<KeyExchangePacket> {
  const x25519Jwk = await exportKeyToJwk(x25519KeyPair.publicKey);
  const ed25519Jwk = await exportKeyToJwk(ed25519KeyPair.publicKey);

  // Sign the X25519 JWK string to prevent identity spoofing
  const serializedX25519 = JSON.stringify(x25519Jwk);
  const sigBuffer = await signData(ed25519KeyPair.privateKey, stringToBuffer(serializedX25519));

  return {
    x25519Jwk,
    ed25519Jwk,
    signature: bytesToBase64(sigBuffer),
  };
}

// Verify a remote peer's keys and perform X25519 Diffie-Hellman to derive room key
export async function completeKeyExchange(
  localX25519Private: CryptoKey,
  packet: KeyExchangePacket,
  roomId: string
): Promise<CryptoKey> {
  console.log('[completeKeyExchange] STEP 1: importing remote X25519 public key...');
  const remoteX25519Public = await importX25519PublicKey(packet.x25519Jwk);

  console.log('[completeKeyExchange] STEP 2: importing remote Ed25519 public key...');
  const remoteEd25519Public = await importEd25519PublicKey(packet.ed25519Jwk);

  const serializedX25519 = JSON.stringify(packet.x25519Jwk);
  const signatureBytes = base64ToBytes(packet.signature);

  console.log('[completeKeyExchange] STEP 3: verifying Ed25519 identity signature...');
  // 1. Verify signatures to prevent MITM
  const isSignatureValid = await verifySignature(
    remoteEd25519Public,
    signatureBytes.buffer as ArrayBuffer,
    stringToBuffer(serializedX25519)
  );

  console.log('[completeKeyExchange] signature valid:', isSignatureValid);
  if (!isSignatureValid) {
    throw new Error('Key exchange failed: identity signature verification failed');
  }

  console.log('[completeKeyExchange] STEP 4: X25519 DH deriveBits...');
  // 2. Perform ECDH key exchange — pass 256 for length.
  const rawSharedSecret = await window.crypto.subtle.deriveBits(
    {
      name: 'X25519',
      public: remoteX25519Public,
    },
    localX25519Private,
    256
  );

  console.log('[completeKeyExchange] STEP 5: HKDF key derivation, roomId:', roomId);
  // 3. Derive symmetric Room Key using HKDF
  const salt = new TextEncoder().encode(roomId);
  const info = new TextEncoder().encode('shadowchat-v1-room-key');

  const roomKey = await deriveRoomKey(rawSharedSecret, salt, info);
  console.log('[completeKeyExchange] DONE: room key derived successfully');
  return roomKey;
}

// Generate an ephemeral random key for encrypting a specific file (Envelope Encryption)
export async function generateFileKey(): Promise<CryptoKey> {
  return await window.crypto.subtle.generateKey(
    {
      name: 'AES-GCM',
      length: 256,
    },
    true, // extractable
    ['encrypt', 'decrypt']
  );
}

// Wrap (encrypt) the file key with the room key
export async function wrapFileKey(roomKey: CryptoKey, fileKey: CryptoKey): Promise<EncryptedData> {
  const rawFileKey = await window.crypto.subtle.exportKey('raw', fileKey);
  const { ciphertext, iv } = await encryptAESGCM(roomKey, rawFileKey);
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
  };
}

// Unwrap (decrypt) the file key with the room key
export async function unwrapFileKey(roomKey: CryptoKey, wrappedKeyBase64: string, ivBase64: string): Promise<CryptoKey> {
  const ciphertext = base64ToBytes(wrappedKeyBase64);
  const iv = base64ToBytes(ivBase64);
  const rawKey = await decryptAESGCM(roomKey, ciphertext.buffer as ArrayBuffer, iv);

  return await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}
