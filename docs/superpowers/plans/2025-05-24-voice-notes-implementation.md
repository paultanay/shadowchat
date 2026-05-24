# Voice Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add WhatsApp-style voice recording to the chat input — press-and-hold (mobile) / click-to-record (desktop) with waveform playback in chat.

**Architecture:** Voice notes are recorded via MediaRecorder API, sent through the existing E2EE file transfer pipeline (`initiateFileTransfer`), and rendered as waveform playback widgets (`VoiceNote`) when `fileType.startsWith('audio/')`.

**Tech Stack:** MediaRecorder API, AudioContext (AnalyserNode for live amplitude + decodeAudioData for waveform), WebRTC data channels, Tailwind CSS, Motion

---

### Task 1: Voice recording engine

**Files:**
- Create: `frontend/src/lib/engines/voice.ts`

- [ ] **Step 1: Write voice.ts**

```typescript
export interface VoiceRecorderOptions {
  onAmplitude?: (level: number) => void;
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animationId: number | null = null;
  private chunks: Blob[] = [];
  private startTime: number = 0;
  private _state: 'idle' | 'recording' | 'stopped' = 'idle';
  private options: VoiceRecorderOptions;

  get state() { return this._state; }

  constructor(options: VoiceRecorderOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm; codecs=opus')
      ? 'audio/webm; codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

    this.recorder = new MediaRecorder(this.stream, { mimeType });
    this.chunks = [];
    this._state = 'recording';
    this.startTime = Date.now();

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.start(100);

    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 64;
    source.connect(this.analyser);
    this.pollAmplitude();
  }

  private pollAmplitude(): void {
    if (!this.analyser || this._state !== 'recording') return;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    let max = 0;
    for (let i = 0; i < data.length; i++) {
      const val = Math.abs(data[i] - 128) / 128;
      if (val > max) max = val;
    }
    this.options.onAmplitude?.(max);
    this.animationId = requestAnimationFrame(() => this.pollAmplitude());
  }

  stop(): Promise<{ blob: Blob; duration: number }> {
    return new Promise((resolve, reject) => {
      if (!this.recorder || this._state !== 'recording') {
        reject(new Error('No active recording'));
        return;
      }
      this._state = 'stopped';
      if (this.animationId) cancelAnimationFrame(this.animationId);
      this.recorder.onstop = () => {
        this.cleanup();
        const blob = new Blob(this.chunks, { type: this.recorder!.mimeType });
        const duration = (Date.now() - this.startTime) / 1000;
        if (duration < 1) {
          reject(new Error('Recording too short'));
          return;
        }
        resolve({ blob, duration });
      };
      this.recorder.stop();
    });
  }

  cancel(): void {
    this._state = 'stopped';
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.cleanup();
  }

  private cleanup(): void {
    this.recorder = null;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.chunks = [];
  }
}

export function computeWaveform(blob: Blob, bars: number = 40): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const audioCtx = new AudioContext();
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const buffer = await audioCtx.decodeAudioData(reader.result as ArrayBuffer);
        const channel = buffer.getChannelData(0);
        const samplesPerBar = Math.floor(channel.length / bars);
        const waveform: number[] = [];
        for (let i = 0; i < bars; i++) {
          const start = i * samplesPerBar;
          let max = 0;
          for (let j = 0; j < samplesPerBar; j++) {
            const abs = Math.abs(channel[start + j]);
            if (abs > max) max = abs;
          }
          waveform.push(max);
        }
        await audioCtx.close();
        resolve(waveform);
      } catch (err) {
        await audioCtx.close();
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd frontend && npx tsc --noEmit --pretty`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/engines/voice.ts
git commit -m "feat: add VoiceRecorder engine and computeWaveform utility"
```

---

### Task 2: VoiceNote playback component

**Files:**
- Create: `frontend/src/components/VoiceNote.tsx`

- [ ] **Step 1: Write VoiceNote.tsx**

```typescript
"use client";

