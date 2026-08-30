import { create } from 'zustand';
import { SignalingClient } from '@/lib/engines/signaling';
import { PeerConnectionManager } from '@/lib/engines/webrtc';
import { 
  generateX25519KeyPair, 
  generateEd25519KeyPair 
} from '@/lib/crypto/keys';
import { 
  prepareKeyExchange, 
  completeKeyExchange, 
  encryptText, 
  decryptText,
  KeyExchangePacket
} from '@/lib/engines/crypto';
import { 
  saveRoom, 
  saveMessage, 
  getRoomMessages 
} from '@/lib/engines/storage';
import { FileTransferCoordinator } from '@/lib/engines/transfer';
import { useUIStore } from './uiStore';

const transferBlobs = new WeakMap<object, Blob>();
const transferBlobKeys = new Map<string, object>();

export const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const host = window.location.host;
    const protocol = window.location.protocol;
    if (host.includes('localhost') || host.includes('127.0.0.1')) {
      const apiPort = process.env.NEXT_PUBLIC_API_PORT ?? '8081';
      return `${protocol}//${window.location.hostname}:${apiPort}/api/v1`;
    }
    return `${protocol}//${host}/api/v1`;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8081/api/v1';
};

export interface Peer {
  id: string;
  isInitiator: boolean;
  pcManager: PeerConnectionManager | null;
  transferCoordinator: FileTransferCoordinator | null;
  roomKey: CryptoKey | null;
  status: 'connecting' | 'key-exchanging' | 'connected' | 'failed';
  presence: 'online' | 'typing' | 'idle';
}

export interface ChatMessage {
  id: string;
  peerId: string;
  senderName: string; // "You" or peerId/truncated
  text?: string;
  timestamp: number;
  type?: 'text' | 'file';
  transferId?: string;
  fileName?: string;
  fileSize?: number;
  fileType?: string;
}

interface RoomState {
  roomId: string | null;
  roomCode: string | null;
  roomRole: 'owner' | 'member' | null;
  roomConfig: {
    is_locked?: boolean;
    max_members?: number;
    encrypted_name?: string;
    encrypted_config?: string;
    [key: string]: unknown;
  } | null;
  token: string | null;
  peerId: string | null;
  
  // Local keys
  localX25519Pair: CryptoKeyPair | null;
  localEd25519Pair: CryptoKeyPair | null;
  
  // Signaling
  signaling: SignalingClient | null;
  signalingState: 'disconnected' | 'connecting' | 'connected';
  
  // P2P Topology
  peers: Map<string, Peer>;
  messages: ChatMessage[];
  
  // Pending transfers awaiting user opt-in
  pendingTransfers: Array<{ transferId: string; fileName: string; sizeBytes: number; fileType: string }>;

  // Active transfer trackers
  activeTransfers: Map<string, {
    peerId: string;
    fileName: string;
    sizeBytes: number;
    fileType: string;
    direction: 'incoming' | 'outgoing';
    progress: number;
    speedBytesPerSec: number;
    etaSec: number;
    status: 'pending' | 'transferring' | 'completed' | 'failed' | 'paused';
  }>;

  // Actions
  createRoom: (params: {
    encryptedName: Uint8Array;
    encryptedConfig: Uint8Array;
    maxMembers: number;
    isTemporary: boolean;
    lifetimeHours: number;
  }) => Promise<string>;
  joinRoom: (roomCode: string) => Promise<string>;
  connectSignaling: (roomId: string, token: string, role: 'owner' | 'member') => Promise<void>;
  disconnectRoom: () => void;
  sendChatMessage: (text: string) => Promise<void>;
  
  // Room controls (Owner only)
  lockRoom: () => Promise<void>;
  unlockRoom: () => Promise<void>;
  destroyRoom: () => Promise<void>;
  
  // P2P Actions
  getTransferBlob: (transferId: string) => Blob | undefined;
  initiateFileTransfer: (peerId: string, file: File) => Promise<string>;
  pauseFileTransfer: (peerId: string, transferId: string) => void;
  resumeFileTransfer: (peerId: string, transferId: string) => void;
  cancelFileTransfer: (peerId: string, transferId: string) => void;

  // Pending transfer opt-in
  acceptPendingTransfer: (transferId: string) => void;
  rejectPendingTransfer: (transferId: string) => void;
}

// Guards against duplicate initialization from React Strict Mode double-mount
let initializingPromise: Promise<void> | null = null;
let initializingRoomId: string | null = null;

// Queued signaling actions for peers whose pcManager is still initializing (during TURN fetch)
const pendingSignalingMessages = new Map<string, Array<() => Promise<void> | void>>();

