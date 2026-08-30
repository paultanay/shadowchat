/**
 * WebSocket signaling client.
 *
 * Security note: the JWT is transmitted only in the URL query string during
 * the initial HTTP → WebSocket upgrade handshake (standard browser WS API
 * limitation — custom headers are not supported). The URL is never stored
 * in browser history for WebSocket connections. After the upgrade the token
 * is not referenced again. The server validates it once on upgrade and then
 * uses the embedded peer/room claims for the lifetime of the socket.
 */

export type SignalingEventMap = {
  connect: () => void;
  disconnect: () => void;
  "peer-joined": (data: { peerId: string; peerCount: number }) => void;
  "peer-left": (data: { peerId: string; peerCount: number }) => void;
  "room-state": (data: { peers: string[]; peerCount: number }) => void;
  offer: (data: { from: string; sdp: string }) => void;
  answer: (data: { from: string; sdp: string }) => void;
  ice: (data: { from: string; candidate: RTCIceCandidateInit }) => void;
  "key-exchange": (data: { from: string; payload: string }) => void;
  presence: (data: { from: string; status: string }) => void;
  error: (data: { code: number; message: string }) => void;
};

type EventName = keyof SignalingEventMap;
type EventCallback<T extends EventName> = SignalingEventMap[T];

// A queued outbound message, stored as a plain object so it can be
// re-serialised after reconnect without stale state.
interface QueuedMessage {
  type: string;
  room: string;
  target?: string;
  extra: Record<string, unknown>;
}

export class SignalingClient {
  private socket: WebSocket | null = null;
  private readonly wsUrl: string;
  private listeners: { [key in EventName]?: ((...args: unknown[]) => void)[] } =
    {};
  private sendQueue: QueuedMessage[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly baseDelay = 1000;
  private isDisconnecting = false;
  private lastPongTime = Date.now();

  constructor(roomId: string, token: string) {
    let wsBase = "";

    if (typeof window !== "undefined") {
      const host = window.location.host;
      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        // Use the API port from environment or default to 8081 for local dev
        const apiPort = process.env.NEXT_PUBLIC_API_PORT ?? "8081";
        wsBase = `${wsProtocol}//${window.location.hostname}:${apiPort}/ws`;
      } else {
        wsBase = `${wsProtocol}//${host}/ws`;
      }
    }

    if (!wsBase) {
      wsBase = process.env.NEXT_PUBLIC_SIGNALING_URL ?? "";
    }

    if (!wsBase) {
      throw new Error(
        "NEXT_PUBLIC_SIGNALING_URL must be set for production deployment",
      );
    }

    // Token is passed in the query string — the only mechanism available for
    // WebSocket upgrade auth in browsers. The server validates it immediately
    // on upgrade and never logs the raw URL.
    this.wsUrl = `${wsBase}?room=${encodeURIComponent(roomId)}&token=${encodeURIComponent(token)}`;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket) {
        resolve();
        return;
      }
      this.isDisconnecting = false;

      const onConnect = () => {
        this.off("connect", onConnect);
        this.off("error", onError);
        resolve();
      };
      const onError = () => {
        this.off("connect", onConnect);
        this.off("error", onError);
        reject(new Error("WebSocket connection failed"));
      };

      this.on("connect", onConnect);
      this.on("error", onError);

      const authTimeout = setTimeout(() => {
        this.off("connect", onConnect);
        this.off("error", onError);
        reject(new Error("WebSocket auth timeout"));
      }, 10_000);

