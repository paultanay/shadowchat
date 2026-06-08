import Dexie, { type Table } from 'dexie';

// Type definitions for stored entities (attributes encrypted where noted)
export interface StoredRoom {
  id: string; // Room UUID
  roomCode: string;
  encryptedName: string; // Base64 ciphertext
  encryptedConfig: string; // Base64 ciphertext
  joinedAt: number;
  role: 'owner' | 'member';
  roomKey?: string; // Room derived AES-GCM session key (Base64 JWK or raw, kept locally in IndexedDB)
}

export interface StoredFileMeta {
  id: string; // Transfer/File UUID
  roomId: string;
  encryptedName: string; // Base64 ciphertext of file name
  encryptedType: string; // Base64 ciphertext of mime type
  sizeBytes: number;
  hash: string; // SHA-256 integrity hash of file
  status: 'pending' | 'transferring' | 'completed' | 'failed' | 'paused' | 'verifying';
  direction: 'incoming' | 'outgoing';
  progress: number;
  addedAt: number;
}

export interface StoredMessage {
  id?: number; // Auto-incremented ID
  roomId: string;
  peerId: string;
  encryptedText: string; // Base64 ciphertext of chat message
  iv: string; // Base64 IV for AES-GCM decryption
  timestamp: number;
}

export interface StoredChunk {
  id?: number;
  transferId: string;
  chunkIndex: number;
  data: ArrayBuffer;
}

class ShadowChatDatabase extends Dexie {
  rooms!: Table<StoredRoom, string>;
  files!: Table<StoredFileMeta, string>;
  messages!: Table<StoredMessage, number>;
  chunks!: Table<StoredChunk, number>;

  constructor() {
    super('ShadowChatDB');
    this.version(1).stores({
      rooms: 'id, roomCode, joinedAt',
      files: 'id, roomId, status, addedAt',
      messages: '++id, roomId, timestamp',
      chunks: '++id, transferId, [transferId+chunkIndex]',
    });
  }
}

export const db = new ShadowChatDatabase();

// Repository helper functions
export async function saveRoom(room: StoredRoom): Promise<void> {
  try { await db.rooms.put(room); } catch { /* silent */ }
}

export async function saveFileMeta(file: StoredFileMeta): Promise<void> {
  try { await db.files.put(file); } catch { /* silent */ }
}

export async function getFileMeta(id: string): Promise<StoredFileMeta | undefined> {
  try { return await db.files.get(id); } catch { return undefined; }
}

export async function getRoomFiles(roomId: string): Promise<StoredFileMeta[]> {
  try { return await db.files.where('roomId').equals(roomId).sortBy('addedAt').then(r => r.reverse()); } catch { return []; }
}

export async function saveMessage(msg: StoredMessage): Promise<number> {
  try { return await db.messages.add(msg); } catch { return 0; }
}

export async function getRoomMessages(roomId: string): Promise<StoredMessage[]> {
  try { return await db.messages.where('roomId').equals(roomId).sortBy('timestamp'); } catch { return []; }
}

export async function saveChunk(chunk: StoredChunk): Promise<number> {
  try { return await db.chunks.add(chunk); } catch { return 0; }
}

export async function getTransferChunks(transferId: string): Promise<StoredChunk[]> {
  try { return await db.chunks.where('transferId').equals(transferId).sortBy('chunkIndex'); } catch { return []; }
}

export async function clearTransferChunks(transferId: string): Promise<void> {
  try { await db.chunks.where('transferId').equals(transferId).delete(); } catch { /* silent */ }
}
