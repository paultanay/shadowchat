import { create } from 'zustand';
import { SignalingClient } from '@/lib/engines/signaling';
import { PeerConnectionManager } from '@/lib/engines/webrtc';
import { 
  generateX25519KeyPair, 
  generateEd25519KeyPair, 
  exportKeyToJwk, 
  importX25519PublicKey, 
  importEd25519PublicKey 
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
  getRoom, 
  saveMessage, 
  getRoomMessages, 
  StoredMessage,
  StoredRoom 
} from '@/lib/engines/storage';
import { FileTransferCoordinator } from '@/lib/engines/transfer';
import { useUIStore } from './uiStore';

const getApiBase = () => {
  if (typeof window !== 'undefined') {
    const host = window.location.host;
    const protocol = window.location.protocol;
    if (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('shadowchat.local')) {
      if (host.includes(':3000')) {
        return `${protocol}//${window.location.hostname}:8080/api/v1`;
      }
      return `${protocol}//${host}/api/v1`;
    }
  }
  return process.env.NEXT_PUBLIC_API_URL || 'https://api.shadowchat.local/api/v1';
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
  text: string;
  timestamp: number;
}

interface RoomState {
  roomId: string | null;
  roomCode: string | null;
  roomRole: 'owner' | 'member' | null;
  roomConfig: any | null;
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
  
