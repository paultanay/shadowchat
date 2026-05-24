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
    if (this._state === 'recording') throw new Error('Already recording');

    try {
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

      this.recorder.onerror = () => {
        console.error('[VoiceRecorder] MediaRecorder error');
        this.cleanup();
      };

      this.recorder.start();

      this.audioContext = new AudioContext();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);
      this.pollAmplitude();
    } catch (err) {
      this.cleanup();
      throw err;
    }
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
      const mimeType = this.recorder.mimeType;
      this.recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: mimeType });
        const duration = (Date.now() - this.startTime) / 1000;
        this.cleanup();
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
    let audioCtx: AudioContext;
    try {
      audioCtx = new AudioContext();
    } catch (err) {
      reject(err);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        if (!(reader.result instanceof ArrayBuffer)) {
          throw new Error('Expected ArrayBuffer from FileReader');
        }
        const buffer = await audioCtx.decodeAudioData(reader.result);
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
    reader.onerror = () => {
      audioCtx.close();
      reject(reader.error);
    };
    reader.readAsArrayBuffer(blob);
  });
}
