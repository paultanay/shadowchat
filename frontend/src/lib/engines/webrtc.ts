/**
 * WebRTC RTCPeerConnection Manager.
 * Orchestrates connection setup, ICE trickling, and parallel data channels.
 */

import { SignalingClient } from './signaling';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

export interface WebRTCEvents {
  onStateChange: (state: ConnectionState) => void;
  onMessage: (label: string, data: ArrayBuffer | string) => void;
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

  public async initialize(): Promise<void> {
    const config: RTCConfiguration = {
      iceServers: this.iceServers,
      iceCandidatePoolSize: 10,
    };

    this.pc = new RTCPeerConnection(config);

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
      this.events.onStateChange(state);
    };

    if (this.isInitiator) {
      // 1. Create Control channel (reliable + ordered)
      this.setupControlChannel(this.pc.createDataChannel('control', { ordered: true }));

      // 2. Create parallel data channels for file chunking (normally 4 channels)
      const parallelChannelsCount = 4;
      for (let i = 0; i < parallelChannelsCount; i++) {
        const label = `data-${i}`;
        const dc = this.pc.createDataChannel(label, { ordered: true });
        this.setupDataChannel(dc);
      }

      // 3. Initiate SDP offer
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
  }

  public async handleOffer(sdp: string): Promise<void> {
    if (!this.pc) {
      console.warn(`[PeerConnectionManager] Cannot handle SDP offer, RTCPeerConnection is null for peer: ${this.peerId}`);
      return;
    }
    
    console.log(`[PeerConnectionManager] Handling inbound SDP Offer from peer ${this.peerId}. Current signalingState: ${this.pc.signalingState}`);
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
      console.log(`[PeerConnectionManager] SetRemoteDescription (Offer) successful. Creating answer...`);
      const answer = await this.pc.createAnswer();
      console.log(`[PeerConnectionManager] Created SDP Answer. Setting local description...`);
      await this.pc.setLocalDescription(answer);
      console.log(`[PeerConnectionManager] SetLocalDescription (Answer) successful. Relaying SDP Answer via signaling...`);

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
    
    console.log(`[PeerConnectionManager] Handling inbound SDP Answer from peer ${this.peerId}. Current signalingState: ${this.pc.signalingState}`);
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp }));
      console.log(`[PeerConnectionManager] SetRemoteDescription (Answer) successful for peer: ${this.peerId}`);
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
    
    console.log(`[PeerConnectionManager] Applying ICE Candidate from peer ${this.peerId}...`);
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      console.log(`[PeerConnectionManager] Successfully applied ICE Candidate for peer ${this.peerId}`);
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
    dc.onmessage = (event) => {
      this.events.onMessage(dc.label, event.data);
    };
  }

  private setupDataChannel(dc: RTCDataChannel): void {
    dc.binaryType = 'arraybuffer';
    this.dataChannels.set(dc.label, dc);
    
    dc.onmessage = (event) => {
      this.events.onMessage(dc.label, event.data);
    };

    dc.onerror = () => {
      // data channel transfer failed
    };
  }
}