  // Active transfer trackers
  activeTransfers: Map<string, {
    fileName: string;
    sizeBytes: number;
    fileType: string;
    direction: 'incoming' | 'outgoing';
    progress: number;
    speedBytesPerSec: number;
    etaSec: number;
    status: 'pending' | 'transferring' | 'completed' | 'failed' | 'paused';
    blob?: Blob;
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
  initiateFileTransfer: (peerId: string, file: File) => Promise<string>;
  pauseFileTransfer: (peerId: string, transferId: string) => void;
  resumeFileTransfer: (peerId: string, transferId: string) => void;
  cancelFileTransfer: (peerId: string, transferId: string) => void;
}

export const useRoomStore = create<RoomState>((set, get) => {
  // Local function to spin up direct peer WebRTC connection
  const setupWebRTCPeer = async (remotePeerId: string, isInitiator: boolean) => {
    const { roomId, token, signaling, localX25519Pair, localEd25519Pair, peers } = get();
    if (!roomId || !token || !signaling || !localX25519Pair || !localEd25519Pair) return;

    // 1. Fetch ephemeral TURN credentials from backend REST route
    let iceServers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
    try {
      const turnRes = await fetch(`${getApiBase()}/turn/credentials`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (turnRes.ok) {
        const turnData = await turnRes.json();
        iceServers = [
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: turnData.urls || [],
            username: turnData.username,
            credential: turnData.credential,
          }
        ];
      }
    } catch (err) {
      console.warn("Failed to gather TURN credentials, falling back to public STUN:", err);
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
              if (state === 'connected') peer.status = 'connected';
              else if (state === 'failed') peer.status = 'failed';
              else if (state === 'closed' || state === 'disconnected') {
                updatedPeers.delete(remotePeerId);
              }
              return { peers: updatedPeers };
            }
            return {};
          });
        },
        onMessage: async (label, data) => {
          if (label === 'control' && typeof data === 'string') {
            try {
              const msg = JSON.parse(data);
              if (msg.type === 'chat') {
                const currentPeers = get().peers;
                const peerObj = currentPeers.get(remotePeerId);
                if (peerObj?.roomKey) {
                  const decryptedText = await decryptText(peerObj.roomKey, msg.text, msg.iv);
                  const timestamp = Date.now();
                  const messageId = window.crypto.randomUUID();

                  // Save encrypted copy to local IndexDB cache for history
                  await saveMessage({
                    roomId,
                    peerId: remotePeerId,
                    encryptedText: msg.text,
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
              }
            } catch (err) {
              // ignore
            }
          }
        }
      }
    );

    // Update state with peer instance in "connecting" state
    set((s) => {
      const updatedPeers = new Map(s.peers);
      updatedPeers.set(remotePeerId, {
        id: remotePeerId,
        isInitiator,
        pcManager,
        transferCoordinator: null,
        roomKey: null,
        status: 'connecting',
        presence: 'online'
      });
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
        throw new Error(errData.error || 'Failed to create secure chamber');
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
        throw new Error(errData.error || 'Failed to join secure chamber');
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

      // 1. Generate ephemeral local Curve keypairs for E2EE room exchange
      const x25519Pair = await generateX25519KeyPair();
      const ed25519Pair = await generateEd25519KeyPair();

      set({
        localX25519Pair: x25519Pair,
        localEd25519Pair: ed25519Pair,
        signalingState: 'connecting',
      });

      const client = new SignalingClient(roomId, token);

      client.on('connect', () => {
        set({ signalingState: 'connected' });
        useUIStore.getState().showToast({
          type: 'success',
          title: 'Connected',
          message: 'Zero-knowledge channel established with server.',
        });
      });

      client.on('disconnect', () => {
        set({ signalingState: 'disconnected' });
        useUIStore.getState().showToast({
          type: 'warning',
          title: 'Disconnected',
          message: 'Signaling lost. Attempting auto-reconnect...',
        });
      });

      // Peer joined -> Initiator starts WebRTC connection
      client.on('peer-joined', ({ peerId: remotePeerId }) => {
        if (remotePeerId !== peerId) {
          useUIStore.getState().showToast({
            type: 'info',
            title: 'Peer Joined',
            message: `Establishing direct P2P tunnel with ${remotePeerId.substring(0, 8)}...`,
          });
          
          // Initiator sets up RTCPeerConnection
          setupWebRTCPeer(remotePeerId, true);
        }
      });

      client.on('peer-left', ({ peerId: remotePeerId }) => {
        set((s) => {
          const updatedPeers = new Map(s.peers);
          const peer = updatedPeers.get(remotePeerId);
          if (peer) {
            peer.pcManager?.close();
            updatedPeers.delete(remotePeerId);
          }
          return { peers: updatedPeers };
        });
        useUIStore.getState().showToast({
          type: 'info',
          title: 'Peer Left',
          message: `Connection with ${remotePeerId.substring(0, 8)} terminated.`,
        });
      });

      client.on('room-state', ({ peers: peerList }) => {
        // Sync active members list. If we are NOT the initiator, we wait for inbound RTCPeerConnection events,
        // or trigger setup depending on peer lexicographical rank to avoid glare.
        peerList.forEach((pid) => {
          if (pid !== peerId && !get().peers.has(pid)) {
            // Lexicographical ordering decides initiator in concurrent joining to prevent duplicate connections
            const isInitiator = peerId! < pid;
            setupWebRTCPeer(pid, isInitiator);
          }
        });
      });

      // WebRTC SDP relaying
      client.on('offer', async ({ from, sdp }) => {
        const peer = get().peers.get(from);
        if (peer?.pcManager) {
          await peer.pcManager.handleOffer(sdp);
        }
      });

      client.on('answer', async ({ from, sdp }) => {
        const peer = get().peers.get(from);
        if (peer?.pcManager) {
          await peer.pcManager.handleAnswer(sdp);
        }
      });

      client.on('ice', async ({ from, candidate }) => {
        const peer = get().peers.get(from);
        if (peer?.pcManager) {
          await peer.pcManager.addIceCandidate(candidate);
        }
      });

      // E2EE Key Exchange Packet
      client.on('key-exchange', async ({ from, payload }) => {
        const { localX25519Pair } = get();
        if (!localX25519Pair) return;

        try {
          const packet: KeyExchangePacket = JSON.parse(payload);
          const derivedRoomKey = await completeKeyExchange(
            localX25519Pair.privateKey,
            packet,
            roomId
          );

          // Once secure E2EE key is completed, set up FileTransferCoordinator for this peer
          set((s) => {
            const updatedPeers = new Map(s.peers);
            const peer = updatedPeers.get(from);
            if (peer) {
              peer.roomKey = derivedRoomKey;
              peer.status = 'connected';

              // Create file transfer coordinator with derived room key
              const coordinator = new FileTransferCoordinator(
                peer.pcManager!,
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
                        current.status = 'transferring';
                        updatedTransfers.set(progress.transferId, current);
                      }
                      return { activeTransfers: updatedTransfers };
                    });
                  },
                  onIncomingTransfer: (trans) => {
                    set((s) => {
                      const updatedTransfers = new Map(s.activeTransfers);
                      updatedTransfers.set(trans.transferId, {
                        fileName: trans.fileName,
                        sizeBytes: trans.sizeBytes,
                        fileType: trans.fileType,
                        direction: 'incoming',
                        progress: 0,
                        speedBytesPerSec: 0,
                        etaSec: 0,
                        status: 'pending',
                      });
                      return { activeTransfers: updatedTransfers };
                    });
                    
                    useUIStore.getState().showToast({
                      type: 'info',
                      title: 'Incoming File',
                      message: `Receiving "${trans.fileName}" (${(trans.sizeBytes / 1024 / 1024).toFixed(1)} MB)...`,
                    });
                  },
                  onComplete: async (tid, blob, name) => {
                    set((s) => {
                      const updatedTransfers = new Map(s.activeTransfers);
                      const current = updatedTransfers.get(tid);
                      if (current) {
                        current.progress = 100;
                        current.status = 'completed';
                        current.blob = blob;
                        updatedTransfers.set(tid, current);
                      }
                      return { activeTransfers: updatedTransfers };
                    });

                    // Trigger direct local download
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = name;
                    a.click();
                    URL.revokeObjectURL(url);

                    useUIStore.getState().showToast({
                      type: 'success',
                      title: 'Transfer Completed',
                      message: `Successfully received "${name}".`,
                    });
                  },
                  onFailed: (tid, error) => {
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

              coordinator.registerListeners();
              peer.transferCoordinator = coordinator;
            }
            return { peers: updatedPeers };
          });

          // Sync old messages from IndexedDB local cache for UI
          const cachedMessages = await getRoomMessages(roomId);
          const decryptedMessages: ChatMessage[] = [];
          for (const msg of cachedMessages) {
            try {
              const text = await decryptText(derivedRoomKey, msg.encryptedText, msg.encryptedText); // iv is prepended or separate
              decryptedMessages.push({
                id: String(msg.id),
                peerId: msg.peerId,
                senderName: msg.peerId === peerId ? 'You' : msg.peerId.substring(0, 8),
                text,
                timestamp: msg.timestamp
              });
            } catch (err) {
              // message decryption failed (skip or flag)
            }
          }
          set({ messages: decryptedMessages });

        } catch (err) {
          console.error("Complete key exchange failure:", err);
          useUIStore.getState().showToast({
            type: 'error',
            title: 'E2EE Key Exchange Failed',
            message: 'A secure peer-to-peer key exchange failed.',
          });
        }
      });

      // Presence and direct messaging
      client.on('presence', ({ from, status }) => {
        set((s) => {
          const updatedPeers = new Map(s.peers);
          const peer = updatedPeers.get(from);
          if (peer) {
            peer.presence = status as any;
          }
          return { peers: updatedPeers };
        });
      });

      client.connect();
      set({ signaling: client });
    },

