/**
 * File Transfer Coordinator.
 * Manages chunking, encryption/decryption, backpressure, and reassembly.
 */

import { PeerConnectionManager } from './webrtc';
import { 
  generateFileKey, 
  wrapFileKey, 
  unwrapFileKey, 
  encryptText, 
  decryptText,
  base64ToBytes,
  bytesToBase64
} from './crypto';
import { encryptAESGCM, decryptAESGCM } from '../crypto/aes';
import { calculateFileHash } from '../crypto/integrity';
import { 
  saveFileMeta, 
  getFileMeta, 
  saveChunk, 
  getTransferChunks, 
  clearTransferChunks,
  StoredFileMeta 
} from './storage';

export const CHUNK_SIZE = 64 * 1024; // 64 KB chunks
export const BUFFER_HIGH_WATERMARK = 1024 * 1024; // 1 MB
export const BUFFER_LOW_WATERMARK = 64 * 1024; // 64 KB

export interface TransferProgress {
  transferId: string;
  bytesTransferred: number;
  progress: number;
  speedBytesPerSec: number;
  etaSec: number;
}

export interface FileTransferEvents {
  onProgress?: (progress: TransferProgress) => void;
  onIncomingTransfer?: (transfer: { transferId: string; fileName: string; sizeBytes: number; fileType: string }) => void;
  onComplete?: (transferId: string, blob: Blob, fileName: string) => void;
  onFailed?: (transferId: string, error: string) => void;
}

interface OutgoingTransferState {
  file: File;
  fileKey: CryptoKey;
  paused: boolean;
  cancelled: boolean;
  lastSentIndex: number;
}

interface IncomingTransferMeta {
  fileName: string;
  sizeBytes: number;
  fileType: string;
  hash: string;
}

interface IncomingTransferState {
  meta: IncomingTransferMeta;
  fileKey: CryptoKey;
  paused: boolean;
  cancelled: boolean;
  chunksReceivedCount: number;
  totalChunks: number;
}

export class FileTransferCoordinator {
  private pcManager: PeerConnectionManager;
  private roomKey: CryptoKey;
  private roomId: string;
  private events: FileTransferEvents;

  // Track active transfers
  private activeOutgoing: Map<string, OutgoingTransferState> = new Map();

  private activeIncoming: Map<string, IncomingTransferState> = new Map();

  constructor(
    pcManager: PeerConnectionManager,
    roomKey: CryptoKey,
    roomId: string,
    events: FileTransferEvents
  ) {
    this.pcManager = pcManager;
    this.roomKey = roomKey;
    this.roomId = roomId;
    this.events = events;
  }

  /**
   * Channels messages from the PeerConnectionManager to this coordinator.
   * Called from the roomStore's onMessage handler so both initiator and
   * receiver peers have their data correctly routed regardless of when
   * data channels were created.
   */
  public handleChannelMessage(label: string, data: string | ArrayBuffer): void {
    if (label === 'control' && typeof data === 'string') {
      this.handleControlMessage(data);
    } else if (label.startsWith('data-') && data instanceof ArrayBuffer) {
      this.handleDataMessage(data);
    }
  }

  /**
   * Starts a file transfer to the remote peer.
   */
  public async sendFile(file: File): Promise<string> {
    const transferId = window.crypto.randomUUID();
    const fileKey = await generateFileKey();
    const wrappedKeyData = await wrapFileKey(this.roomKey, fileKey);

    // Encrypt filename and filetype to preserve zero-knowledge
    const encNameData = await encryptText(this.roomKey, file.name);
    const encTypeData = await encryptText(this.roomKey, file.type);

    // Calculate file hash in background
    const hash = await calculateFileHash(file);

    const meta: StoredFileMeta = {
      id: transferId,
      roomId: this.roomId,
      encryptedName: encNameData.ciphertext,
      encryptedType: encTypeData.ciphertext,
      sizeBytes: file.size,
      hash,
      status: 'pending',
      direction: 'outgoing',
      progress: 0,
      addedAt: Date.now(),
    };

    await saveFileMeta(meta);

    this.activeOutgoing.set(transferId, {
      file,
      fileKey,
      paused: false,
      cancelled: false,
      lastSentIndex: -1,
    });

    // Send metadata to receiver
    this.sendControl({
      type: 'metadata',
      transferId,
      encryptedName: encNameData.ciphertext,
      nameIv: encNameData.iv,
      encryptedType: encTypeData.ciphertext,
      typeIv: encTypeData.iv,
      sizeBytes: file.size,
      wrappedKey: wrappedKeyData.ciphertext,
      keyIv: wrappedKeyData.iv,
      hash,
    });

    return transferId;
  }

