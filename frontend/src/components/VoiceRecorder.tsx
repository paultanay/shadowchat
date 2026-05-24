"use client";

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Mic, X, Square, Lock } from "lucide-react";
import { VoiceRecorder as RecorderEngine } from "@/lib/engines/voice";
import { useUIStore } from "@/stores/uiStore";

interface VoiceRecorderProps {
  onSendFile: (file: File) => Promise<void>;
}

type UIState = 'idle' | 'recording-bar' | 'recording-live';

export default function VoiceRecorder({ onSendFile }: VoiceRecorderProps) {
  const [uiState, setUiState] = useState<UIState>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [amplitude, setAmplitude] = useState(0);
  const [tick, setTick] = useState(0);
  const [slideTarget, setSlideTarget] = useState<'none' | 'lock' | 'cancel'>('none');

  const recorderRef = useRef<RecorderEngine | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pointerStartRef = useRef({ x: 0, y: 0 });
  const holdActiveRef = useRef(false);
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
      return true;
    } catch (err: unknown) {
      isRecordingActive.current = false;
      recorderRef.current = null;
      if (err instanceof Error && err.name === 'NotAllowedError') {
        useUIStore.getState().showToast({
          type: 'error',
          title: 'Microphone Access Denied',
          message: 'Please allow microphone access in your browser settings.',
        });
      } else {
        console.error('Failed to start recording:', err);
      }
      return false;
    }
  }, []);

  const stopAndSend = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) {
      console.warn('[VoiceRecorder] stopAndSend: no recorder ref');
      return;
    }
    clearInterval(timerRef.current);
    try {
      const { blob } = await recorder.stop();
      const file = new File([blob], `voice-${Date.now()}.webm`, {
        type: blob.type || 'audio/webm',
      });
      await onSendFile(file);
    } catch (err: unknown) {
      if (err instanceof Error && err.message !== 'Recording too short') {
        console.error('[VoiceRecorder] stopAndSend error:', err);
      }
    } finally {
      cleanupRecording();
    }
  }, [onSendFile, cleanupRecording]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (uiState !== 'idle') return;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };

    if (e.pointerType === 'mouse') {
      startRecording().then((ok) => {
        if (ok) setUiState('recording-bar');
      });
    } else {
      const targetEl = e.currentTarget as HTMLElement;
      const pointerId = e.pointerId;
      holdActiveRef.current = true;
      holdTimerRef.current = setTimeout(async () => {
        if (!holdActiveRef.current) return;
        const ok = await startRecording();
        if (!ok) return;
        setUiState('recording-live');
        targetEl.setPointerCapture(pointerId);
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
    holdActiveRef.current = false;

    if (e.pointerType !== 'mouse' && uiState === 'recording-live') {
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

  useEffect(() => {
    if (uiState !== 'recording-bar' && uiState !== 'recording-live') return;
    let rafId: number;
    const loop = () => {
      setTick(performance.now());
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [uiState]);

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
              const barH = Math.max(4, (amplitude * 100) * (0.5 + Math.sin(tick / 200 + i * 1.5) * 0.3 + 0.5));
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
        if (e.pointerType === 'mouse') return;
        clearTimeout(holdTimerRef.current);
        if (uiState !== 'recording-live') return;
        if (slideTarget === 'cancel') cleanupRecording();
        else if (slideTarget === 'lock') { setUiState('recording-bar'); setSlideTarget('none'); }
        else stopAndSend();
      }}
      className="p-2.5 bg-bg-tertiary hover:bg-bg-secondary border border-border-glass text-accent-primary hover:text-accent-primary/80 rounded-xl transition-all cursor-pointer flex items-center justify-center shrink-0 shadow-elegant relative touch-none select-none"
      title="Record voice message"
      aria-label="Voice message"
    >
      <Mic className="w-4 h-4" />
      {uiState === 'recording-live' && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-bg-tertiary border border-border-glass rounded-lg shadow-elegant whitespace-nowrap flex items-center gap-2 pointer-events-none">
          <div className="flex items-end gap-[2px] h-4">
            {[0,1,2,3,4].map((i) => {
              const barH = Math.max(3, (amplitude * 100) * (0.5 + Math.sin(tick / 150 + i * 1.5) * 0.3 + 0.5));
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
