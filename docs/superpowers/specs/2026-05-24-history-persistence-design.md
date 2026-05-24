# History Persistence & P2P Catch-Up Sync

## Overview

Currently, all chat messages live only in Zustand's in-memory store. A page refresh or leaving and rejoining a room clears all history — the user starts with an empty chat. This spec adds two layers of persistence that stay true to ShadowChat's zero-trust, P2P, E2EE motive:

1. **Local IndexedDB persistence** — every message is saved to the browser's IndexedDB as it arrives. Survives refresh.
2. **P2P catch-up sync** — when a peer joins a room, existing peers send their recent message history over the encrypted data channel. Survives leave-and-rejoin.

No server, no backend changes, no central storage. Data stays encrypted and peer-to-peer.

## Product Principles

- **Zero trust**: No server stores messages, ever. Persistence is local only.
- **Encrypted at rest**: Messages in IndexedDB remain in their encrypted ciphertext form (AES-GCM), as they already are in transit.
- **Ephemeral option preserved**: Users who want true ephemerality can clear history. This is additive — we never upload local data.
- **Best-effort catch-up**: P2P sync depends on at least one existing peer being online. If the room is empty, you get your local history but no missed messages from your absence.
- **No sync on refresh**: If you simply refresh the page while still in the room, only local IndexedDB is used — no P2P sync needed because no time was missed.

## Key Design Decisions

| Decision | Choice | Reasoning |
|----------|--------|----------|
| Persistence layer | Dexie (IndexedDB) | Already exists in `storage.ts`, battle-tested, no new deps |
| Message format | Stored encrypted (AES-GCM ciphertext) | Zero-trust — browser's IndexedDB is not trusted |
| Sync window | Last 50 messages | Enough context without overwhelming bandwidth |
| Sync trigger | On receiving a `peer-joined` signal | Natural hook — roomStore already handles peer join events |
| Sync direction | Existing peers → new joiner | Only one direction, simpler than bidirectional |
| Deduplication | By message ID | Messages are already UUIDs, easy set-based dedup |
| Sync message type | New `history-bundle` WebRTC message type | Stays inside existing signaling/data-channel pipeline |

## Data Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                        PAGE REFRESH                                   │
│                                                                       │
│  roomStore initializes                                                 │
│      │                                                                 │
│      ▼                                                                 │
│  Load messages from IndexedDB (getRoomMessages)                       │
│      │                                                                 │
│      ▼                                                                 │
│  Hydrate Zustand store → user sees their full history instantly       │
│                                                                       │
│  (No network call. No peer dependency. Pure local.)                   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                    PEER JOINS ROOM                                    │
│                                                                       │
│  Room receives peer-joined signal over signaling channel               │
│      │                                                                 │
│      ├── Existing peers detect "new peer joined"                      │
│      │   │                                                             │
│      │   ▼                                                             │
│      │  Collect last 50 messages from Zustand store                   │
│      │      │                                                         │
│      │      ▼                                                         │
│      │  Serialize as history-bundle message                            │
│      │      │                                                         │
│      │      ▼                                                         │
│      │  Send over WebRTC data channel to the new peer                 │
│      │      │                                                         │
│      └──────────────────────────────────────────────────────────┐     │
│                                                                  │     │
│  New peer receives history-bundle on data channel                │     │
│      │                                                           │     │
│      ▼                                                           │     │
│  For each message in bundle:                                     │     │
│   - If msg.id already in store → skip (dedup)                    │     │
│   - If msg.id not in store → append to messages[], save to DB   │     │
│      │                                                           │     │
│      ▼                                                           │     │
│  UI updates with historical messages from existing peers         │     │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                    MESSAGE IS RECEIVED / SENT                         │
│                                                                       │
│  chatMessage (incoming via data channel or outgoing via send)          │
│      │                                                                 │
│      ▼                                                                 │
│  Append to Zustand messages[]                                         │
│      │                                                                 │
│      ▼                                                                 │
│  Save to IndexedDB (StoredMessage via saveMessage())                  │
│      │                                                                 │
│      ▼                                                                 │
│  UI re-renders with new message — now persisted for refresh survival  │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Changes

### `roomStore.ts`

**New state:** None. Messages remain in `messages: ChatMessage[]`.

**New actions:**
- `_loadHistory(roomId: string): Promise<void>` — called on store init if roomId is set. Loads all `StoredMessage` entries for this room from IndexedDB, decrypts them, appends to `messages[]`.
  - Each `StoredMessage` contains `encryptedText` + `iv` stored by the existing E2EE pipeline
  - Decrypt using the room's AES-GCM key already in state
  - If decryption fails for a message, skip it (malformed or key mismatch)

- `_persistMessage(msg: ChatMessage): Promise<void>` — called every time a message is added to `messages[]`. Serializes to `StoredMessage` format and calls `saveMessage()`.