      try {
        this.socket = new WebSocket(this.wsUrl);
        this.socket.binaryType = "arraybuffer";

        this.socket.onopen = () => {
          clearTimeout(authTimeout);
          this.lastPongTime = Date.now();
          console.log('[SignalingClient] WebSocket connected, sending auth');
          // The server already validated the token from the query string during
          // upgrade. Send an auth message so the hub emits room-state back.
          this.socket!.send(JSON.stringify({ type: "auth" }));
        };

        this.socket.onclose = () => {
          this.stopHeartbeat();
          this.socket = null;
          this.trigger("disconnect", undefined);
          this.scheduleReconnect();
        };

        this.socket.onerror = () => {
          // onclose fires after onerror — let it handle cleanup.
        };

        this.socket.onmessage = (event: MessageEvent) => {
          const raw = typeof event.data === "string" ? event.data : "";
          const lines = raw.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              console.log('[SignalingClient] Received:', msg.type);
              this.handleMessage(msg);
            } catch {
              // Malformed JSON — discard silently.
            }
          }
        };
      } catch (err) {
        clearTimeout(authTimeout);
        this.socket = null;
        reject(err);
      }
    });
  }

  disconnect(): void {
    this.isDisconnecting = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  destroy(): void {
    this.isDisconnecting = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.listeners = {} as typeof this.listeners;
    this.sendQueue = [];
    this.socket?.close();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (
      this.isDisconnecting ||
      this.reconnectAttempts >= this.maxReconnectAttempts
    )
      return;
    const delay = Math.min(
      15_000,
      this.baseDelay * 2 ** this.reconnectAttempts,
    );
    const jitter = delay * (0.5 + Math.random() * 0.5);
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch(() => {
        // scheduleReconnect will be called again from onclose.
      });
    }, jitter);
  }

  /**
   * Enqueue or immediately send a signaling message.
   * Messages are stored as structured objects so they can be safely
   * re-serialised after a reconnect rather than replaying a stale string.
   */
  send(
    type: string,
    room: string,
    target?: string,
    extra: Record<string, unknown> = {},
  ): void {
    console.log('[SignalingClient] Sending:', type, target ? `-> ${target}` : '');
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, room, target, ...extra }));
    } else if (this.sendQueue.length < 500) {
      this.sendQueue.push({ type, room, target, extra });
    }
  }

  on<T extends EventName>(event: T, callback: EventCallback<T>): void {
    if (!this.listeners[event]) this.listeners[event] = [];
    (this.listeners[event] as ((...args: unknown[]) => void)[]).push(
      callback as (...args: unknown[]) => void,
    );
  }

  off<T extends EventName>(event: T, callback: EventCallback<T>): void {
    if (!this.listeners[event]) return;
    this.listeners[event] = (
      this.listeners[event] as ((...args: unknown[]) => void)[]
    ).filter((cb) => cb !== (callback as (...args: unknown[]) => void));
  }

  private trigger<T extends EventName>(event: T, data: unknown): void {
    (this.listeners[event] ?? []).forEach((cb) => cb(data));
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "auth":
        if (msg.success) {
          this.reconnectAttempts = 0;
          this.trigger("connect", undefined);
          this.startHeartbeat();
          this.flushQueue();
        } else {
          this.socket?.close();
        }
        break;
      case "peer-joined":
        this.trigger("peer-joined", {
          peerId: msg.peerId,
          peerCount: msg.peerCount,
        });
        break;
      case "peer-left":
        this.trigger("peer-left", {
          peerId: msg.peerId,
          peerCount: msg.peerCount,
        });
        break;
      case "room-state":
        this.trigger("room-state", {
          peers: msg.peers ?? [],
          peerCount: msg.peerCount,
        });
        break;
      case "offer":
        this.trigger("offer", { from: msg.from, sdp: msg.sdp });
        break;
      case "answer":
        this.trigger("answer", { from: msg.from, sdp: msg.sdp });
        break;
      case "ice":
        this.trigger("ice", { from: msg.from, candidate: msg.candidate });
        break;
      case "key-exchange":
        this.trigger("key-exchange", { from: msg.from, payload: msg.payload });
        break;
      case "presence":
        this.trigger("presence", { from: msg.from, status: msg.status });
        break;
      case "error":
        this.trigger("error", { code: msg.code, message: msg.message });
        break;
      case "pong":
        this.lastPongTime = Date.now();
        break;
    }
  }

  private startHeartbeat(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastPongTime > 35_000) {
        this.socket?.close();
        this.socket = null;
        this.scheduleReconnect();
        return;
      }
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "ping" }));
      }
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = undefined;
    }
  }

  private flushQueue(): void {
    while (
      this.sendQueue.length > 0 &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      const { type, room, target, extra } = this.sendQueue.shift()!;
      this.socket.send(JSON.stringify({ type, room, target, ...extra }));
    }
  }
}
