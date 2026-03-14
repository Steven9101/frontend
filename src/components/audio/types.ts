export type AgcSpeed = 'off' | 'fast' | 'medium' | 'slow' | 'custom';
export type BufferMode = 'low' | 'medium' | 'high';
export type LatencyControl = 'idle' | 'slow-down' | 'speed-up';

export type AudioUiSettings = {
  volume: number; // 0..100
  mute: boolean;
  squelch: boolean;
  squelchAuto: boolean;     // true = auto (statistical), false = manual threshold
  squelchLevel: number;     // manual threshold in dB (default: -80)
  nr: boolean;
  nb: boolean;
  an: boolean;
  agcSpeed: AgcSpeed;
  agcAttackMs: number;
  agcReleaseMs: number;
  bufferMode: BufferMode;
};

export type AudioWindow = { l: number; m: number; r: number };

export type AudioDebugStats = {
  wireCodec: number,
  packetsReceived: number;
  packetsDropped: number;
  latencyControl: LatencyControl;
  currentLatencyMs: number;
  targetLatencyMs: number;
  queuedSamples: number;
  bufferHealth: number; // 0-1
  codecRate: number;
  outputRate: number;
};
