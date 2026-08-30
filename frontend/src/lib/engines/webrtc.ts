/**
 * WebRTC RTCPeerConnection Manager.
 * Orchestrates connection setup, ICE trickling, and parallel data channels.
 */

import { SignalingClient } from './signaling';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface WebRTCEvents {
  onStateChange: (state: ConnectionState) => void;
  onMessage: (label: string, data: ArrayBuffer | string) => void;
  onControlChannelOpen?: () => void;
}

export class PeerConnectionManager {
  public pc: RTCPeerConnection | null = null;
  public controlChannel: RTCDataChannel | null = null;
  public dataChannels: Map<string, RTCDataChannel> = new Map();
  
  private peerId: string;
  private roomId: string;
  private isInitiator: boolean;
  private iceServers: RTCIceServer[];
  private signaling: SignalingClient;
  private events: WebRTCEvents;
  private restartCount = 0;
  private readonly MAX_RESTARTS = 3;
  private pendingOffer = false;

  constructor(
    peerId: string,
    roomId: string,
    isInitiator: boolean,
    iceServers: RTCIceServer[],
    signaling: SignalingClient,
    events: WebRTCEvents
  ) {
    this.peerId = peerId;
    this.roomId = roomId;
    this.isInitiator = isInitiator;
    this.iceServers = iceServers;
    this.signaling = signaling;
    this.events = events;
  }

  private async waitForIceGathering(): Promise<void> {
    if (!this.pc || this.pc.iceGatheringState === 'complete') return;
    await new Promise<void>((resolve) => {
      const handler = () => {
        if (this.pc && this.pc.iceGatheringState === 'complete') {
          // Clean up listener immediately to prevent leaks on closed connections.
          this.pc.onicegatheringstatechange = null;
          resolve();
        }
      };
      this.pc!.onicegatheringstatechange = handler;
    });
  }

  public async initialize(): Promise<void> {
    const config: RTCConfiguration = {
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10,
    };

    try {
      this.pc = new RTCPeerConnection(config);
    } catch (err) {
      console.warn('[PeerConnectionManager] Failed to construct RTCPeerConnection with custom iceServers, falling back to public STUN:', err);
      this.pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
    }

    // Track ICE gathering
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.send('ice', this.roomId, this.peerId, {
          candidate: event.candidate,
        });
      }
    };

    // Connection state monitoring
    this.pc.onconnectionstatechange = () => {
      if (!this.pc) return;
      const state = this.pc.connectionState as ConnectionState;
      console.log('[PeerConnectionManager] Connection state:', state, 'for peer:', this.peerId);
      this.events.onStateChange(state);
    };

    if (this.isInitiator) {
      // Disable onnegotiationneeded during channel setup. Chromium fires it
      // synchronously when createDataChannel() is called, which would trigger
      // a duplicate offer before the receiver even has a PeerConnection.
      this.pc.onnegotiationneeded = null;

      // 1. Create Control channel (reliable + ordered)
      this.setupControlChannel(this.pc.createDataChannel('control', { ordered: true }));

      // 2. Create parallel data channels for file chunking (4 parallel lanes)
      const parallelChannelsCount = 4;
      for (let i = 0; i < parallelChannelsCount; i++) {
        const label = `data-${i}`;
        const dc = this.pc.createDataChannel(label, { ordered: true });
        this.setupDataChannel(dc);
      }

      // 3. Initiate SDP offer after all channels are registered.
      //    ICE candidates trickle asynchronously via onicecandidate.
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.signaling.send('offer', this.roomId, this.peerId, {
        sdp: offer.sdp,
      });
    } else {
      // Receiver hooks inbound data channels
      this.pc.ondatachannel = (event) => {
        const dc = event.channel;
        if (dc.label === 'control') {
          this.setupControlChannel(dc);
        } else if (dc.label.startsWith('data-')) {
          this.setupDataChannel(dc);
        }
      };
    }

    // Re-enable negotiationneeded AFTER the initial setup is complete.
    // This handles ICE restarts and any future re-negotiation needs.
    this.pc.onnegotiationneeded = async () => {
      if (!this.pc || this.pendingOffer || this.restartCount >= this.MAX_RESTARTS) return;
      this.pendingOffer = true;
      try {
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.signaling.send('offer', this.roomId, this.peerId, {
          sdp: offer.sdp,
        });
        this.restartCount++;
      } finally {
        this.pendingOffer = false;
      }
    };
  }

  public async handleOffer(sdp: string): Promise<void> {
    if (!this.pc) {
      console.warn(`[PeerConnectionManager] Cannot handle SDP offer, RTCPeerConnection is null for peer: ${this.peerId}`);
      return;
    }
    
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      this.signaling.send('answer', this.roomId, this.peerId, {
        sdp: answer.sdp,
      });
    } catch (err) {
      console.error(`[PeerConnectionManager] Error during handleOffer for peer ${this.peerId}:`, err);
      throw err;
    }
  }

  public async handleAnswer(sdp: string): Promise<void> {
    if (!this.pc) {
      console.warn(`[PeerConnectionManager] Cannot handle SDP answer, RTCPeerConnection is null for peer: ${this.peerId}`);
      return;
    }
    
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
    } catch (err) {
      console.error(`[PeerConnectionManager] Error during handleAnswer for peer ${this.peerId}:`, err);
      throw err;
    }
  }

  public async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) {
      console.warn(`[PeerConnectionManager] Cannot add ICE candidate, RTCPeerConnection is null for peer: ${this.peerId}`);
      return;
    }
    
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn(`[PeerConnectionManager] Ignored/failed ICE candidate for peer ${this.peerId}:`, err);
    }
  }

  public close(): void {
    if (this.controlChannel) {
      this.controlChannel.close();
      this.controlChannel = null;
    }
    this.dataChannels.forEach((dc) => dc.close());
    this.dataChannels.clear();
    
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
  }

  private setupControlChannel(dc: RTCDataChannel): void {
    this.controlChannel = dc;
    const handleOpen = () => {
      console.log('[PeerConnectionManager] Control channel OPENED for peer:', this.peerId);
      this.events.onControlChannelOpen?.();
    };
    dc.onopen = handleOpen;
    if (dc.readyState === 'open') {
      handleOpen();
    }
    dc.onclose = () => {
      console.log('[PeerConnectionManager] Control channel CLOSED for peer:', this.peerId);
    };
    dc.onmessage = (event) => {
      this.events.onMessage(dc.label, event.data);
    };
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';
    this.dataChannels.set(dc.label, dc);
    dc.onopen = () => {
      console.log('[PeerConnectionManager] Data channel OPENED:', dc.label, 'for peer:', this.peerId);
    };
    dc.onclose = () => {
      console.log('[PeerConnectionManager] Data channel CLOSED:', dc.label, 'for peer:', this.peerId);
    };
    dc.onmessage = (event) => {
      this.events.onMessage(dc.label, event.data);
    };

    dc.onerror = (err) => {
      console.error(`[PeerConnectionManager] Data channel '${dc.label}' error:`, err);
    };
  }
}