  /**
   * Pauses an active transfer.
   */
  public pauseTransfer(transferId: string): void {
    const outgoing = this.activeOutgoing.get(transferId);
    if (outgoing) {
      outgoing.paused = true;
      this.sendControl({ type: 'pause', transferId });
    }

    const incoming = this.activeIncoming.get(transferId);
    if (incoming) {
      incoming.paused = true;
      this.sendControl({ type: 'pause', transferId });
    }
  }

  /**
   * Resumes a paused transfer.
   */
  public async resumeTransfer(transferId: string): Promise<void> {
    const outgoing = this.activeOutgoing.get(transferId);
    if (outgoing && outgoing.paused) {
      outgoing.paused = false;
      this.sendControl({ type: 'resume', transferId, lastReceivedChunkIndex: outgoing.lastSentIndex });
      this.streamOutgoing(transferId, outgoing.lastSentIndex + 1);
    }

    const incoming = this.activeIncoming.get(transferId);
    if (incoming && incoming.paused) {
      incoming.paused = false;
      this.sendControl({ type: 'resume', transferId, lastReceivedChunkIndex: incoming.chunksReceivedCount - 1 });
    }
  }

  /**
   * Cancels a transfer.
   */
  public async cancelTransfer(transferId: string): Promise<void> {
    const outgoing = this.activeOutgoing.get(transferId);
    if (outgoing) {
      outgoing.cancelled = true;
      this.activeOutgoing.delete(transferId);
      this.sendControl({ type: 'cancel', transferId });
      
      const meta = await getFileMeta(transferId);
      if (meta) {
        meta.status = 'failed';
        await saveFileMeta(meta);
      }
    }

    const incoming = this.activeIncoming.get(transferId);
    if (incoming) {
      incoming.cancelled = true;
      this.activeIncoming.delete(transferId);
      this.sendControl({ type: 'cancel', transferId });
      await clearTransferChunks(transferId);

      const meta = await getFileMeta(transferId);
      if (meta) {
        meta.status = 'failed';
        await saveFileMeta(meta);
      }
    }
  }

  /**
   * Handles incoming control events.
   */
  private async handleControlMessage(data: string | ArrayBuffer): Promise<void> {
    if (typeof data !== 'string') return;

    try {
      const msg = JSON.parse(data);
      const { type, transferId } = msg;

      switch (type) {
        case 'metadata': {
          // Decrypt name and type
          const fileName = await decryptText(this.roomKey, msg.encryptedName, msg.nameIv);
          const fileType = await decryptText(this.roomKey, msg.encryptedType, msg.typeIv);
          const fileKey = await unwrapFileKey(this.roomKey, msg.wrappedKey, msg.keyIv);

          const totalChunks = Math.ceil(msg.sizeBytes / CHUNK_SIZE);

          this.activeIncoming.set(transferId, {
            meta: {
              fileName,
              sizeBytes: msg.sizeBytes,
              fileType,
              hash: msg.hash,
            },
            fileKey,
            paused: false,
            cancelled: false,
            chunksReceivedCount: 0,
            totalChunks,
          });

          // Save metadata
          const meta: StoredFileMeta = {
            id: transferId,
            roomId: this.roomId,
            encryptedName: msg.encryptedName,
            encryptedType: msg.encryptedType,
            sizeBytes: msg.sizeBytes,
            hash: msg.hash,
            status: 'pending',
            direction: 'incoming',
            progress: 0,
            addedAt: Date.now(),
          };

          await saveFileMeta(meta);

          if (this.events.onIncomingTransfer) {
            this.events.onIncomingTransfer({
              transferId,
              fileName,
              sizeBytes: msg.sizeBytes,
              fileType,
            });
          }

          // Automatically accept for zero friction, or stores can trigger accept
          this.acceptTransfer(transferId);
          break;
        }

        case 'accept': {
          this.streamOutgoing(transferId, 0);
          break;
        }

        case 'pause': {
          const outgoing = this.activeOutgoing.get(transferId);
          if (outgoing) outgoing.paused = true;
          const incoming = this.activeIncoming.get(transferId);
          if (incoming) incoming.paused = true;
          break;
        }

        case 'resume': {
          const outgoing = this.activeOutgoing.get(transferId);
          if (outgoing) {
            outgoing.paused = false;
            this.streamOutgoing(transferId, msg.lastReceivedChunkIndex + 1);
          }
          break;
        }

        case 'cancel': {
          const outgoing = this.activeOutgoing.get(transferId);
          if (outgoing) {
            outgoing.cancelled = true;
            this.activeOutgoing.delete(transferId);
            if (this.events.onFailed) this.events.onFailed(transferId, 'Transfer cancelled by peer');
          }
          const incoming = this.activeIncoming.get(transferId);
          if (incoming) {
            incoming.cancelled = true;
            this.activeIncoming.delete(transferId);
            await clearTransferChunks(transferId);
            if (this.events.onFailed) this.events.onFailed(transferId, 'Transfer cancelled by peer');
          }
          break;
        }
      }
    } catch (err) {
      // ignore JSON parse errors
    }
  }