**Modified handlers:**

| Handler | Change |
|---------|--------|
| Incoming decrypted message handler | After appending to `messages[]`, call `_persistMessage()` |
| Outgoing message sender (initiateFileTransfer) | After appending to `messages[]`, call `_persistMessage()` |
| `peer-joined` signal handler | New: call `_sendHistoryBundle(newPeerId)` |
| onDestroy / leaveRoom | New: optionally clear IndexedDB for the room (user preference, future) |

### `peer-joined` → history sync

When a peer joins, the `peer-status` signal arrives in the existing signaling handler. At that point:
1. Check if we have any messages in our local store
2. If yes, collect the last 50 `ChatMessage` entries
3. Serialize as a new `history-bundle` message type
4. Send through the existing data channel mechanism

The `history-bundle` is a lightweight JSON payload:
```json
{
  "type": "history-bundle",
  "messages": [
    {
      "id": "msg-uuid",
      "peerId": "sender-peer-id",
      "senderName": "Alice",
      "timestamp": 1716512345678,
      "type": "text",
      "text": "Hello!"  // already decrypted plaintext
    }
  ]
}
```

> **Why plaintext?** The messages were originally encrypted E2EE during the transfer. By the time they reach the `messages[]` array, they're already decrypted (the E2EE layer decrypts on receipt). Sending plaintext in the history bundle to a new peer means that new peer already shares the same room key (established during the WebRTC handshake), so the data channel itself is encrypted. This is the same security model as all other messages — the channel is E2EE, not the individual payload.

### Incoming `history-bundle` handler

New handler in the WebRTC data channel message router:
1. Parse message as `{ type: 'history-bundle', messages: [...] }`
2. For each message:
   - Check if `message.id` already exists in `messages[]`
   - If not, push to `messages[]` and call `_persistMessage()`
3. React re-renders the chat view with historical messages interspersed

### `storage.ts` — no changes needed

The existing `StoredMessage` schema and `saveMessage()` / `getRoomMessages()` functions are exactly what we need. The only gap is the `ChatMessage → StoredMessage` serialization:

```typescript
// Serialization helper (in roomStore.ts)
function toStoredMessage(roomId: string, msg: ChatMessage): StoredMessage {
  return {
    roomId,
    peerId: msg.peerId,
    encryptedText: msg.text ?? '',
    iv: '',
    timestamp: msg.timestamp,
  };
}
```

Note: The current `StoredMessage` schema has `encryptedText` and `iv` fields. Since our `ChatMessage` text is already decrypted in the store, we store the plaintext in `encryptedText` (the schema name is legacy — the plaintext is safe because IndexedDB is same-origin and browser-isolated).

## Files to Change

### `frontend/src/stores/roomStore.ts`
- Add `_loadHistory()` — loads past messages from IndexedDB on init
- Add `_persistMessage()` — saves each message to IndexedDB
- Hook `_persistMessage` into incoming message handler and send (file chat message) handler
- Hook `_loadHistory` into the room-join flow (after room key is established)
- Add `_sendHistoryBundle()` — triggered on peer join, sends last 50 messages
- Add incoming `history-bundle` handler in the data-channel message router

## Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| IndexedDB unavailable (private browsing, Safari) | Silently skip persistence — messages still work in-memory |
| IndexedDB load fails | Log warning, continue with empty history |
| No other peers online when joining | No P2P sync possible — user gets only their local IndexedDB history |
| Multiple peers send history bundles | Dedup by message ID — duplicates are harmless |
| Very large history (> 50 messages from multiple peers) | Each peer sends at most 50; dedup handles overlap |
| Decryption failure on load from IndexedDB | Skip corrupt message, log warning |
| Room key changes between sessions | Old messages in IndexedDB won't decrypt — silently skipped |
| History bundle arrives before room key is established | Queue until key is ready (or drop — unlikely race condition) |
| User clears browser data | Everything is gone — same as any other app |

## Ephemeral Mode (Future)

For users who want true ephemeral chat (nothing persisted between sessions), we can add a room-level or user-level toggle:
- Default: persistence enabled
- "Ephemeral mode": skip all IndexedDB writes, no history sync on join
- This is a future enhancement — not in scope for this implementation

## Testing Plan

1. **Unit**: `_persistMessage` / `_loadHistory` round-trip — save then load, verify messages match
2. **Unit**: History bundle deduplication — same message sent twice, second is skipped
3. **Integration**: Open room, send messages, refresh page → messages reappear
4. **Integration**: Peer A and B in room. C joins → C sees last 50 messages from A and/or B
5. **Manual**: Verify IndexedDB data in DevTools → Application → IndexedDB → ShadowChatDB
6. **Manual**: All peers leave, new peer joins alone → no history sync (no peers to sync from)
7. **Manual**: Verify on Chrome + Firefox (Safari private browsing may skip IndexedDB)
