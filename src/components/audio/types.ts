export type AgcSpeed = 'off' | 'fast' | 'medium' | 'slow' | 'custom';
export type BufferMode = 'low' | 'medium' | 'high';

export type AudioUiSettings = {
  volume: number; // 0..100
  mute: boolean;
  squelch: boolean;
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
  packetsReceived: number;
  packetsDropped: number;
  currentLatencyMs: number;
  targetLatencyMs: number;
  queuedSamples: number;
  bufferHealth: number; // 0-1
  codecRate: number;
  outputRate: number;
};
