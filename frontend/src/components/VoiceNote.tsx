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