const queueOrExecuteSignaling = (peerId: string, action: () => Promise<void> | void) => {
  const peer = useRoomStore.getState().peers.get(peerId);
  if (peer && peer.pcManager) {
    action();
  } else {
    if (!pendingSignalingMessages.has(peerId)) {
      pendingSignalingMessages.set(peerId, []);
    }
    pendingSignalingMessages.get(peerId)!.push(action);
  }
};

// Discard queued messages for a peer that has disconnected to prevent memory leaks.
const drainSignalingQueue = (peerId: string): void => {
  pendingSignalingMessages.delete(peerId);
};

const flushSignalingQueue = async (peerId: string) => {
  const actions = pendingSignalingMessages.get(peerId);
  if (actions) {
    pendingSignalingMessages.delete(peerId);
    for (const action of actions) {
      try {
        await action();
      } catch (err) {
        console.error(`[roomStore] Queued signaling action failed for peer ${peerId}:`, err);
      }
    }
  }
};

export const useRoomStore = create<RoomState>((set, get) => {
  const finalizeKeyExchange = async (from: string, derivedRoomKey: CryptoKey, roomId: string) => {
    set((s) => {
      const updatedPeers = new Map(s.peers);
      const peer = updatedPeers.get(from);
      if (peer) {
        peer.roomKey = derivedRoomKey;
        peer.status = 'connected';
        if (!peer.transferCoordinator && peer.pcManager) {
          const coordinator = new FileTransferCoordinator(
            peer.pcManager,
            derivedRoomKey,
            roomId,
            {
              onProgress: (progress) => {
                set((s) => {
                  const updatedTransfers = new Map(s.activeTransfers);
                  const current = updatedTransfers.get(progress.transferId);
                  if (current) {
                    current.progress = progress.progress;
                    current.speedBytesPerSec = progress.speedBytesPerSec;
                    current.etaSec = progress.etaSec;
                    current.status = progress.progress >= 100 ? 'completed' : 'transferring';
                    updatedTransfers.set(progress.transferId, current);
                  }
                  return { activeTransfers: updatedTransfers };
                });
              },
              onIncomingTransferRequest: (trans) => {
                set((s) => ({
                  pendingTransfers: [...s.pendingTransfers, trans],
                }));
              },
              onIncomingTransfer: async (trans) => {
                set((s) => {
                  const updatedTransfers = new Map(s.activeTransfers);
                  updatedTransfers.set(trans.transferId, {
                    peerId: from,
                    fileName: trans.fileName,
                    sizeBytes: trans.sizeBytes,
                    fileType: trans.fileType,
                    direction: 'incoming',
                    progress: 0,
                    speedBytesPerSec: 0,
                    etaSec: 0,
                    status: 'pending',
                  });
                  const fileMsg: ChatMessage = {
                    id: `msg-${trans.transferId}`,
                    peerId: from,
                    senderName: from.substring(0, 8),
                    timestamp: Date.now(),
                    type: 'file',
                    transferId: trans.transferId,
                    fileName: trans.fileName,
                    fileSize: trans.sizeBytes,
                    fileType: trans.fileType,
                  };
                  return { 
                    activeTransfers: updatedTransfers,
                    messages: [...s.messages, fileMsg]
                  };
                });
                useUIStore.getState().showToast({
                  type: 'info',
                  title: 'Incoming File',
                  message: `Receiving "${trans.fileName}" (${(trans.sizeBytes / 1024 / 1024).toFixed(1)} MB)...`,
                });

                if (roomId) {
                  try {
                    await saveMessage({
                      roomId,
                      peerId: from,
                      encryptedText: JSON.stringify({
                        type: trans.fileType,
                        name: trans.fileName,
                        size: trans.sizeBytes,
                      }),
                      iv: '',
                      timestamp: Date.now(),
                    });
                  } catch (err) {
                    console.warn('Failed to persist incoming file message:', err);
                  }
                }
              },
              onComplete: async (tid, blob, name) => {
                const blobKey: object = {};
                transferBlobs.set(blobKey, blob);
                transferBlobKeys.set(tid, blobKey);

                set((s) => {
                  const updatedTransfers = new Map(s.activeTransfers);
                  const current = updatedTransfers.get(tid);
                  if (current) {
                    current.progress = 100;
                    current.status = 'completed';
                    updatedTransfers.set(tid, current);
                  }
                  return { activeTransfers: updatedTransfers };
                });
                useUIStore.getState().showToast({
                  type: 'success',
                  title: 'Transfer Completed',
                  message: `Successfully received "${name}".`,
                });
              },
              onFailed: (tid, error) => {
                console.error('[transfer.onFailed] tid=', tid.substring(0, 8), 'error=', error);
                set((s) => {
                  const updatedTransfers = new Map(s.activeTransfers);
                  const current = updatedTransfers.get(tid);
                  if (current) {
                    current.status = 'failed';
                    updatedTransfers.set(tid, current);
                  }
                  return { activeTransfers: updatedTransfers };
                });
                useUIStore.getState().showToast({
                  type: 'error',
                  title: 'Transfer Failed',
                  message: error,
                });
              }
            }
          );
          peer.transferCoordinator = coordinator;
        }
      }
      return { peers: updatedPeers };
    });

    const currentMessages = get().messages;
    if (currentMessages.length > 0) {
      const recentMessages = currentMessages.slice(-50);
      const historyBundle = JSON.stringify({
        type: 'history-bundle',
        messages: recentMessages,
      });
      let attempts = 0;
      const trySend = () => {
        const peerObj = get().peers.get(from);
        if (peerObj?.pcManager?.controlChannel?.readyState === 'open') {
          peerObj.pcManager.controlChannel.send(historyBundle);
        } else if (attempts < 10) {
          attempts++;
          setTimeout(trySend, 150);
        }
      };
      trySend();
    }

    if (get().messages.length === 0) {
      const cachedMessages = await getRoomMessages(roomId);
      const decryptedMessages: ChatMessage[] = [];
      for (const msg of cachedMessages) {
        try {
          if (msg.iv) {
            const dec = await decryptText(derivedRoomKey, msg.encryptedText, msg.iv);
            decryptedMessages.push({
              id: `msg-${msg.timestamp}-${msg.peerId}`,
              peerId: msg.peerId,
              senderName: msg.peerId === get().peerId ? 'You' : msg.peerId.substring(0, 8),
              text: dec,
              timestamp: msg.timestamp,
            });
          } else {
            const parsed = JSON.parse(msg.encryptedText);
            decryptedMessages.push({
              id: `msg-${msg.timestamp}-${msg.peerId}`,
              peerId: msg.peerId,
              senderName: msg.peerId === get().peerId ? 'You' : msg.peerId.substring(0, 8),
              timestamp: msg.timestamp,
              type: 'file',
              fileName: parsed.name,
              fileSize: parsed.size,
              fileType: parsed.type,
            });
          }
        } catch {
          // Ignore key mismatch on old room history
        }
      }
      if (decryptedMessages.length > 0) {
        set((s) => ({
          messages: [...decryptedMessages, ...s.messages],
        }));
      }
    }
  };

  // Local function to spin up direct peer WebRTC connection
  const setupWebRTCPeer = async (remotePeerId: string, isInitiator: boolean) => {
    const { roomId, token, signaling, localX25519Pair, localEd25519Pair } = get();
    console.log('[roomStore] setupWebRTCPeer:', remotePeerId, 'isInitiator:', isInitiator);
    if (!roomId || !token || !signaling || !localX25519Pair || !localEd25519Pair) {
      console.warn('[roomStore] setupWebRTCPeer missing requirements');
      return;
    }

    // Guard: skip if setup is already in progress or completed for this peer.
    if (get().peers.has(remotePeerId)) {
      console.log('[roomStore] setupWebRTCPeer already exists for:', remotePeerId);
      return;
    }

    // Synchronously set a placeholder to prevent concurrent setup race.
    set((s) => {
      const updatedPeers = new Map(s.peers);
      updatedPeers.set(remotePeerId, {
        id: remotePeerId,
        isInitiator,
        pcManager: null,
        transferCoordinator: null,
        roomKey: null,
        status: 'connecting',
        presence: 'online'
      });
      return { peers: updatedPeers };
    });

    // 1. Fetch ephemeral TURN credentials from backend REST route
    let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    try {
      const abort = new AbortController();
      const turnTimeout = setTimeout(() => abort.abort(), 5000);
      const turnRes = await fetch(`${getApiBase()}/turn/credentials`, {
        headers: { 'Authorization': `Bearer ${token}` },
        signal: abort.signal,
      });
      clearTimeout(turnTimeout);
      if (turnRes.ok) {
        const turnData = await turnRes.json();
        console.log('[roomStore] TURN credentials received:', turnData);
        const validUrls = (turnData.urls || []).filter(
          (u: unknown) =>
            typeof u === 'string' &&
            u.trim().length > 0 &&
            (u.startsWith('stun:') || u.startsWith('turn:') || u.startsWith('turns:')) &&
            !u.includes('localhost') &&
            !u.includes('127.0.0.1')
        );
        if (validUrls.length > 0) {
          iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            {
              urls: validUrls,
              username: turnData.username,
              credential: turnData.credential || turnData.password,
            }
          ];
        }
      } else {
        console.warn('[roomStore] TURN credentials fetch failed:', turnRes.status);
      }
    } catch (err) {
      console.warn("[roomStore] Failed to gather TURN credentials, falling back to public STUN:", err);
    }

    // 2. Instantiate connection manager
    const pcManager = new PeerConnectionManager(
      remotePeerId,
      roomId,
      isInitiator,
      iceServers,
      signaling,
      {
        onStateChange: (state) => {
          set((s) => {
            const updatedPeers = new Map(s.peers);
            const peer = updatedPeers.get(remotePeerId);
            if (peer) {
              if (state === 'connected') {
                peer.status = peer.roomKey ? 'connected' : 'key-exchanging';
              } else if (state === 'failed') {
                peer.status = 'failed';
                drainSignalingQueue(remotePeerId);
              } else if (state === 'closed' || state === 'disconnected') {
                drainSignalingQueue(remotePeerId);
                updatedPeers.delete(remotePeerId);
              }
              return { peers: updatedPeers };
            }
            return {};
          });
        },
        onControlChannelOpen: async () => {
          console.log('[roomStore] Control channel OPENED for remote peer:', remotePeerId);
          const currentPeer = get().peers.get(remotePeerId);
          if (currentPeer) {
            if (currentPeer.roomKey) {
              set((s) => {
                const updated = new Map(s.peers);
                const p = updated.get(remotePeerId);
                if (p) p.status = 'connected';
                return { peers: updated };
              });
            } else {
              const { localX25519Pair, localEd25519Pair, roomId, signaling } = get();
              if (localX25519Pair && localEd25519Pair && roomId) {
                try {
                  const packet = await prepareKeyExchange(localX25519Pair, localEd25519Pair);
                  const packetStr = JSON.stringify(packet);
                  signaling?.send('key-exchange', roomId, remotePeerId, { payload: packetStr });
                  if (currentPeer.pcManager?.controlChannel?.readyState === 'open') {
                    currentPeer.pcManager.controlChannel.send(JSON.stringify({
                      type: 'key-exchange',
                      payload: packetStr,
                    }));
                  }
                } catch (e) {
                  console.warn('[roomStore] Failed sending control channel key-exchange fallback:', e);
                }
              }
            }
          }
        },
        onMessage: async (label, data) => {
          try {
            // Forward data to the FileTransferCoordinator if available
            const currentPeers = get().peers;
            const peerObj = currentPeers.get(remotePeerId);
            const coordinator = peerObj?.transferCoordinator;

            if (label === 'control' && typeof data === 'string') {
              const msg = JSON.parse(data);

              // Handle direct P2P key-exchange packet
              if (msg.type === 'key-exchange' && typeof msg.payload === 'string') {
                console.log('[roomStore] Received direct P2P key-exchange from:', remotePeerId);
                const { localX25519Pair, roomId } = get();
                if (localX25519Pair && roomId) {
                  try {
                    const packet: KeyExchangePacket = JSON.parse(msg.payload);
                    const derivedRoomKey = await completeKeyExchange(localX25519Pair.privateKey, packet, roomId);
                    await finalizeKeyExchange(remotePeerId, derivedRoomKey, roomId);
                  } catch (err) {
                    console.error('[roomStore] Direct P2P key-exchange failed:', err);
                  }
                }
                return;
              }

              // Handle chat messages
              if (msg.type === 'chat' && peerObj?.roomKey) {
                const decryptedText = await decryptText(peerObj.roomKey, msg.text, msg.iv);
                const timestamp = Date.now();
                const messageId = window.crypto.randomUUID();

                await saveMessage({
                  roomId,
                  peerId: remotePeerId,
                  encryptedText: msg.text,
                  iv: msg.iv,
                  timestamp,
                });

                set((s) => ({
                  messages: [
                    ...s.messages,
                    {
                      id: messageId,
                      peerId: remotePeerId,
                      senderName: remotePeerId.substring(0, 8),
                      text: decryptedText,
                      timestamp,
                    }
                  ]
                }));
              }

              // Handle history bundle
              if (msg.type === 'history-bundle' && Array.isArray(msg.messages)) {
                const existingIds = new Set(get().messages.map(m => m.id));
                const newMessages: ChatMessage[] = [];
                for (const hMsg of msg.messages) {
                  if (!existingIds.has(hMsg.id)) {
                    newMessages.push({
                      ...hMsg,
                      senderName: hMsg.peerId === get().peerId ? 'You' : hMsg.peerId.substring(0, 8),
                    });
                    existingIds.add(hMsg.id);
                    try {
                      if (hMsg.type === 'file') {
                        await saveMessage({
                          roomId,
                          peerId: hMsg.peerId,
                          encryptedText: JSON.stringify({
                            type: hMsg.fileType,
                            name: hMsg.fileName,
                            size: hMsg.fileSize,
                          }),
                          iv: '',
                          timestamp: hMsg.timestamp,
                        });
                      } else if (peerObj?.roomKey) {
                        const enc = await encryptText(peerObj.roomKey, hMsg.text || '');
                        await saveMessage({
                          roomId,
                          peerId: hMsg.peerId,
                          encryptedText: enc.ciphertext,
                          iv: enc.iv,
                          timestamp: hMsg.timestamp,
                        });
                      }
                    } catch (err) {
                      console.warn('Failed to persist history message:', err);
                    }
                  }
                }
                if (newMessages.length > 0) {
                  set((s) => ({
                    messages: [...s.messages, ...newMessages],
                  }));
                }
                return;
              }

              // Forward transfer control messages to coordinator
              if (coordinator) {
                coordinator.handleChannelMessage(label, data);
              }
            } else if (label.startsWith('data-') && data instanceof ArrayBuffer) {
              // Forward data channel messages (file chunks) to coordinator
              if (coordinator) {
                coordinator.handleChannelMessage(label, data);
              }
            }
          } catch {
            console.warn('[roomStore] Failed to parse signaling message');
          }
        }
      }
    );

    // Update the peer entry with the initialized pcManager
    set((s) => {
      const updatedPeers = new Map(s.peers);
      const peer = updatedPeers.get(remotePeerId);
      if (peer) {
        peer.pcManager = pcManager;
      }
      return { peers: updatedPeers };
    });

    await pcManager.initialize();

    // 3. Immediately exchange signed Curve25519 identity keys via signaling client
    const keyExchangePacket = await prepareKeyExchange(localX25519Pair, localEd25519Pair);
    signaling.send('key-exchange', roomId, remotePeerId, {
      payload: JSON.stringify(keyExchangePacket),
    });

    set((s) => {
      const updatedPeers = new Map(s.peers);
      const peer = updatedPeers.get(remotePeerId);
      if (peer) peer.status = 'key-exchanging';
      return { peers: updatedPeers };
    });

    // Flush any queued signaling messages that arrived during the async TURN fetch
    await flushSignalingQueue(remotePeerId);
  };

  return {
    roomId: null,
    roomCode: null,
    roomRole: null,
    roomConfig: null,
    token: null,
    peerId: null,
    localX25519Pair: null,
    localEd25519Pair: null,
    signaling: null,
    signalingState: 'disconnected',
    peers: new Map(),
    messages: [],
    pendingTransfers: [],
    activeTransfers: new Map(),

    createRoom: async (params) => {
      // 1. Generate unique peer identity for current session
      const generatedPeerId = window.crypto.randomUUID();
      const roomId = window.crypto.randomUUID();

      // Convert typed arrays to Base64 string payload
      const payload = {
        id: roomId,
        encrypted_name: Array.from(params.encryptedName),
        encrypted_config: Array.from(params.encryptedConfig),
        max_members: params.maxMembers,
        is_temporary: params.isTemporary,
        lifetime_hours: params.lifetimeHours,
        peer_id: generatedPeerId,
      };

      const res = await fetch(`${getApiBase()}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to create secure room');
      }

      const data = await res.json();
      
      set({
        roomId: data.room.id,
        roomCode: data.room.room_code,
        roomRole: 'owner',
        roomConfig: data.room,
        token: data.token,
        peerId: generatedPeerId,
      });

      // Save room entry locally to IndexedDB cache
      await saveRoom({
        id: data.room.id,
        roomCode: data.room.room_code,
        encryptedName: window.btoa(String.fromCharCode(...params.encryptedName)),
        encryptedConfig: window.btoa(String.fromCharCode(...params.encryptedConfig)),
        joinedAt: Date.now(),
        role: 'owner',
      });

      return data.room.room_code;
    },

    joinRoom: async (roomCode) => {
      const generatedPeerId = window.crypto.randomUUID();

      const res = await fetch(`${getApiBase()}/rooms/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room_code: roomCode.toUpperCase(),
          peer_id: generatedPeerId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to join secure room');
      }

      const data = await res.json();

      set({
        roomId: data.room.id,
        roomCode: data.room.room_code,
        roomRole: 'member',
        roomConfig: data.room,
        token: data.token,
        peerId: generatedPeerId,
      });

      await saveRoom({
        id: data.room.id,
        roomCode: data.room.room_code,
        encryptedName: data.room.encrypted_name,
        encryptedConfig: data.room.encrypted_config,
        joinedAt: Date.now(),
        role: 'member',
      });

      return data.room.id;
    },

    connectSignaling: async (roomId, token, role) => {
      const { signalingState, peerId } = get();
      if (signalingState === 'connected') return;

      if (initializingRoomId === roomId && initializingPromise) {
        return initializingPromise;
      }
      initializingRoomId = roomId;

      initializingPromise = (async () => {
        // Decode peer_id dynamically from JWT claims if missing from state (e.g. on direct page reload)
        let activePeerId = peerId;
        if (!activePeerId && token) {
          try {
            const payloadPart = token.split('.')[1];
            if (payloadPart) {
              const decoded = JSON.parse(window.atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')));
              if (decoded && decoded.peer_id) {
                activePeerId = decoded.peer_id;
              }
            }
          } catch (e) {
            console.error("Failed to decode JWT token payload:", e);
          }
        }

        if (!activePeerId) {
          activePeerId = window.crypto.randomUUID();
        }

        const x25519Pair = await generateX25519KeyPair();
        const ed25519Pair = await generateEd25519KeyPair();

        set({
          roomId: roomId,
          token: token,
          roomRole: role,
          peerId: activePeerId,
          localX25519Pair: x25519Pair,
          localEd25519Pair: ed25519Pair,
          signalingState: 'connecting',
        });

        const client = new SignalingClient(roomId, token);

        client.on('connect', () => {
          set({ signaling: client, signalingState: 'connected' });
          useUIStore.getState().showToast({
            type: 'success',
            title: 'Connected',
            message: 'Zero-knowledge channel established with server.',
          });
        });

        client.on('disconnect', () => {
          set({ signalingState: 'disconnected' });
          if (!useUIStore.getState().pageLeaving) {
            useUIStore.getState().showToast({
              type: 'warning',
              title: 'Disconnected',
              message: 'Signaling lost. Attempting auto-reconnect...',
            });
          }
        });

        client.on('peer-joined', ({ peerId: remotePeerId }) => {
          const currentPeerId = get().peerId;
          console.log('[roomStore] peer-joined:', remotePeerId);
          if (remotePeerId !== currentPeerId) {
            useUIStore.getState().showToast({
              type: 'info',
              title: 'Peer Joined',
              message: `Establishing direct P2P tunnel with ${remotePeerId.substring(0, 8)}...`,
            });
            if (!currentPeerId) return;
            const isInitiator = currentPeerId < remotePeerId;
            setupWebRTCPeer(remotePeerId, isInitiator);
          }
        });

        client.on('peer-left', ({ peerId: remotePeerId }) => {
          console.log('[roomStore] peer-left:', remotePeerId);
          // Discard any queued signaling actions for this peer to prevent leaks.
          drainSignalingQueue(remotePeerId);
          set((s) => {
            const updatedPeers = new Map(s.peers);
            const peer = updatedPeers.get(remotePeerId);
            if (peer) {
              peer.pcManager?.close();
              updatedPeers.delete(remotePeerId);
            }
            return { peers: updatedPeers };
          });
          if (!useUIStore.getState().pageLeaving) {
            useUIStore.getState().showToast({
              type: 'info',
              title: 'Peer Left',
              message: `Connection with ${remotePeerId.substring(0, 8)} terminated.`,
            });
          }
        });

        client.on('room-state', ({ peers: peerList }) => {
          console.log('[roomStore] room-state:', peerList);
          const currentPeerId = get().peerId;
          peerList.forEach((pid) => {
            if (pid !== currentPeerId && !get().peers.has(pid)) {
              if (!currentPeerId) return;
              const isInitiator = currentPeerId < pid;
              setupWebRTCPeer(pid, isInitiator);
            }
          });
        });

        client.on('offer', async ({ from, sdp }) => {
          console.log('[roomStore] offer from:', from);
          const peer = get().peers.get(from);
          if (!peer) {
            const currentPeerId = get().peerId;
            if (currentPeerId) {
              const isInitiator = currentPeerId < from;
              console.log('[roomStore] auto-setting up WebRTC peer on incoming offer:', from);
              await setupWebRTCPeer(from, isInitiator);
            }
          }
          queueOrExecuteSignaling(from, async () => {
            const currentPeer = get().peers.get(from);
            if (currentPeer?.pcManager) {
              await currentPeer.pcManager.handleOffer(sdp);
            }
          });
        });

        client.on('answer', async ({ from, sdp }) => {
          console.log('[roomStore] answer from:', from);
          queueOrExecuteSignaling(from, async () => {
            const peer = get().peers.get(from);
            if (peer?.pcManager) {
              await peer.pcManager.handleAnswer(sdp);
            }
          });
        });

        client.on('ice', async ({ from, candidate }) => {
          console.log('[roomStore] ice from:', from);
          queueOrExecuteSignaling(from, async () => {
            const peer = get().peers.get(from);
            if (peer?.pcManager) {
              await peer.pcManager.addIceCandidate(candidate);
            }
          });
        });

        client.on('key-exchange', async ({ from, payload }) => {
          console.log('[roomStore] key-exchange from:', from);
          queueOrExecuteSignaling(from, async () => {
            const { localX25519Pair, roomId } = get();
            if (!localX25519Pair || !roomId) {
              console.warn('[roomStore] key-exchange: missing localX25519Pair or roomId');
              return;
            }

            try {
              const packet: KeyExchangePacket = JSON.parse(payload);
              console.log('[roomStore] Completing key exchange for:', from);
              const derivedRoomKey = await completeKeyExchange(
                localX25519Pair.privateKey,
                packet,
                roomId
              );
              console.log('[roomStore] Key exchange completed for:', from);
              await finalizeKeyExchange(from, derivedRoomKey, roomId);
            } catch (err) {
              console.error('Complete key exchange failure:', err);
            }
          });
        });

        client.on('presence', ({ from, status }) => {
          set((s) => {
            const updatedPeers = new Map(s.peers);
            const peer = updatedPeers.get(from);
            if (peer) {
          peer.presence = status as 'online' | 'typing' | 'idle';
            }
            return { peers: updatedPeers };
          });
        });

        try {
          await client.connect();
          set({ signaling: client });
        } catch (err) {
          console.error('Failed to connect signaling:', err);
        }
      })();

      try {
        return await initializingPromise;
      } finally {
        initializingRoomId = null;
        initializingPromise = null;
      }
    },

    disconnectRoom: () => {
      const { signaling, peers } = get();
      if (signaling) signaling.disconnect();
      peers.forEach((p) => p.pcManager?.close());
      transferBlobKeys.clear();
      set({
        roomId: null,
        roomCode: null,
        roomRole: null,
        roomConfig: null,
        token: null,
        peerId: null,
        localX25519Pair: null,
        localEd25519Pair: null,
        signaling: null,
        signalingState: 'disconnected',
        peers: new Map(),
        messages: [],
        pendingTransfers: [],
        activeTransfers: new Map(),
      });
    },

    sendChatMessage: async (text) => {
      const { roomId, peerId, peers } = get();
      if (!roomId || !peerId || peers.size === 0) return;

      const timestamp = Date.now();
      const messageId = window.crypto.randomUUID();

      // Broadcast encrypted message to each connected peer.
      // Encryption key is the same shared room key so encrypt once per peer,
      // but save to IndexedDB only once (outside the loop) to avoid duplicates.
      let anySent = false;
      let firstEnc: { ciphertext: string; iv: string } | null = null;

      // Diagnostic: log the exact state of each peer at send time
      console.log('[sendChatMessage] peers count:', peers.size, 'text:', text.substring(0, 20));
      for (const [remoteId, peer] of peers) {
        console.log(
          '[sendChatMessage] peer:', remoteId.substring(0, 8),
          '| status:', peer.status,
          '| roomKey:', peer.roomKey ? 'SET' : 'NULL',
          '| controlChannel:', peer.pcManager?.controlChannel?.readyState ?? 'no-channel'
        );
      }

      for (const [remoteId, peer] of peers) {
        if (peer.roomKey && peer.pcManager?.controlChannel?.readyState === 'open') {
          try {
            const enc = await encryptText(peer.roomKey, text);
            if (!firstEnc) firstEnc = enc;
            peer.pcManager.controlChannel.send(JSON.stringify({
              type: 'chat',
              text: enc.ciphertext,
              iv: enc.iv,
            }));
            anySent = true;
          } catch (err) {
            console.error('Failed to encrypt/send message to peer', remoteId, err);
          }
        }
      }

      if (!anySent) {
        // Tell the user why — don't silently drop
        const reasons: string[] = [];
        for (const [, peer] of peers) {
          if (!peer.roomKey) reasons.push('Key exchange still in progress');
          else if (peer.pcManager?.controlChannel?.readyState !== 'open')
            reasons.push(`Channel not open (${peer.pcManager?.controlChannel?.readyState ?? 'null'})`);
        }
        const reason = reasons.length > 0 ? reasons[0] : 'No connected peers';
        console.warn('[sendChatMessage] dropped — reason:', reason);
        useUIStore.getState().showToast({
          type: 'warning',
          title: 'Secure channel not ready',
          message: reason + '. Please wait a moment and try again.',
        });
        return;
      }

      // Persist message to local IndexedDB once — outside the loop
      if (firstEnc) {
        try {
          await saveMessage({
            roomId,
            peerId,
            encryptedText: firstEnc.ciphertext,
            iv: firstEnc.iv,
            timestamp,
          });
        } catch (err) {
          console.warn('Failed to persist sent message to IndexedDB:', err);
        }

        // Add bubble to local UI state
        set((s) => ({
          messages: [
            ...s.messages,
            { id: messageId, peerId, senderName: 'You', text, timestamp }
          ]
        }));
      }
    },


    // Room controls (Owner only)
    lockRoom: async () => {
      if (get().roomRole !== 'owner') return;
      const { roomId, token } = get();
      if (!roomId || !token) return;

      const res = await fetch(`${getApiBase()}/rooms/${roomId}/lock`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        set((s) => ({ roomConfig: { ...s.roomConfig, is_locked: true } }));
        useUIStore.getState().showToast({
          type: 'info',
          title: 'Room Locked',
          message: 'No new members can join this room.',
        });
      }
    },

    unlockRoom: async () => {
      if (get().roomRole !== 'owner') return;
      const { roomId, token } = get();
      if (!roomId || !token) return;

      const res = await fetch(`${getApiBase()}/rooms/${roomId}/unlock`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        set((s) => ({ roomConfig: { ...s.roomConfig, is_locked: false } }));
        useUIStore.getState().showToast({
          type: 'info',
          title: 'Room Unlocked',
          message: 'New members can now join.',
        });
      }
    },

    destroyRoom: async () => {
      if (get().roomRole !== 'owner') return;
      const { roomId, token } = get();
      if (!roomId || !token) return;

      const res = await fetch(`${getApiBase()}/rooms/${roomId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        get().disconnectRoom();
        useUIStore.getState().showToast({
          type: 'success',
          title: 'Room Destroyed',
          message: 'Ephemeral credentials cleared. All secure metadata deleted.',
        });
        window.location.href = '/';
      }
    },

    // P2P Transfer coordinator bridge
    getTransferBlob: (transferId: string): Blob | undefined => {
      const key = transferBlobKeys.get(transferId);
      if (!key) return undefined;
      return transferBlobs.get(key);
    },

    initiateFileTransfer: async (peerId, file) => {
      const peer = get().peers.get(peerId);
      if (!peer || !peer.transferCoordinator) {
        console.warn('[initiateFileTransfer] peer or coordinator missing, peerId=', peerId?.substring(0, 8));
        throw new Error('Peer not fully connected (secure channel pending)');
      }

      const tid = await peer.transferCoordinator.sendFile(file);
      
      const blobKey: object = {};
      if (file.size > 0) {
        transferBlobs.set(blobKey, new Blob([file], { type: file.type }));
        transferBlobKeys.set(tid, blobKey);
      }

      set((s) => {
        const updatedTransfers = new Map(s.activeTransfers);
        updatedTransfers.set(tid, {
          peerId,
          fileName: file.name,
          sizeBytes: file.size,
          fileType: file.type,
          direction: 'outgoing',
          progress: 0,
          speedBytesPerSec: 0,
          etaSec: 0,
          status: 'pending',
        });

        const fileMsg: ChatMessage = {
          id: `msg-${tid}`,
          peerId: s.peerId || '',
          senderName: 'You',
          timestamp: Date.now(),
          type: 'file',
          transferId: tid,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
        };

        return { 
          activeTransfers: updatedTransfers,
          messages: [...s.messages, fileMsg]
        };
      });

      const roomId = get().roomId;
      if (roomId) {
        try {
          await saveMessage({
            roomId,
            peerId: peerId,
            encryptedText: JSON.stringify({
              type: file.type,
              name: file.name,
              size: file.size,
            }),
            iv: '',
            timestamp: Date.now(),
          });
        } catch (err) {
          console.warn('Failed to persist outgoing file message:', err);
        }
      }

      return tid;
    },

    pauseFileTransfer: (peerId, transferId) => {
      const peer = get().peers.get(peerId);
      if (peer?.transferCoordinator) {
        peer.transferCoordinator.pauseTransfer(transferId);
        set((s) => {
          const updated = new Map(s.activeTransfers);
          const c = updated.get(transferId);
          if (c) {
            c.status = 'paused';
            updated.set(transferId, c);
          }
          return { activeTransfers: updated };
        });
      }
    },

    resumeFileTransfer: (peerId, transferId) => {
      const peer = get().peers.get(peerId);
      if (peer?.transferCoordinator) {
        peer.transferCoordinator.resumeTransfer(transferId);
      }
    },

    cancelFileTransfer: (peerId, transferId) => {
      const peer = get().peers.get(peerId);
      if (peer?.transferCoordinator) {
        peer.transferCoordinator.cancelTransfer(transferId);
      }
      const key = transferBlobKeys.get(transferId);
      if (key) {
        transferBlobs.delete(key);
        transferBlobKeys.delete(transferId);
      }
    },

    acceptPendingTransfer: (transferId) => {
      const pending = get().pendingTransfers.find(t => t.transferId === transferId);
      if (!pending) return;
      for (const [, peer] of get().peers) {
        if (peer.transferCoordinator) {
          peer.transferCoordinator.acceptTransfer(transferId);
        }
      }
      set((s) => ({
        pendingTransfers: s.pendingTransfers.filter(t => t.transferId !== transferId),
      }));
    },

    rejectPendingTransfer: (transferId) => {
      for (const [, peer] of get().peers) {
        if (peer.transferCoordinator) {
          peer.transferCoordinator.cancelTransfer(transferId);
        }
      }
      set((s) => ({
        pendingTransfers: s.pendingTransfers.filter(t => t.transferId !== transferId),
      }));
    }
  };
});