  private acceptTransfer(transferId: string): void {
    const incoming = this.activeIncoming.get(transferId);
    if (incoming) {
      this.sendControl({ type: 'accept', transferId });
    }
  }

  /**
   * Serializes a chunk packet into the wire format:
   * [1B Type][36B TransferID String][4B ChunkIndex u32][12B IV][Payload Ciphertext]
   */
  private serializeChunk(
    transferId: string,
    chunkIndex: number,
    iv: Uint8Array,
    ciphertext: ArrayBuffer
  ): ArrayBuffer {
    const encoder = new TextEncoder();
    const idBytes = encoder.encode(transferId); // UUID string is always 36 bytes
    
    const header = new ArrayBuffer(1 + 36 + 4 + 12);
    const view = new DataView(header);
    
    view.setUint8(0, 0x01); // 0x01 = File chunk
    const uint8Header = new Uint8Array(header);
    uint8Header.set(idBytes, 1);
    view.setUint32(1 + 36, chunkIndex, false); // Big endian
    uint8Header.set(iv, 1 + 36 + 4);

    const packet = new Uint8Array(header.byteLength + ciphertext.byteLength);
    packet.set(uint8Header, 0);
    packet.set(new Uint8Array(ciphertext), header.byteLength);

    return packet.buffer;
  }