import React, { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { computeWaveform } from "@/lib/engines/voice";

interface VoiceNoteProps {
  blob: Blob;
  isSelf: boolean;
}

export default function VoiceNote({ blob, isSelf }: VoiceNoteProps) {
  const [waveform, setWaveform] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    computeWaveform(blob, 40).then(setWaveform).catch(() => {});
    const audio = new Audio(URL.createObjectURL(blob));
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('ended', () => {
      setPlaying(false);
      setCurrentTime(0);
    });
    audioRef.current = audio;
    return () => {
      audio.pause();
      URL.revokeObjectURL(audio.src);
    };
  }, [blob]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      cancelAnimationFrame(animationRef.current);
      setPlaying(false);
    } else {
      audio.play();
      setPlaying(true);
      const update = () => {
        setCurrentTime(audio.currentTime);
        animationRef.current = requestAnimationFrame(update);
      };
      update();
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    audio.currentTime = pct * duration;
    setCurrentTime(audio.currentTime);
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div className={`flex items-center gap-2 p-2 min-w-[200px] max-w-[280px] ${isSelf ? '' : ''}`}>
      <button
        onClick={togglePlay}
        className="shrink-0 w-9 h-9 rounded-full bg-bg-secondary border border-border-glass flex items-center justify-center hover:bg-bg-primary transition-all cursor-pointer"
      >
        {playing
          ? <Pause className="w-4 h-4 text-text-primary" />
          : <Play className="w-4 h-4 text-accent-primary ml-0.5" />
        }
      </button>

      <div className="flex-grow flex flex-col gap-1 min-w-0">
        <div
          className="flex items-end gap-[2px] h-9 cursor-pointer"
          onClick={seek}
          role="slider"
          aria-label="Seek"
          tabIndex={0}
        >
          {waveform.map((val, i) => {
            const barPct = Math.max(4, val * 100);
            const isPlayed = i / waveform.length <= progress;
            return (
              <div
                key={i}
                className="flex-grow rounded-[1px] transition-colors duration-75"
                style={{
                  height: `${barPct}%`,
                  backgroundColor: isPlayed ? '#F7B943' : 'rgba(245,242,235,0.18)',
                  minWidth: '2px',
                }}
              />
            );
          })}
        </div>

        <div className="flex justify-between text-[9px] font-mono text-text-muted">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx next build`
Expected: Compiled successfully, no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/VoiceNote.tsx
git commit -m "feat: add VoiceNote waveform playback component"
```

---

### Task 3: VoiceRecorder UI component

**Files:**
- Create: `frontend/src/components/VoiceRecorder.tsx`

- [ ] **Step 1: Write VoiceRecorder.tsx**

```typescript
"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Mic, X, Square, Lock } from "lucide-react";
import { VoiceRecorder as RecorderEngine } from "@/lib/engines/voice";

interface VoiceRecorderProps {
  onSendFile: (file: File) => Promise<void>;
}

type UIState = 'idle' | 'recording-bar' | 'recording-live';

export default function VoiceRecorder({ onSendFile }: VoiceRecorderProps) {
  const [uiState, setUiState] = useState<UIState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [amplitude, setAmplitude] = useState(0);
  const [slideTarget, setSlideTarget] = useState<'none' | 'lock' | 'cancel'>('none');

  const recorderRef = useRef<RecorderEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const holdTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const isRecordingActive = useRef(false);

  const cleanupRecording = useCallback(() => {
    clearInterval(timerRef.current);
    clearTimeout(holdTimerRef.current);
    recorderRef.current?.cancel();
    recorderRef.current = null;
    isRecordingActive.current = false;
    setUiState('idle');
    setElapsed(0);
    setAmplitude(0);
    setSlideTarget('none');
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const recorder = new RecorderEngine({
        onAmplitude: (level) => setAmplitude(level),
      });
      await recorder.start();
      recorderRef.current = recorder;
      isRecordingActive.current = true;
      setElapsed(0);
      setAmplitude(0);
      setSlideTarget('none');
      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      isRecordingActive.current = false;
      if (err.name === 'NotAllowedError') {
        alert('Microphone access denied.');
      }
    }
  }, []);

  const stopAndSend = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    clearInterval(timerRef.current);
    try {
      const { blob, duration } = await recorder.stop();
      const file = new File([blob], `voice-${Date.now()}.webm`, {
        type: blob.type || 'audio/webm',
      });
      await onSendFile(file);
    } catch (err: any) {
      if (err.message !== 'Recording too short') {
        console.error('Recording failed:', err);
      }
    } finally {
      cleanupRecording();
    }
  }, [onSendFile, cleanupRecording]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (uiState !== 'idle') return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };

    if (e.pointerType === 'mouse') {
      startRecording().then(() => setUiState('recording-bar'));
    } else {
      holdTimerRef.current = setTimeout(() => {
        startRecording();
        setUiState('recording-live');
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);
      }, 200);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (uiState !== 'recording-live' || !isRecordingActive.current) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;

    if (dy < -50) setSlideTarget('lock');
    else if (dx < -60) setSlideTarget('cancel');
    else setSlideTarget('none');
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    clearTimeout(holdTimerRef.current);

    if (e.pointerType === 'touch' && uiState === 'recording-live') {
      if (slideTarget === 'cancel') { cleanupRecording(); return; }
      if (slideTarget === 'lock') { setUiState('recording-bar'); setSlideTarget('none'); return; }
      stopAndSend();
    }
  };

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      clearTimeout(holdTimerRef.current);
      recorderRef.current?.cancel();
    };
  }, []);

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (uiState === 'recording-bar') {
    return (
      <div className="flex items-center gap-2 flex-grow bg-bg-secondary/40 border border-border-glass rounded-xl px-3 py-2">
        <button
          type="button"
          onClick={cleanupRecording}
          className="shrink-0 p-1 rounded-lg bg-accent-danger/10 text-accent-danger hover:bg-accent-danger/20 transition-all cursor-pointer"
          title="Cancel recording"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 flex-grow min-w-0">
          <div className="flex items-end gap-[3px] h-6">
            {[0,1,2,3,4].map((i) => {
              const barH = Math.max(4, (amplitude * 100) * (0.5 + Math.sin(Date.now() / 200 + i * 1.5) * 0.3 + 0.5));
              return (
                <div key={i} className="w-[3px] rounded-full bg-accent-primary transition-all duration-100"
                  style={{ height: `${Math.min(100, barH)}%` }}
                />
              );
            })}
          </div>
          <span className="text-xs font-mono text-text-primary font-bold shrink-0">
            {formatElapsed(elapsed)}
          </span>
        </div>
        <button
          type="button"
          onClick={stopAndSend}
          className="shrink-0 p-2 rounded-lg bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20 transition-all cursor-pointer"
          title="Stop recording"
        >
          <Square className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={(e) => {
        if (e.pointerType !== 'touch' || uiState !== 'recording-live') return;
        clearTimeout(holdTimerRef.current);
        if (slideTarget === 'cancel') cleanupRecording();
        else if (slideTarget === 'lock') { setUiState('recording-bar'); setSlideTarget('none'); }
        else stopAndSend();
      }}
      className="p-2.5 bg-bg-tertiary hover:bg-bg-secondary border border-border-glass text-accent-primary hover:text-accent-primary/80 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-elegant relative touch-none select-none"
      title="Record voice message"
    >
      <Mic className="w-4 h-4" />
      {uiState === 'recording-live' && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-bg-tertiary border border-border-glass rounded-lg shadow-elegant whitespace-nowrap flex items-center gap-2 pointer-events-none">
          <div className="flex items-end gap-[2px] h-4">
            {[0,1,2,3,4].map((i) => {
              const barH = Math.max(3, (amplitude * 100) * (0.5 + Math.sin(Date.now() / 150 + i * 1.5) * 0.3 + 0.5));
              return (
                <div key={i} className="w-[2px] rounded-full bg-accent-primary transition-all duration-100"
                  style={{ height: `${Math.min(100, barH)}%` }}
                />
              );
            })}
          </div>
          <span className="text-[10px] font-mono text-text-primary">{formatElapsed(elapsed)}</span>
          {slideTarget === 'lock' && <Lock className="w-3 h-3 text-accent-primary" />}
          {slideTarget === 'cancel' && <X className="w-3 h-3 text-accent-danger" />}
        </div>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd frontend && npx next build`
Expected: Compiled successfully, no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/VoiceRecorder.tsx
git commit -m "feat: add VoiceRecorder component with recording UI"
```

---

### Task 4: Integrate into page.tsx

**Files:**
- Modify: `frontend/src/app/room/[roomId]/page.tsx`

- [ ] **Step 1: Add Mic import to the lucide-react imports (line 7-29)**

Add `Mic` to the existing import from `lucide-react`:

```
  Send,
  Paperclip,
  Mic,  // ← add after Paperclip
```

- [ ] **Step 2: Import VoiceRecorder and VoiceNote (add near line 31, after QRCodeModal import)**

```typescript
import VoiceRecorder from "@/components/VoiceRecorder";
import VoiceNote from "@/components/VoiceNote";
```

- [ ] **Step 3: Add VoiceRecorder to the input form (after the folder button, before the text input)**

In the form at line 840, add the VoiceRecorder between the folder button and text input:

Current:
```
                <button ... folder button />
                <input type="text" ... />
```

Change to:
```
                <button ... folder button />
                <VoiceRecorder onSendFile={handleFileSelect} />
                <input type="text" ... />
```

Also add `handleFileSelect` as a dependency in the `onSendFile` callback — it's already defined in the component (line 299), so we just pass it.

- [ ] **Step 4: Add voice note rendering in the chat messages section**

In the messages render loop (line 658), after the file message rendering block (which ends at line 803 with `}`), add a voice note check before the text message fallback. Replace the current file card rendering with a voice-note-aware version:

Replace the file message block (lines 661-803) with:

```typescript
                  if (msg.type === 'file') {
                    const transfer = activeTransfers.get(msg.transferId || '');
                    const fileName = transfer?.fileName || msg.fileName || 'Shared File';
                    const fileSize = transfer?.sizeBytes || msg.fileSize || 0;
                    const status = transfer?.status || 'failed';
                    const progress = transfer?.progress || 0;
                    const speed = transfer?.speedBytesPerSec || 0;
                    const eta = transfer?.etaSec || 0;
                    const direction = transfer?.direction || (isSelf ? 'outgoing' : 'incoming');
                    const blob = transfer?.blob;
                    const fileType = transfer?.fileType || msg.fileType || '';

                    // Voice notes render with waveform player
                    if (status === 'completed' && blob && fileType.startsWith('audio/')) {
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col w-full max-w-[85%] sm:max-w-[70%] ${isSelf ? 'ml-auto items-end' : 'mr-auto items-start'}`}
                        >
                          <span className="text-[9px] font-mono text-text-muted mb-1 px-1">
                            {isSelf ? 'You' : msg.senderName} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <div className={`p-3 rounded-2xl text-xs leading-relaxed font-sans w-full border border-border-glass shadow-elegant ${isSelf ? 'bg-bg-tertiary text-text-primary rounded-tr-none' : 'bg-bg-tertiary/60 text-text-primary rounded-tl-none'}`}>
                            <VoiceNote blob={blob} isSelf={isSelf} />
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div ... existing file card JSX from lines 674-802 ...
                      </div>
                    );
                  }
```

- [ ] **Step 5: Verify build**

Run: `cd frontend && npx next build`
Expected: Compiled successfully, no errors

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/room/[roomId]/page.tsx
git commit -m "feat: integrate voice recorder and voice note playback into chat"
```

---

### Task 5: Build verification & push

- [ ] **Step 1: Full build check**

Run: `cd frontend && npx next build`
Expected: Compiled successfully, no TypeScript errors, no ESLint errors

- [ ] **Step 2: Start dev server**

Run: `cd frontend && npx next dev --port 3001`
Expected: Dev server starts, pages render

- [ ] **Step 3: Push to GitHub (if user wants)**

```bash
git push origin main
```
