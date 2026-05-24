# History Persistence & P2P Catch-Up Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire IndexedDB message persistence fully (including file messages) and add P2P history sync so messages survive refresh and new joiners see recent history.

**Architecture:** All changes are in `roomStore.ts`. The Dexie/IndexedDB layer (`storage.ts`) is already complete — we just need to hook outgoing/incoming file messages into `saveMessage()`, move history loading from the per-peer key-exchange handler to room-init, and add a `history-bundle` message type sent/received over the existing WebRTC data channel.

**Tech Stack:** Zustand, Dexie/IndexedDB, WebRTC data channels

---

### Task 1: Persist outgoing file messages to IndexedDB

**Files:**
- Modify: `frontend/src/stores/roomStore.ts:882-892`

The `initiateFileTransfer` action creates a `fileMsg` `ChatMessage` and pushes it to `messages[]` but never saves it to IndexedDB. It needs to call `saveMessage()`.

- [ ] **Step 1: Add persistence call after file message creation**

In `initiateFileTransfer`, after `set()` that appends the file message (the return block at line 894), add the `saveMessage` call:

```typescript
        return { 
          activeTransfers: updatedTransfers,
          messages: [...s.messages, fileMsg]
        };
      });

      // Persist the file notification message
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

      return tid;
```

> **Why store metadata as JSON in `encryptedText`?** The `ChatMessage` for files has no `text` field, only metadata fields (`fileName`, `fileSize`, `fileType`). We serialize these as JSON so on reload they can be reconstructed. The `iv` is empty because this is metadata, not actual encrypted content (the file transfer pipeline already handles E2EE separately).

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/roomStore.ts
git commit -m "fix: persist outgoing file messages to IndexedDB"
```

---

### Task 2: Persist incoming file messages to IndexedDB

**Files:**
- Modify: `frontend/src/stores/roomStore.ts:611-625`

The `onIncomingTransfer` callback creates a `fileMsg` `ChatMessage` and pushes it to `messages[]` but never saves it to IndexedDB.

- [ ] **Step 1: Add persistence after file message is added to store**

In `onIncomingTransfer`, after the `set()` that adds the file message (the return block at line 624), add the `saveMessage` call:

```typescript
                        return { 
                          activeTransfers: updatedTransfers,
                          messages: [...s.messages, fileMsg]
                        };
                      });

                      // Persist the incoming file notification
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
```

Note: The `set` above is inside a `set((s) => { ... })` call. The `saveMessage` is added after it, outside the set callback.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/roomStore.ts
git commit -m "fix: persist incoming file messages to IndexedDB"
```

---

### Task 3: Move history loading from key-exchange to room initialization

**Files:**
- Modify: `frontend/src/stores/roomStore.ts:675-692` (remove from key-exchange)
- Modify: `frontend/src/stores/roomStore.ts:429-726` (`connectSignaling`)

Currently, history loads from IndexedDB inside the per-peer `key-exchange` handler (lines 675-692). This means:
1. History doesn't appear until the first peer completes key exchange
2. If multiple peers exchange keys, all attempt to load history simultaneously, overwriting each other
3. If there are no peers, history never loads

Fix: Load history once at the start of `connectSignaling`, right after the room state is set and keys are generated (but before peers connect). Then remove it from the key-exchange handler.

- [ ] **Step 1: Add history loading to connectSignaling**

In `connectSignaling`, after the `set()` that establishes keys and before the signaling client setup, load history from IndexedDB:

