"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Play, Pause, X } from "lucide-react";
import { computeWaveform } from "@/lib/engines/voice";

interface VoiceNoteProps {
  blob: Blob;
  isSelf: boolean;
}

const formatTime = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
};

export default function VoiceNote({ blob, isSelf }: VoiceNoteProps) {
  const [waveform, setWaveform] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioError, setAudioError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationRef = useRef<number>(0);
  const erroredRef = useRef(false);

  useEffect(() => {
    erroredRef.current = false;
    computeWaveform(blob, 40).then(setWaveform).catch((err) => {
      console.warn('[VoiceNote] Waveform computation failed:', err);
    });
    const cleanType = blob.type.startsWith('audio/webm') ? blob.type.split(';')[0] : blob.type;
    const safeBlob = new Blob([blob], { type: cleanType });
    const url = URL.createObjectURL(safeBlob);
    const audio = new Audio(url);
    const onMeta = () => {
      setDuration(audio.duration);
      setAudioError(false);
    };
    const onEnd = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const onError = () => {
      console.warn('[VoiceNote] Audio element error for type:', safeBlob.type);
      if (!erroredRef.current) {
        erroredRef.current = true;
        setAudioError(true);
      }
    };
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('ended', onEnd);
    audio.addEventListener('error', onError);
    audioRef.current = audio;
    return () => {
      cancelAnimationFrame(animationRef.current);
      audio.pause();
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('ended', onEnd);
      audio.removeEventListener('error', onError);
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      cancelAnimationFrame(animationRef.current);
      setPlaying(false);
    } else {
      const playPromise = audio.play();
      setPlaying(true);
      const update = () => {
        setCurrentTime(audio.currentTime);
        animationRef.current = requestAnimationFrame(update);
      };
      update();
      playPromise.catch(() => {
        cancelAnimationFrame(animationRef.current);
        setPlaying(false);
      });
    }
  }, [playing]);

  const seek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || duration === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const progress = duration > 0 ? currentTime / duration : 0;

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const audio = audioRef.current;
    if (!audio || duration === 0) return;
    if (e.key === 'ArrowLeft') {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
      setCurrentTime(audio.currentTime);
    } else if (e.key === 'ArrowRight') {
      audio.currentTime = Math.min(duration, audio.currentTime + 5);
      setCurrentTime(audio.currentTime);
    }
  }, [duration]);

  return (
    <div className="flex items-center gap-2 p-2 min-w-[200px] max-w-[280px]">
      <button
        onClick={togglePlay}
        className={`shrink-0 w-9 h-9 rounded-full border border-border-glass flex items-center justify-center transition-all cursor-pointer ${isSelf ? 'bg-accent-primary/10 hover:bg-accent-primary/20' : 'bg-bg-secondary hover:bg-bg-primary'}`}
      >
        {audioError
          ? <X className="w-4 h-4 text-accent-danger" />
          : playing
            ? <Pause className="w-4 h-4 text-text-primary" />
            : <Play className="w-4 h-4 ml-0.5 text-accent-primary" />
        }
      </button>

      <div className="flex-grow flex flex-col gap-1 min-w-0">
        <div
          className="flex items-end gap-[2px] h-9 cursor-pointer"
          onClick={seek}
          role="slider"
          aria-label="Voice note seek"
          aria-valuenow={Math.round(currentTime)}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {(waveform.length > 0 ? waveform : Array(40).fill(0.5)).map((val, i) => {
            const barPct = Math.max(4, (val || 0.5) * 100);
            const isPlayed = i / 40 <= progress;
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