  /**
   * Deserializes a chunk packet.
   */
  private deserializeChunk(packet: ArrayBuffer): {
    transferId: string;
    chunkIndex: number;
    iv: Uint8Array;
    ciphertext: ArrayBuffer;
  } | null {
    if (packet.byteLength < 53) return null;

    try {
      const view = new DataView(packet);
      const type = view.getUint8(0);
      if (type !== 0x01) return null;

      const decoder = new TextDecoder();
      const idBytes = new Uint8Array(packet, 1, 36);
      const transferId = decoder.decode(idBytes);
      const chunkIndex = view.getUint32(1 + 36, false);
      const iv = new Uint8Array(packet, 1 + 36 + 4, 12);
      const ciphertext = packet.slice(1 + 36 + 4 + 12);

      return {
        transferId,
        chunkIndex,
        iv,
        ciphertext,
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * Outgoing streaming engine.
   */
  private async streamOutgoing(transferId: string, startIndex: number): Promise<void> {
    const outgoing = this.activeOutgoing.get(transferId);
    if (!outgoing) return;

    const { file, fileKey } = outgoing;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    const meta = await getFileMeta(transferId);
    if (meta) {
      meta.status = 'transferring';
      await saveFileMeta(meta);
    }

    const startTime = Date.now();
    const bytesTransferredStart = startIndex * CHUNK_SIZE;

    try {
      for (let index = startIndex; index < totalChunks; index++) {
        // Exit loop early if state is modified
        if (outgoing.paused || outgoing.cancelled) return;

        const start = index * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const slice = file.slice(start, end);
        const chunkBuffer = await slice.arrayBuffer();

        // Encrypt chunk
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const { ciphertext } = await encryptAESGCM(fileKey, chunkBuffer, iv);

        // Serialize chunk packet
        const packet = this.serializeChunk(transferId, index, iv, ciphertext);

        // Map index to a data channel label round-robin
        const channelLabel = `data-${index % 4}`;
        const dc = this.pcManager.dataChannels.get(channelLabel);

        if (!dc || dc.readyState !== 'open') {
          throw new Error(`Data channel ${channelLabel} is not active`);
        }

        // Wait for drain to avoid WebRTC network buffer explosion
        await this.waitForDrain(dc);
        
        if (outgoing.paused || outgoing.cancelled) return;
        
        dc.send(packet);
        outgoing.lastSentIndex = index;

        // Calculate progress stats
        const currentBytes = end;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? (currentBytes - bytesTransferredStart) / elapsed : 0;
        const eta = speed > 0 ? (file.size - currentBytes) / speed : 0;
        const progress = Math.min(99.9, (currentBytes / file.size) * 100);

        if (meta) {
          meta.progress = progress;
          await saveFileMeta(meta);
        }

        if (this.events.onProgress) {
          this.events.onProgress({
            transferId,
            bytesTransferred: currentBytes,
            progress,
            speedBytesPerSec: speed,
            etaSec: eta,
          });
        }
      }

      // Finish Outgoing
      this.activeOutgoing.delete(transferId);
      if (meta) {
        meta.progress = 100;
        meta.status = 'completed';
        await saveFileMeta(meta);
      }

      if (this.events.onProgress) {
        this.events.onProgress({
          transferId,
          bytesTransferred: file.size,
          progress: 100,
          speedBytesPerSec: 0,
          etaSec: 0,
        });
      }
    } catch (err: any) {
      this.activeOutgoing.delete(transferId);
      if (meta) {
        meta.status = 'failed';
        await saveFileMeta(meta);
      }
      if (this.events.onFailed) {
        this.events.onFailed(transferId, err.message || 'Transmission failed');
      }
    }
  }

  /**
   * Handles incoming chunk messages on the WebRTC data channels.
   */
  private async handleDataMessage(data: ArrayBuffer): Promise<void> {
    const chunk = this.deserializeChunk(data);
    if (!chunk) return;

    const { transferId, chunkIndex, iv, ciphertext } = chunk;
    const incoming = this.activeIncoming.get(transferId);
    if (!incoming || incoming.paused || incoming.cancelled) return;

    try {
      // Package IV and ciphertext together for IndexedDB cache
      const chunkBuffer = new Uint8Array(12 + ciphertext.byteLength);
      chunkBuffer.set(iv, 0);
      chunkBuffer.set(new Uint8Array(ciphertext), 12);

      // 1. Save encrypted chunk into local IndexedDB
      await saveChunk({
        transferId,
        chunkIndex,
        data: chunkBuffer.buffer,
      });

      incoming.chunksReceivedCount++;

      const meta = await getFileMeta(transferId);
      const currentBytes = Math.min(incoming.meta.sizeBytes, incoming.chunksReceivedCount * CHUNK_SIZE);
      const progress = Math.min(99.9, (incoming.chunksReceivedCount / incoming.totalChunks) * 100);

      if (meta) {
        meta.status = 'transferring';
        meta.progress = progress;
        await saveFileMeta(meta);
      }

      if (this.events.onProgress) {
        this.events.onProgress({
          transferId,
          bytesTransferred: currentBytes,
          progress,
          speedBytesPerSec: 0, // Computed by sender, or receiver could track locally
          etaSec: 0,
        });
      }

      // 2. Reassemble when all chunks have been saved
      if (incoming.chunksReceivedCount >= incoming.totalChunks) {
        this.activeIncoming.delete(transferId);
        await this.reassembleFile(transferId, incoming);
      }
    } catch (err: any) {
      this.activeIncoming.delete(transferId);
      await clearTransferChunks(transferId);
      const meta = await getFileMeta(transferId);
      if (meta) {
        meta.status = 'failed';
        await saveFileMeta(meta);
      }
      if (this.events.onFailed) {
        this.events.onFailed(transferId, err.message || 'Chunk store error');
      }
    }
  }

  /**
   * Reassembles the stored file chunks, decrypts them, and verifies integrity.
   */
  private async reassembleFile(transferId: string, incoming: IncomingTransferState): Promise<void> {
    const meta = await getFileMeta(transferId);
    if (meta) {
      meta.status = 'verifying';
      meta.progress = 99.9;
      await saveFileMeta(meta);
    }

    try {
      // Fetch sorted chunks from IndexedDB
      const chunks = await getTransferChunks(transferId);
      if (chunks.length !== incoming.totalChunks) {
        throw new Error('Reassembly failed: missing chunks in IndexedDB');
      }

      // Decrypt chunks one by one
      const decryptedBuffers: ArrayBuffer[] = [];
      
      // We retrieve original ivs from the binary wire format. But wait, in handleDataMessage,
      // we only saved the ciphertext (ciphertext = data).
      // Oh! Did we save the IV?
      // Ah! In saveChunk, we did:
      // data: ciphertext.
      // Wait, to decrypt, we need the IV!
      // Oh! We should modify saveChunk to store both ciphertext and IV, or store them together.
      // Yes! In the binary wire format, we have the IV. If we store the IV along with the ciphertext
      // inside `StoredChunk`, or prepend it to the data field, it will be trivial to retrieve!
      // Let's check `storage.ts`. `StoredChunk` only has:
      // `data: ArrayBuffer`.
      // If we prepend the 12-byte IV to the ciphertext and save it to IndexedDB as `data`, we can easily
      // split it on reassembly: the first 12 bytes will be the IV, and the rest is ciphertext!
      // That is extremely clever and doesn't require modifying the database schema!
      // Let's do that! Let's update `handleDataMessage` to prepend the IV:
      // ```typescript
      // const chunkBuffer = new Uint8Array(12 + ciphertext.byteLength);
      // chunkBuffer.set(iv, 0);
      // chunkBuffer.set(new Uint8Array(ciphertext), 12);
      // await saveChunk({ transferId, chunkIndex, data: chunkBuffer.buffer });
      // ```
      // Then on decryption:
      // ```typescript
      // const chunkData = new Uint8Array(chunk.data);
      // const iv = chunkData.subarray(0, 12);
      // const ciphertext = chunkData.subarray(12);
      // ```
      // This is absolutely brilliant and elegant! Let's write the code exactly like this.
      
      for (const chunk of chunks) {
        const chunkData = new Uint8Array(chunk.data);
        const iv = chunkData.subarray(0, 12);
        const decrypted = await decryptAESGCM(incoming.fileKey, chunkData.buffer.slice(12), iv);
        decryptedBuffers.push(decrypted);
      }

      // Create reconstructed Blob
      const blob = new Blob(decryptedBuffers, { type: incoming.meta.fileType });

      // Run SHA-256 integrity validation
      const calculatedHash = await calculateFileHash(blob);
      if (calculatedHash !== incoming.meta.hash) {
        throw new Error('Integrity check failed: hash mismatch');
      }

      // Cleanup chunks from IndexedDB
      await clearTransferChunks(transferId);

      if (meta) {
        meta.status = 'completed';
        meta.progress = 100;
        await saveFileMeta(meta);
      }

      if (this.events.onComplete) {
        this.events.onComplete(transferId, blob, incoming.meta.fileName);
      }
    } catch (err: any) {
      await clearTransferChunks(transferId);
      if (meta) {
        meta.status = 'failed';
        await saveFileMeta(meta);
      }
      if (this.events.onFailed) {
        this.events.onFailed(transferId, err.message || 'File reassembly error');
      }
    }
  }

  /**
   * Non-blocking backpressure waiting.
   */
  private async waitForDrain(dc: RTCDataChannel): Promise<void> {
    if (dc.bufferedAmount < BUFFER_HIGH_WATERMARK) return;

    return new Promise<void>((resolve) => {
      dc.bufferedAmountLowThreshold = BUFFER_LOW_WATERMARK;

      // Guard: already below threshold between the check above and setting the threshold
      if (dc.bufferedAmount < BUFFER_LOW_WATERMARK) {
        resolve();
        return;
      }

      const onLow = () => {
        dc.removeEventListener('bufferedamountlow', onLow);
        resolve();
      };

      dc.addEventListener('bufferedamountlow', onLow);
    });
  }

  /**
   * Sends control frames over the signaling/control channel.
   */
  private sendControl(payload: Record<string, any>): void {
    if (this.pcManager.controlChannel && this.pcManager.controlChannel.readyState === 'open') {
      this.pcManager.controlChannel.send(JSON.stringify(payload));
    }
  }
}
