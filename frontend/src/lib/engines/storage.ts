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
  await db.rooms.put(room);
}

export async function getRoom(id: string): Promise<StoredRoom | undefined> {
  return await db.rooms.get(id);
}

export async function getAllRooms(): Promise<StoredRoom[]> {
  return await db.rooms.orderBy('joinedAt').reverse().toArray();
}

export async function deleteRoom(id: string): Promise<void> {
  await db.transaction('rw', [db.rooms, db.files, db.messages, db.chunks], async () => {
    await db.rooms.delete(id);
    const files = await db.files.where('roomId').equals(id).toArray();
    for (const file of files) {
      await db.chunks.where('transferId').equals(file.id).delete();
    }
    await db.files.where('roomId').equals(id).delete();
    await db.messages.where('roomId').equals(id).delete();
  });
}

export async function saveFileMeta(file: StoredFileMeta): Promise<void> {
  await db.files.put(file);
}

export async function getFileMeta(id: string): Promise<StoredFileMeta | undefined> {
  return await db.files.get(id);
}

export async function getRoomFiles(roomId: string): Promise<StoredFileMeta[]> {
  return await db.files.where('roomId').equals(roomId).reverse().sortBy('addedAt');
}

export async function saveMessage(msg: StoredMessage): Promise<number> {
  return await db.messages.add(msg);
}

export async function getRoomMessages(roomId: string): Promise<StoredMessage[]> {
  return await db.messages.where('roomId').equals(roomId).sortBy('timestamp');
}

export async function saveChunk(chunk: StoredChunk): Promise<number> {
  return await db.chunks.add(chunk);
}

export async function getTransferChunks(transferId: string): Promise<StoredChunk[]> {
  return await db.chunks.where('transferId').equals(transferId).sortBy('chunkIndex');
}

export async function clearTransferChunks(transferId: string): Promise<void> {
  await db.chunks.where('transferId').equals(transferId).delete();
}