```typescript
        set({
          roomId: roomId,
          token: token,
          roomRole: role,
          peerId: activePeerId,
          localX25519Pair: x25519Pair,
          localEd25519Pair: ed25519Pair,
          signalingState: 'connecting',
        });

        // Load persisted messages from IndexedDB
        const cachedMessages = await getRoomMessages(roomId);
        const decryptedMessages: ChatMessage[] = [];
        for (const msg of cachedMessages) {
          try {
            let text: string | undefined;
            let type: 'text' | 'file' = 'text';
            let fileName: string | undefined;
            let fileSize: number | undefined;
            let fileType: string | undefined;

            if (msg.iv) {
              // Encrypted text message
              if (!derivedRoomKey) continue;
              text = await decryptText(derivedRoomKey, msg.encryptedText, msg.iv);
            } else {
              // File metadata stored as JSON
              try {
                const meta = JSON.parse(msg.encryptedText);
                type = 'file';
                fileName = meta.name;
                fileSize = meta.size;
                fileType = meta.type;
                text = undefined; // file messages have no text
              } catch {
                // Stored as plaintext (legacy or non-encrypted)
                text = msg.encryptedText;
              }
            }

            decryptedMessages.push({
              id: String(msg.id ?? msg.timestamp),
              peerId: msg.peerId,
              senderName: msg.peerId === activePeerId ? 'You' : msg.peerId.substring(0, 8),
              text,
              type,
              fileName,
              fileSize,
              fileType,
              timestamp: msg.timestamp,
            });
          } catch (err) {
            // skip undecryptable messages
            console.warn('Skipping undecryptable message:', err);
          }
        }
        set({ messages: decryptedMessages });
```

> **Note:** This code decrypts text messages using the derived room key. But at this point in `connectSignaling`, we haven't yet derived the room key — each peer's key exchange happens later. However, the existing code at line 675 already loads messages after key exchange. We need the room key to decrypt messages.

Wait — this is a problem. At `connectSignaling` time, we don't have the room key yet. The room key is derived during the per-peer key exchange. So we can't decrypt messages at this point.

The correct approach: Keep the history loading where it is (after key exchange), but fix it so it only runs ONCE, not once per peer.

- [ ] **Step 2: Fix history loading to run only once**

Replace the current history loading block (lines 675-692) with a guard that only runs once:

```typescript
              set((s) => {
                const updatedPeers = new Map(s.peers);
                const peer = updatedPeers.get(from);
                if (peer) {
                  peer.roomKey = derivedRoomKey;
                  peer.status = 'connected';
                  // ... rest of peer setup ...
                }
                return { peers: updatedPeers };
              });

              // Load persisted history only once (messages array is empty)
              if (get().messages.length === 0) {
                const cachedMessages = await getRoomMessages(roomId);
                const decryptedMessages: ChatMessage[] = [];
                for (const msg of cachedMessages) {
                  try {
                    if (msg.iv) {
                      // Encrypted text message
                      const text = await decryptText(derivedRoomKey, msg.encryptedText, msg.iv);
                      decryptedMessages.push({
                        id: String(msg.id),
                        peerId: msg.peerId,
                        senderName: msg.peerId === peerId ? 'You' : msg.peerId.substring(0, 8),
                        text,
                        timestamp: msg.timestamp,
                      });
                    } else {
                      // File notification message (metadata stored as JSON)
                      const meta = JSON.parse(msg.encryptedText);
                      decryptedMessages.push({
                        id: String(msg.id),
                        peerId: msg.peerId,
                        senderName: msg.peerId === peerId ? 'You' : msg.peerId.substring(0, 8),
                        type: 'file',
                        fileName: meta.name,
                        fileSize: meta.size,
                        fileType: meta.type,
                        timestamp: msg.timestamp,
                      });
                    }
                  } catch (err) {
                    // skip undecryptable or malformed messages
                    console.warn('Skipping unrecoverable message from IndexedDB:', err);
                  }
                }
                if (decryptedMessages.length > 0) {
                  set({ messages: decryptedMessages });
                }
              }

            } catch (err) {
```

The key change: guard with `if (get().messages.length === 0)` so it only runs on the first key exchange.