    disconnectRoom: () => {
      const { signaling, peers } = get();
      if (signaling) signaling.disconnect();
      peers.forEach((p) => p.pcManager?.close());
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
        activeTransfers: new Map(),
      });
    },

    sendChatMessage: async (text) => {
      const { roomId, peerId, peers } = get();
      if (!roomId || !peerId || peers.size === 0) return;

      const timestamp = Date.now();
      const messageId = window.crypto.randomUUID();

      // Prepend chat bubble locally
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: messageId,
            peerId: peerId,
            senderName: 'You',
            text,
            timestamp,
          }
        ]
      }));

      // Broadcast encrypted message to each connected peer over derived room keys
      peers.forEach(async (peer, remoteId) => {
        if (peer.roomKey && peer.pcManager?.controlChannel?.readyState === 'open') {
          try {
            const enc = await encryptText(peer.roomKey, text);
            
            // Save encrypted copy to local IndexDB cache for history
            await saveMessage({
              roomId,
              peerId,
              encryptedText: enc.ciphertext, // or payload combined
              timestamp,
            });

            peer.pcManager.controlChannel.send(JSON.stringify({
              type: 'chat',
              text: enc.ciphertext,
              iv: enc.iv,
            }));
          } catch (err) {
            // failed encryption
          }
        }
      });
    },

    // Room controls (Owner only)
    lockRoom: async () => {
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
          message: 'No new members can join this chamber.',
        });
      }
    },

    unlockRoom: async () => {
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
          title: 'Chamber Destroyed',
          message: 'Ephemeral credentials cleared. All secure metadata deleted.',
        });
        window.location.href = '/';
      }
    },

    // P2P Transfer coordinator bridge
    initiateFileTransfer: async (peerId, file) => {
      const peer = get().peers.get(peerId);
      if (!peer || !peer.transferCoordinator) {
        throw new Error('Peer not fully connected (secure channel pending)');
      }

      const tid = await peer.transferCoordinator.sendFile(file);
      
      set((s) => {
        const updatedTransfers = new Map(s.activeTransfers);
        updatedTransfers.set(tid, {
          fileName: file.name,
          sizeBytes: file.size,
          fileType: file.type,
          direction: 'outgoing',
          progress: 0,
          speedBytesPerSec: 0,
          etaSec: 0,
          status: 'pending',
        });
        return { activeTransfers: updatedTransfers };
      });

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
    }
  };
});
