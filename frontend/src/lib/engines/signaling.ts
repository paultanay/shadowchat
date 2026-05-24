/**
 * WebSocket Signaling Client for P2P coordination and heartbeat loops.
 */

export type SignalingEventMap = {
  'connect': () => void;
  'disconnect': () => void;
  'peer-joined': (data: { peerId: string; peerCount: number }) => void;
  'peer-left': (data: { peerId: string; peerCount: number }) => void;
  'room-state': (data: { peers: string[]; peerCount: number }) => void;
  'offer': (data: { from: string; sdp: string }) => void;
  'answer': (data: { from: string; sdp: string }) => void;
  'ice': (data: { from: string; candidate: any }) => void;
  'key-exchange': (data: { from: string; payload: string }) => void;
  'presence': (data: { from: string; status: string }) => void;
  'error': (data: { code: number; message: string }) => void;
};

type EventName = keyof SignalingEventMap;
type EventCallback<T extends EventName> = SignalingEventMap[T];

export class SignalingClient {
  private socket: WebSocket | null = null;
  private url: string;
  private listeners: { [key in EventName]?: any[] } = {};
  private sendQueue: string[] = [];
  private reconnectTimer: any = null;
  private pingTimer: any = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private baseDelay = 1000; // 1s
  private isDisconnecting = false;

  constructor(roomId: string, token: string) {
    // Determine signaling WebSocket URL (support relative and absolute configs dynamically)
    let wsBase = '';
    
    if (typeof window !== 'undefined') {
      const host = window.location.host;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      if (host.includes('localhost') || host.includes('127.0.0.1') || host.includes('shadowchat.local')) {
        if (host.includes(':3000') || host.includes(':3001')) {
          wsBase = `${wsProtocol}//${window.location.hostname}:8080/ws`;
        } else {
          wsBase = `${wsProtocol}//${host}/ws`;
        }
      }
    }
    
    if (!wsBase) {
      wsBase = process.env.NEXT_PUBLIC_WS_URL || 'wss://api.shadowchat.local/ws';
    }
    
    this.url = `${wsBase}?room=${roomId}&token=${token}`;
  }

  public connect(): void {
    if (this.socket) return;
    this.isDisconnecting = false;

    try {
      this.socket = new WebSocket(this.url);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.trigger('connect', undefined);
        this.startHeartbeat();
        this.flushQueue();
      };

      this.socket.onclose = () => {
        this.stopHeartbeat();
        this.socket = null;
        this.trigger('disconnect', undefined);

        if (!this.isDisconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = Math.min(15000, this.baseDelay * Math.pow(2, this.reconnectAttempts));
          this.reconnectAttempts++;
          this.reconnectTimer = setTimeout(() => this.connect(), delay);
        }
      };

      this.socket.onerror = () => {
        // ws close will trigger reconnect logic
      };

this.socket.onmessage = (event) => {
  const lines = event.data.split('\n').filter(Boolean);
  for (const line of lines) {
    let data: any;
    try {
      data = JSON.parse(line);
    } catch (err) {
      console.error('[Signaling] Invalid JSON line:', line, err);
      continue;
    }
    try {
      this.handleMessage(data);
    } catch (err) {
      console.error('[Signaling] Handler error:', data, err);
    }
  }
};
    } catch (err) {
      // socket init error
    }
  }

  public disconnect(): void {
    this.isDisconnecting = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  public send(type: string, room: string, target?: string, extra: Record<string, any> = {}): void {
    const payload = JSON.stringify({
      type,
      room,
      target,
      ...extra,
    });

    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else {
      this.sendQueue.push(payload);
    }
  }

  public on<T extends EventName>(event: T, callback: EventCallback<T>): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(callback);
  }

  public off<T extends EventName>(event: T, callback: EventCallback<T>): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event]!.filter((cb) => cb !== callback);
  }

  private trigger<T extends EventName>(event: T, data: any): void {
    const list = this.listeners[event];
    if (list) {
      list.forEach((cb) => cb(data));
    }
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'peer-joined':
        this.trigger('peer-joined', { peerId: msg.peerId, peerCount: msg.peerCount });
        break;
      case 'peer-left':
        this.trigger('peer-left', { peerId: msg.peerId, peerCount: msg.peerCount });
        break;
      case 'room-state':
        this.trigger('room-state', { peers: msg.peers || [], peerCount: msg.peerCount });
        break;
      case 'offer':
        this.trigger('offer', { from: msg.from, sdp: msg.sdp });
        break;
      case 'answer':
        this.trigger('answer', { from: msg.from, sdp: msg.sdp });
        break;
      case 'ice':
        this.trigger('ice', { from: msg.from, candidate: msg.candidate });
        break;
      case 'key-exchange':
        this.trigger('key-exchange', { from: msg.from, payload: msg.payload });
        break;
      case 'presence':
        this.trigger('presence', { from: msg.from, status: msg.status });
        break;
      case 'error':
        this.trigger('error', { code: msg.code, message: msg.message });
        break;
      case 'pong':
        // received ping response, keepalive validated
        break;
    }
  }

  private startHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000); // 30s ping period
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private flushQueue(): void {
    while (this.sendQueue.length > 0 && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(this.sendQueue.shift()!);
    }
  }
}
