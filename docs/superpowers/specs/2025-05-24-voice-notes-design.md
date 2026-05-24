# Voice Notes — E2EE WhatsApp-Style Voice Recording

## Overview

Add a mic button to the chat input area that enables press-and-hold (mobile) / click-to-record (desktop) voice recording. Audio is sent through the existing E2EE file transfer pipeline, and received voice notes render as waveform playback widgets in the chat.

## UX Behavior

### Desktop (click-to-record)
- Mic icon in the input bar (left of Paperclip)
- Click mic → the text input is replaced by a recording bar showing:
  - Cancel (X) button on the left
  - Elapsed timer (`0:05` → `M:SS`)
  - Live animated waveform bars (5–6 bars pulsing with amplitude)
  - Stop (□) button on the right
- Click Stop → audio Blob is sent via `initiateFileTransfer`
- Click Cancel → discard audio, restore text input
- After sending, text input is restored automatically

### Mobile (press-and-hold)
- Long-press mic → recording starts immediately
- A floating recording bar appears near the bottom showing timer + waveform
- Release finger → send (haptic-like visual feedback)
- Swipe up to lock recording (hands-free) — lock icon appears
- Swipe left to cancel — the recording bar slides away with a cancel animation
- When locked: tap Stop to send, tap X to cancel

### Audio Playback in Chat
- Voice notes auto-detect: message `type: 'file'` + `fileType.startsWith('audio/')`
- Render a waveform widget instead of the file transfer card:
  - 40–60 waveform bars (blue/dark blue gradient)
  - Play/pause button on the left
  - Elapsed / total duration text
  - Click anywhere on waveform to seek
  - Blue progress overlay that fills bars as playback advances
- Audio files that are not voice notes (e.g. .mp3 sent as files) still show the file transfer card with a download button

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   page.tsx                           │
│  ┌──────────────┐  ┌───────────┐  ┌──────────────┐  │
│  │ VoiceRecorder │  │ TextInput │  │ Send Button  │  │
│  │    (mic)     │  │           │  │              │  │
│  └──────┬───────┘  └───────────┘  └──────────────┘  │
│         │ onStop(blob)                               │
│         ▼                                            │
│  handleFileSelect(blob)                              │
│         │                                            │
│         ▼                                            │
│  roomStore.initiateFileTransfer(peerId, blob)        │
│         │                                            │
│         ▼                                            │
│  FileTransferCoordinator.sendFile(blob)              │
│    ┌─ E2EE encrypts chunks                           │
│    └─ Sends over WebRTC data channels                │
│         │                                            │
│         ▼ (on receiver)                              │
│  FileTransferCoordinator.onComplete(tid, blob)       │
│         │                                            │
│         ▼                                            │
│  Chat renders VoiceNote(blob) widget                 │
└─────────────────────────────────────────────────────┘
```

### Component Tree

```
RoomPage
├── VoiceRecorder          ← new: recording UI with waveform
│   ├── MicButton          ← the mic icon trigger
│   ├── RecordingBar       ← recording overlay (timer + waveform + stop/cancel)
│   └── WaveformCanvas     ← live amplitude bars
└── ChatMessage
    ├── FileCard           ← existing (for non-audio files)
    └── VoiceNote          ← new: playback widget with waveform + seek
        └── WaveformCanvas ← playback progress bars
```

## Files to Create

### `frontend/src/lib/engines/voice.ts`
Voice recording engine wrapping `MediaRecorder` API.

```typescript
interface VoiceRecorderEngine {
  start(): Promise<void>;
  stop(): Promise<{ blob: Blob; duration: number }>;
  cancel(): void;
  onAmplitude?: (level: number) => void; // for live waveform
  state: 'idle' | 'recording' | 'stopped';
}
```

- Requests `getUserMedia({ audio: true })`
- Creates `MediaRecorder` with mime type `audio/webm; codecs=opus`
- Falls back to `audio/webm` or `audio/mp4` (Safari)
- `start()`: begins recording, sets up `AudioContext` + `AnalyserNode` for amplitude callbacks
- `stop()`: returns Promise resolving to `{ blob, duration }`
- `cancel()`: stops recorder without resolving, discards data
- Cleans up media stream tracks on stop/cancel

### `frontend/src/components/VoiceNote.tsx`
Playback waveform component for received voice notes.

```typescript
interface VoiceNoteProps {
  blob: Blob;
  fileName: string;
  isSelf: boolean;
}
```

- Accepts the decrypted audio Blob
- Uses `AudioContext.decodeAudioData()` to get PCM data
- Generates 40-waveform-bar array by downsampling PCM
- Renders SVG/canvas bars with progress highlight
- Play/pause via `<audio>` element + waveform seek
- Computes waveform once (lazily on first render), caches in state
- Styling matches the existing chat bubble design

### `frontend/src/app/room/[roomId]/VoiceRecorder.tsx`
The recording UI component placed in the input area.

- Wraps `VoiceRecorderEngine`
- Renders mic icon (idle state)
- On click (desktop) or pointer-down (mobile):
  - Replaces text input with recording bar
  - Shows live waveform (simple animated bars via amplitude callbacks)
  - Shows elapsed timer
  - Stop button
  - Cancel button
- On stop: creates `File` from Blob, calls `handleFileSelect`
- On cancel: discards, restores text input
- Touch gesture handlers for swipe-to-cancel and swipe-to-lock

## Changes to Existing Files

### `page.tsx`
- Import `Mic` icon from `lucide-react`
- Import `VoiceRecorder` component
- Import `VoiceNote` component
- Add Mic button to the input form (conditionally show VoiceRecorder or text input)
- In the messages render loop, detect audio files and render `VoiceNote` instead of the file card
- Add `hasMic` state to detect microphone availability (optional: hide mic if no mic)

### `roomStore.ts`
- No changes needed — voice notes flow through the existing `initiateFileTransfer` pipeline
- `activeTransfers` entries for audio files transition naturally from 'transferring' → 'completed'
- The `blob` on the completed transfer is available for `VoiceNote` to render

### `transfer.ts`
- No changes needed

## Edge Cases & Error Handling

| Scenario | Behavior |
|----------|----------|
| Microphone permission denied | Show toast error, restore input area |
| No microphone available | Hide mic button entirely (navigator.mediaDevices check) |
| Recording is very short (< 1s) | Treat as cancelled, don't send (like WhatsApp) |
| Recording is very long (no limit) | No artificial limit; up to browser/device memory |
| Peer disconnects during recording | Recording completes locally; transfer fails → shows error |
| Audio context blocked by browser | Gracefully fall back to no waveform, just timer |
| Safari (limited codec support) | Use `audio/mp4` format, waveform may need fallback |
| Multiple rapid clicks | Debounce: ignore new clicks while recording active |

## Testing Plan

1. **Unit**: Voice engine start/stop/cancel lifecycle
2. **Unit**: Waveform computation from PCM data
3. **Integration**: Click mic → recording bar appears → Stop → file transfer initiates
4. **Integration**: Received audio blob renders as VoiceNote with correct waveform
5. **Manual**: Verify on Chrome + Firefox + Safari
6. **Manual**: Mobile press-hold with swipe-to-cancel/lock
7. **Manual**: Cross-browser audio format compatibility