- [ ] **Step 3: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (success)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/roomStore.ts
git commit -m "fix: guard history loading to run only once on first key exchange"
```

---

### Task 4: Add P2P history sync — send side on peer connect

**Files:**
- Modify: `frontend/src/stores/roomStore.ts:572-693` (in key-exchange success handler)

When a peer's key exchange completes (status → `'connected'`), send the last 50 messages from the current store to the new peer over the WebRTC control channel.

- [ ] **Step 1: Add history bundle send after peer connects**

Inside the key-exchange handler, after the peer is marked as connected and the `set()` is called, before the history loading block, add:

```typescript
              set((s) => {
                // ...
              });

              // Send recent history to the newly connected peer
              const currentMessages = get().messages;
              if (currentMessages.length > 0) {
                const recentMessages = currentMessages.slice(-50);
                const historyBundle = {
                  type: 'history-bundle',
                  messages: recentMessages,
                };
                const peerObj = get().peers.get(from);
                if (peerObj?.pcManager?.controlChannel?.readyState === 'open') {
                  peerObj.pcManager.controlChannel.send(JSON.stringify(historyBundle));
                }
              }

              // Load persisted history only once ...
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/roomStore.ts
git commit -m "feat: send recent history bundle to newly connected peer"
```

---

### Task 5: Add P2P history sync — receive and merge side

**Files:**
- Modify: `frontend/src/stores/roomStore.ts:238-288` (onMessage handler)

When a `history-bundle` message arrives on the control channel, merge the received messages into the store and persist them to IndexedDB.

- [ ] **Step 1: Add history-bundle handler in onMessage**

In the `onMessage` callback, after the chat message handler (line 274) and before the coordinator forwarding (line 277), add:

```typescript
              // Handle history bundle messages
              if (msg.type === 'history-bundle' && Array.isArray(msg.messages)) {
                const existingIds = new Set(get().messages.map(m => m.id));
                const newMessages: ChatMessage[] = [];
                for (const hMsg of msg.messages) {
                  if (!existingIds.has(hMsg.id)) {
                    newMessages.push(hMsg);
                    existingIds.add(hMsg.id);
                    // Persist to IndexedDB
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
                      // Re-encrypt text with current room key for storage
                      const enc = await encryptText(peerObj.roomKey, hMsg.text || '');
                      await saveMessage({
                        roomId,
                        peerId: hMsg.peerId,
                        encryptedText: enc.ciphertext,
                        iv: enc.iv,
                        timestamp: hMsg.timestamp,
                      });
                    }
                    // If no roomKey yet, skip text persistence (best-effort)
                  }
                }
                if (newMessages.length > 0) {
                  set((s) => ({
                    messages: [...s.messages, ...newMessages],
                  }));
                }
                return;
              }
```

Place this after the `chat` handler and before the coordinator forwarding, within the `if (label === 'control' && typeof data === 'string')` block:

```typescript
              // Handle chat messages
              if (msg.type === 'chat' && peerObj?.roomKey) {
                // ... existing handler ...
              }

              // Handle history bundle
              if (msg.type === 'history-bundle' && Array.isArray(msg.messages)) {
                // ... history bundle merge ...
                return;
              }

              // Forward transfer control messages to coordinator
              if (coordinator) {
```

> **Note on re-encryption:** Text messages in the store were originally encrypted with the sender's room key. The history bundle contains decrypted plaintext. We must re-encrypt with our room key before storing in IndexedDB so that on future reloads, they can be decrypted.

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit`
Expected: no output (success)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/stores/roomStore.ts
git commit -m "feat: receive and merge history bundle from existing peers"
```

---

### Task 6: Verify end-to-end

- [ ] **Step 1: Build frontend**

Run: `cd frontend && npx next build`
Expected: Build succeeds

- [ ] **Step 2: Manual smoke test**

1. Open two browser tabs at the same room URL
2. Send a text message from Tab A → appears on Tab B
3. Refresh Tab B → text message should reappear immediately (from IndexedDB)
4. Open a third tab C (new user joins) → should see last 50 messages from Tab A and/or B
5. Send a file from Tab A → Tab B receives it, refresh Tab B → file message still visible in chat
6. Verify IndexedDB in DevTools → Application → IndexedDB → ShadowChatDB → messages table has entries

- [ ] **Step 3: Commit any remaining changes and push**

```bash
git push
```
