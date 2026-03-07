import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Audio, AudioCodec } from '../../modules/novasdrdsp.js';
import { OpusDecoder } from 'opus-decoder';
import { decodeImaAdpcmMono } from '../../lib/imaAdpcm';
import { useReconnectingWebSocket } from '../../lib/useReconnectingWebSocket';
import { registerAudioResumer } from './audioGate';
import type { AudioPacket, BasicInfo } from './protocol';
import type { AudioDebugStats, AudioUiSettings, AudioWindow, LatencyControl } from './types';
import type { ReceiverMode } from '../../lib/receiverMode';

function isLikelyIos(): boolean {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/i.test(ua);
}

type LatencyItem = {
  storeStamp: number;
  delaySeconds: number;
};

type Props = {
  receiverId: string | null;
  receiverSessionNonce: number;
  mode: ReceiverMode;
  centerHz: number | null;
  settings: AudioUiSettings;
  audioWindow?: AudioWindow | null;
  onPcm?: (pcm: Float32Array, sampleRate: number) => void;
};

function isBassBoostMode(mode: ReceiverMode): boolean {
  return mode === 'AM' || mode === 'SAM' || mode === 'FM' || mode === 'FMC';
}

function getBufferMsForMode(mode: 'low' | 'medium' | 'high'): number {
  switch (mode) {
    case 'low':
      return 75; // Low latency, may have dropouts on slower connections
    case 'medium':
      return 150; // Balanced (default)
    case 'high':
      return 300; // High stability, more latency
  }
}

type AudioWireFrame = {
  codec: number;
  frameNum: number;
  l: number;
  m: number;
  r: number;
  pwr: number;
  frames: Uint8Array[];
};

function parseAudioWireFrame(buf: ArrayBuffer): AudioWireFrame | null {
  if (buf.byteLength < 40) return null;
  const bytes = new Uint8Array(buf);
  if (bytes[0] !== 0x4e || bytes[1] !== 0x53 || bytes[2] !== 0x44 || bytes[3] !== 0x41) return null; // "NSDA"

  const version = bytes[4] ?? 0;
  if (version !== 2) return null;

  const codec = bytes[5] ?? 0;
  const view = new DataView(buf);
  const frameNum = Number(view.getBigUint64(8, true));
  const l = view.getInt32(16, true);
  const m = view.getFloat64(20, true);
  const r = view.getInt32(28, true);
  const pwr = view.getFloat32(32, true);

  var pos = 36;
  const numEncodedFrames = view.getUint16(pos, true);
  pos += 2;
  const frames = [];
  for (let i = 0; i < numEncodedFrames; i++) {
    if (pos + 2 > buf.byteLength) return null;
    const len = view.getUint16(pos, true);
    pos += 2;
    if (pos + len > buf.byteLength) return null;
    const oneFrame = bytes.subarray(pos, pos + len);
    frames.push(oneFrame);
    pos += len;
  }

  if (pos + 2 > buf.byteLength) return null;
  const endmark = view.getUint16(pos, true);
  if (endmark !== 0xaabb) return null;

  return { codec, frameNum, l, m, r, pwr, frames };
}


export function useAudioClient({ receiverId, receiverSessionNonce, mode, centerHz, settings, audioWindow, onPcm }: Props) {
  const settingsRef = useRef<AudioUiSettings>(settings);
  const onPcmRef = useRef<Props['onPcm']>(onPcm);
  const decoderRef = useRef<Audio | null>(null);
  const decoderConfigRef = useRef<null | { codec: AudioCodec; codecRate: number; inputRate: number; outputRate: number }>(
    null,
  );
  const desiredDspRef = useRef<{ nr: boolean; nb: boolean; an: boolean }>({ nr: false, nb: false, an: false });
  const decoderNeedsRebuildRef = useRef<boolean>(false);
  const lastNbRef = useRef<boolean | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const [audioSampleRate, setAudioSampleRate] = useState<number>(0);
  const opusDecoderWasmRef = useRef<OpusDecoder<48000> | null>(null);
  const opusDecoderNativeRef = useRef<AudioDecoder | null>(null);
  const [audioDecoderNeedsRebuild, setAudioDecoderNeedsRebuild] = useState<boolean>(false);
  const latencyControlRef = useRef<LatencyControl>('idle');
  const delaysRef = useRef<LatencyItem[]>([]);
  const currentLatencyMsRef = useRef<number>(0.0);
  const wireCodecForDebugStats = useRef<number>(0);
  const gainRef = useRef<GainNode | null>(null);
  const ctcssFilterRef = useRef<BiquadFilterNode | null>(null);
  const bassFilterRef = useRef<BiquadFilterNode | null>(null);
  const bassEnabledRef = useRef<boolean>(isBassBoostMode(mode));
  const bassModeRef = useRef<ReceiverMode>(mode);
  const ctcssEnabledRef = useRef<boolean>(mode === 'FMC');
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaElRef = useRef<HTMLAudioElement | null>(null);
  const useMediaElementOutputRef = useRef<boolean>(isLikelyIos());

  const playTimeRef = useRef<number>(0);
  const pcmQueueRef = useRef<Float32Array[]>([]);
  const pcmQueuedSamplesRef = useRef<number>(0);
  const startedPlaybackRef = useRef<boolean>(false);
  const targetLeadSecRef = useRef<number>(getBufferMsForMode(settings.bufferMode) / 1000);
  const lastWindowRef = useRef<string>('');
  const lastDemodRef = useRef<string>('');
  const lastSentMuteRef = useRef<boolean | null>(null);
  const lastSentSquelchRef = useRef<boolean | null>(null);
  const lastSentAgcRef = useRef<string | null>(null);
  const receiverIdRef = useRef<string | null>(receiverId);
  const smeterOffsetDbRef = useRef<number>(0);
  receiverIdRef.current = receiverId;

  useEffect(() => {
    // Receiver switches reset server-side state; force a full resync so the tuned window and
    // demodulation always match the UI (even if the numeric window indices happen to match
    // a previous receiver session).
    lastDemodRef.current = '';
    lastWindowRef.current = '';
    lastSentMuteRef.current = null;
    lastSentSquelchRef.current = null;
    lastSentAgcRef.current = null;
  }, [receiverSessionNonce]);

  useEffect(() => {
    bassEnabledRef.current = isBassBoostMode(mode);
    bassModeRef.current = mode;
    ctcssEnabledRef.current = mode === 'FMC';

    const ctcss = ctcssFilterRef.current;
    if (ctcss) {
      ctcss.frequency.value = mode === 'FMC' ? 300 : 10;
    }

    const bass = bassFilterRef.current;
    if (!bass) return;

    if (mode === 'AM' || mode === 'SAM') {
      bass.frequency.value = 140;
      bass.gain.value = 12;
      return;
    }
    if (mode === 'FM' || mode === 'FMC') {
      bass.frequency.value = 120;
      bass.gain.value = 6;
      return;
    }
  }, [mode]);

  // Debug stats
  const [debugStats, setDebugStats] = useState<AudioDebugStats>({
    wireCodec: 0,
    packetsReceived: 0,
    packetsDropped: 0,
    latencyControl: "idle",
    currentLatencyMs: 0,
    targetLatencyMs: getBufferMsForMode(settings.bufferMode),
    queuedSamples: 0,
    bufferHealth: 1,
    codecRate: 0,
    outputRate: 0,
  });
  const packetsReceivedRef = useRef<number>(0);
  const packetsDroppedRef = useRef<number>(0);


  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [basicInfo, setBasicInfo] = useState<BasicInfo | null>(null);
  const [pwrDb, setPwrDb] = useState<number | null>(null);
  const [needsUserGesture, setNeedsUserGesture] = useState<boolean>(false);
  const [connectionNonce, setConnectionNonce] = useState(0);
  const closeWsRef = useRef<null | (() => void)>(null);
  const messageHandlerRef = useRef<(event: MessageEvent) => void>(() => undefined);

  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (receiverSessionNonce <= 0) return;
    lastDemodRef.current = '';
    lastWindowRef.current = '';
    lastSentMuteRef.current = null;
    lastSentSquelchRef.current = null;
    lastSentAgcRef.current = null;

    pcmQueueRef.current = [];
    pcmQueuedSamplesRef.current = 0;
    startedPlaybackRef.current = false;
    setBasicInfo(null);
    setPwrDb(null);
    setStatus('connecting');
    setError(null);
  }, [receiverSessionNonce]);

  const effectiveDemod = useMemo(() => {
    if (mode === 'CW') return 'USB';
    if (mode === 'WBFM') return 'FM';
    if (mode === 'FMC') return 'FM';
    return mode;
  }, [mode]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    onPcmRef.current = onPcm;
  }, [onPcm]);

  // Do NOT call into the WASM decoder from these effects. Queue settings and apply them at safe
  // packet boundaries inside the websocket handler to avoid re-entrancy / aliasing panics.
  useEffect(() => {
    desiredDspRef.current.nr = settings.nr;
  }, [settings.nr]);
  useEffect(() => {
    desiredDspRef.current.an = settings.an;
  }, [settings.an]);
  useEffect(() => {
    desiredDspRef.current.nb = settings.nb;
    if (lastNbRef.current !== null && lastNbRef.current !== settings.nb) {
      // Noise blanker toggles have been observed to panic when enabled mid-stream.
      // Recreate the decoder on the next frame to ensure a clean internal state.
      decoderNeedsRebuildRef.current = true;
    }
    lastNbRef.current = settings.nb;
  }, [settings.nb]);

  const ensureAudioGraph = useCallback((desiredSampleRate?: number) => {
    if (
      audioCtxRef.current &&
      gainRef.current &&
      ctcssFilterRef.current &&
      bassFilterRef.current &&
      destRef.current &&
      (desiredSampleRate == null || Math.abs(audioCtxRef.current.sampleRate - desiredSampleRate) < 1)
    ) {
      return;
    }

    const mediaEl = mediaElRef.current;
    if (mediaEl) {
      try {
        mediaEl.pause();
      } catch {
        // ignore
      }
      try {
        mediaEl.srcObject = null;
      } catch {
        // ignore
      }
    }

    try {
      audioCtxRef.current?.close();
    } catch {
      // ignore
    }
    audioCtxRef.current = null;
    gainRef.current = null;
    ctcssFilterRef.current = null;
    bassFilterRef.current = null;
    destRef.current = null;
    pcmQueueRef.current = [];
    pcmQueuedSamplesRef.current = 0;

    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setError('AudioContext is not available in this browser.');
      setStatus('error');
      return;
    }
    const audioCtx =
      desiredSampleRate != null ? new AudioContextCtor({ sampleRate: desiredSampleRate }) : new AudioContextCtor();
    const gain = audioCtx.createGain();
    gain.gain.value = clamp((settingsRef.current.volume / 100) * 5, 0, 8);
    const ctcss = audioCtx.createBiquadFilter();
    ctcss.type = 'highpass';
    ctcss.frequency.value = ctcssEnabledRef.current ? 300 : 10;
    ctcss.Q.value = 0.707;
    const bass = audioCtx.createBiquadFilter();
    bass.type = 'lowshelf';
    if (bassModeRef.current === 'FM' || bassModeRef.current === 'FMC') {
      bass.frequency.value = 120;
      bass.gain.value = 6;
    } else {
      bass.frequency.value = 140;
      bass.gain.value = 12;
    }
    const dest = audioCtx.createMediaStreamDestination();

    // On iOS, route audio through an <audio> element so it can continue playing when the page is backgrounded.
    // If we connect both to `audioCtx.destination` and the media element we will double-play.
    if (!useMediaElementOutputRef.current) {
      gain.connect(audioCtx.destination);
    }
    gain.connect(dest);
    bass.connect(gain);
    ctcss.connect(bass);

    audioCtxRef.current = audioCtx;
    gainRef.current = gain;
    ctcssFilterRef.current = ctcss;
    bassFilterRef.current = bass;
    destRef.current = dest;
    playTimeRef.current = audioCtx.currentTime + 0.06;
    pcmQueueRef.current = [];
    pcmQueuedSamplesRef.current = 0;
    startedPlaybackRef.current = false;

    if (useMediaElementOutputRef.current) {
      if (!mediaElRef.current) {
        const el = document.createElement('audio');
        el.preload = 'none';
        el.autoplay = false;
        el.setAttribute('playsinline', '');
        el.setAttribute('webkit-playsinline', '');
        mediaElRef.current = el;
      }
      try {
        mediaElRef.current.srcObject = dest.stream;
      } catch {
        // ignore
      }
    }

    setAudioSampleRate(audioCtx.sampleRate);
    setNeedsUserGesture(audioCtx.state !== 'running');
  }, []);

  useEffect(() => {
    if (audioSampleRate !== 48000) return;
    if (!audioDecoderNeedsRebuild && (opusDecoderNativeRef.current || opusDecoderWasmRef.current)) return;

    try {
      opusDecoderNativeRef.current?.close();
    } catch {
      // ignore
    }
    opusDecoderNativeRef.current = null;
    try {
      opusDecoderWasmRef.current?.free();
    } catch {
      // ignore
    }
    opusDecoderWasmRef.current = null;

    const probeCreateWasmOpusDecoder = () => {
      const opusDecoder = new OpusDecoder<48000>({ "channels": 1, "sampleRate": 48000 });
      (async () => {
        await opusDecoder.ready;
        opusDecoderWasmRef.current = opusDecoder;
        setAudioDecoderNeedsRebuild(false);
      })();
    }

    const audioDecoderOnError = (_e: DOMException) => {
      packetsDroppedRef.current += 1;

      const audioDecoder = opusDecoderNativeRef.current;
      if (!audioDecoder) return;

      if (audioDecoder.state !== 'closed') {
        audioDecoder.reset();
      }
      setAudioDecoderNeedsRebuild(true);
    }

    const audioDecoderOnData = (data: AudioData) => {
      const decoder = decoderRef.current;
      const ctx = audioCtxRef.current;
      const gain = gainRef.current;
      if (!decoder || !ctx || !gain) return;

      const size = data.allocationSize({ "planeIndex": 0 });
      const buf = new ArrayBuffer(size);
      data.copyTo(buf, { "planeIndex": 0, "format": "f32-planar" });
      var raw_pcm = new Float32Array(buf, 0, data.numberOfFrames);
      audioPrePump(ctx, gain, decoder, raw_pcm);
    }

    // probe to create native Opus decoder first and in unsuccess case create Wasm version
    if ('AudioDecoder' in window) {
      const nativeAudioDecoder = new AudioDecoder({
        "error": audioDecoderOnError,
        "output": audioDecoderOnData
      });
      const params = {
        codec: "opus",
        sampleRate: 48000,
        numberOfChannels: 1,
      };
      (async () => {
        const r = await AudioDecoder.isConfigSupported(params);
        if (r.supported) {
          nativeAudioDecoder.configure(r.config!);
          opusDecoderNativeRef.current = nativeAudioDecoder;
          setAudioDecoderNeedsRebuild(false);
        } else {
          probeCreateWasmOpusDecoder();
        }
      })();
    } else {
      probeCreateWasmOpusDecoder();
    }
  }, [audioSampleRate, audioDecoderNeedsRebuild]);

  const pumpAudio = useCallback(
    (ctx: AudioContext, gain: GainNode) => {
      // Scheduling approach:
      // - calculate latency as difference between scheduled playback time and current time in the audio context coordinate system
      // - try to keep this time at the desired level by adjusting playback speed using wasm based resampler
      // - drop packets that are definitely will be played too late
      // - restart scheduler when underrun
      const targetSeconds = getBufferMsForMode(settingsRef.current.bufferMode) / 1000;
      const maxDelayInSeconds = 2.0
      const maxQueueSamples = Math.round(ctx.sampleRate * maxDelayInSeconds); // cap ~2s

      // Prevent unbounded growth if the UI is stalled and packets keep arriving.
      while (pcmQueuedSamplesRef.current > maxQueueSamples && pcmQueueRef.current.length > 0) {
        const dropped = pcmQueueRef.current.shift();
        if (!dropped) break;
        pcmQueuedSamplesRef.current -= dropped.length;
        packetsDroppedRef.current += 1;
        startedPlaybackRef.current = false;
      }

      if (startedPlaybackRef.current && playTimeRef.current + 0.01 < ctx.currentTime) {
        // we far ahead of play schedule - drop and resync
        packetsDroppedRef.current += 1; // Count underruns as drops
        startedPlaybackRef.current = false;
      }

      if (!startedPlaybackRef.current) {
        // restart scheduler  
        playTimeRef.current = Math.ceil((ctx.currentTime + targetSeconds) * 128) / 128;
        latencyControlRef.current = 'idle';
        decoderRef.current?.set_relative_resample_ratio(1.0);
        delaysRef.current = [];
      }

      // calculte number of samples rounded to chunk of 10ms
      const quantSamples = 0.01 * ctx.sampleRate;
      const samplesToBeProcessed = Math.floor(pcmQueuedSamplesRef.current / quantSamples) * quantSamples;

      // nothing to schedule
      if (samplesToBeProcessed < quantSamples)
        return;

      const out = new Float32Array(samplesToBeProcessed);
      let filled = 0;
      while (filled < out.length) {
        const head = pcmQueueRef.current[0];
        if (!head) break;
        const take = Math.min(head.length, out.length - filled);
        out.set(head.subarray(0, take), filled);
        filled += take;
        pcmQueuedSamplesRef.current -= take;
        if (take === head.length) {
          pcmQueueRef.current.shift();
        } else {
          pcmQueueRef.current[0] = head.subarray(take);
        }
      }

      // We are going to schedule audio frame which ends too late - drop it.
      if (playTimeRef.current + samplesToBeProcessed / ctx.sampleRate > ctx.currentTime + maxDelayInSeconds) {
        packetsDroppedRef.current += 1;
        return;
      }

      // Calculate latency as differnce between planned time in future and current time in audio context coordinate system.
      // And save this information in the array. This is to make latency control decision.
      const diff = playTimeRef.current - ctx.currentTime;
      const now = performance.now();
      delaysRef.current.push({ storeStamp: now, delaySeconds: diff });

      // keep only last N milliseconds
      const millisecondsToKeep = 400;
      while (delaysRef.current.length) {
        if (delaysRef.current[0].storeStamp > now - millisecondsToKeep) {
          break;
        }
        delaysRef.current.shift();
      }

      // constants for latency control algorithm
      const highThresholdSeconds = targetSeconds * 1.4;
      const lowThresholdSeconds = targetSeconds * 0.8;
      const playBackShiftPart = 0.01; // %% to change playback rate on

      const diffMin = delaysRef.current.reduce((res, x) => Math.min(res, x.delaySeconds), Infinity);

      currentLatencyMsRef.current = diffMin * 1000;

      // latency control algorithm
      if (latencyControlRef.current == 'idle') {
        if (diffMin > highThresholdSeconds) {
          latencyControlRef.current = 'speed-up';
          decoderRef.current?.set_relative_resample_ratio(1.0 - playBackShiftPart);
        } else if (diffMin < lowThresholdSeconds) {
          latencyControlRef.current = 'slow-down';
          decoderRef.current?.set_relative_resample_ratio(1.0 + playBackShiftPart);
        }
      } else if (latencyControlRef.current == 'speed-up') {
        if (diffMin < targetSeconds || diffMin < 0.025) {
          latencyControlRef.current = 'idle';
          decoderRef.current?.set_relative_resample_ratio(1.0);
        }
      } else if (latencyControlRef.current == 'slow-down') {
        if (diffMin > targetSeconds) {
          latencyControlRef.current = 'idle';
          decoderRef.current?.set_relative_resample_ratio(1.0);
        }
      }

      const buffer = ctx.createBuffer(1, out.length, ctx.sampleRate);
      buffer.copyToChannel(out, 0, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const ctcss = ctcssFilterRef.current;
      const bass = bassFilterRef.current;
      if (ctcss && ctcssEnabledRef.current) src.connect(ctcss);
      else if (bass && bassEnabledRef.current) src.connect(bass);
      else src.connect(gain);
      src.start(playTimeRef.current);
      playTimeRef.current += buffer.duration;
      startedPlaybackRef.current = true;
    },
    [],
  );

  const resumeAudio = useCallback(async () => {
    ensureAudioGraph();
    const ctx = audioCtxRef.current;
    if (!ctx) return;

    try {
      await ctx.resume();
    } finally {
      setNeedsUserGesture(ctx.state !== 'running');
    }

    if (useMediaElementOutputRef.current) {
      const el = mediaElRef.current;
      if (el && el.srcObject) {
        try {
          // iOS requires a user gesture for this; our callers ensure this runs from a gesture.
          await el.play();
        } catch {
          setNeedsUserGesture(true);
        }
      }
    }
  }, [ensureAudioGraph]);

  useEffect(() => registerAudioResumer(() => void resumeAudio()), [resumeAudio]);

  useEffect(() => {
    if (!needsUserGesture) return;
    const onUserGesture = () => {
      void resumeAudio();
    };
    const opts: AddEventListenerOptions = { once: true, capture: true };
    document.addEventListener('pointerdown', onUserGesture, opts);
    document.addEventListener('touchstart', onUserGesture, opts);
    document.addEventListener('mousedown', onUserGesture, opts);
    document.addEventListener('click', onUserGesture, opts);
    document.addEventListener('keydown', onUserGesture, opts);
    return () => {
      document.removeEventListener('pointerdown', onUserGesture, true);
      document.removeEventListener('touchstart', onUserGesture, true);
      document.removeEventListener('mousedown', onUserGesture, true);
      document.removeEventListener('click', onUserGesture, true);
      document.removeEventListener('keydown', onUserGesture, true);
    };
  }, [needsUserGesture, resumeAudio]);

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = useMemo(() => `${proto}://${window.location.host}/audio`, [proto]);

  const onWsMessage = useCallback((event: MessageEvent) => {
    messageHandlerRef.current(event);
  }, []);

  const ws = useReconnectingWebSocket({
    source: 'audio',
    url: wsUrl,
    binaryType: 'arraybuffer',
    connectTimeoutMs: 6_000,
    onOpen: (socket) => {
      ensureAudioGraph();
      setStatus('connecting');
      setError(null);
      setConnectionNonce((prev) => prev + 1);

      // Force a full client->server resync after reconnects.
      lastDemodRef.current = '';
      lastWindowRef.current = '';
      lastSentMuteRef.current = null;
      lastSentSquelchRef.current = null;
      lastSentAgcRef.current = null;

      const rid = receiverIdRef.current;
      if (rid) {
        try {
          socket.send(JSON.stringify({ cmd: 'receiver', receiver_id: rid }));
        } catch {
          // ignore
        }
      }
    },
    onClose: () => {
      setStatus('connecting');
      setError(null);
    },
    onMessage: onWsMessage,
  });
  const sendJson = ws.sendJson;
  const closeWs = ws.close;

  useEffect(() => {
    closeWsRef.current = closeWs;
  }, [closeWs]);

  const send = useCallback(
    (msg: unknown): boolean => {
      return sendJson(msg);
    },
    [sendJson],
  );

  useEffect(() => {
    if (!receiverId) return;
    send({ cmd: 'receiver', receiver_id: receiverId });
  }, [receiverId, send]);

  const computeAudioWindow = useCallback(
    (info: BasicInfo, demod: string, hz: number) => {
      const maxIdx = Math.max(0, info.fft_result_size - 1);
      const t = clamp((hz - info.basefreq) / info.total_bandwidth, 0, 1);
      const mIdx = clampInt(Math.round(t * maxIdx), 0, maxIdx);
      const n = info.audio_max_fft;
      if (n <= 0) return null;
      const half = Math.floor(n / 2);

      const hzPerBin = info.total_bandwidth / info.fft_result_size;
      if (Number.isFinite(hzPerBin) && hzPerBin > 0 && (demod === 'USB' || demod === 'LSB')) {
        const ssbLowCutHzRaw = info.defaults?.ssb_lowcut_hz ?? 100;
        const ssbHighCutHzRaw = info.defaults?.ssb_highcut_hz ?? 2800;

        const ssbLowCutHz = Math.max(0, Math.floor(Number(ssbLowCutHzRaw) || 0));
        const ssbHighCutHz = Math.max(ssbLowCutHz + 1, Math.floor(Number(ssbHighCutHzRaw) || 0));

        // Convert Hz edges to bins conservatively:
        // - low-cut uses floor so we don't accidentally shift the edge upward
        // - high-cut uses ceil so we don't accidentally shrink the requested bandwidth
        const lowCutBinsRaw = Math.floor(ssbLowCutHz / hzPerBin);
        const lowCutBins = ssbLowCutHz > 0 ? Math.max(1, lowCutBinsRaw) : Math.max(0, lowCutBinsRaw);
        const highCutBins = Math.max(lowCutBins + 1, Math.ceil(ssbHighCutHz / hzPerBin));

        if (demod === 'USB') {
          const l = clampInt(mIdx + lowCutBins, 0, maxIdx);
          let r = clampInt(mIdx + highCutBins, l, maxIdx);
          if (r - l > n) r = clampInt(l + n, l, maxIdx);
          return { l, r, m: mIdx };
        }

        // LSB
        let l = clampInt(mIdx - highCutBins, 0, maxIdx);
        const r = clampInt(mIdx - lowCutBins, l, maxIdx);
        if (r - l > n) l = clampInt(r - n, 0, r);
        return { l, r, m: mIdx };
      }

      // AM / FM / SAM (and USB/LSB fallback if bin sizing is unknown)
      // The DSP expects bins around `m` to be available on both sides.
      let l = clampInt(mIdx - half, 0, maxIdx);
      let r = clampInt(l + n, l, maxIdx);
      if (r - l < 1) r = Math.min(maxIdx, l + 1);
      if (r - l > n) {
        l = clampInt(mIdx - half, 0, Math.max(0, maxIdx - n));
        r = clampInt(l + n, l, maxIdx);
      }
      return { l, r, m: mIdx };
    },
    [],
  );

  const audioPrePump = useCallback((ctx: AudioContext, gain: GainNode, decoder: Audio, raw_pcm: Float32Array<ArrayBufferLike>) => {
    let decoded: Float32Array | null = null;
    try {
      decoded = raw_pcm.length > 0 ? (decoder.process_pcm_f32(raw_pcm) as Float32Array) : null;
    } catch {
      // If the decoder panics/traps, try a one-time rebuild and let the stream continue.
      decoderNeedsRebuildRef.current = true;
      decoded = null;
      packetsDroppedRef.current += 1;
    }
    if (!decoded) return;

    const pcm = new Float32Array(decoded);
    if (pcm.length === 0) {
      setStatus('ready');
      setError(null);
      return;
    }

    // Optional decoder tap (no transfer; keep playback intact).
    try {
      const sr = ctx.sampleRate;
      const cb = onPcmRef.current;
      if (cb && Number.isFinite(sr) && sr > 0) cb(pcm, sr);
    } catch {
      // ignore
    }

    pcmQueueRef.current.push(pcm);
    pcmQueuedSamplesRef.current += pcm.length;
    pumpAudio(ctx, gain);

    setStatus('ready');
    setError(null);

  }, [pumpAudio]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          const raw = JSON.parse(event.data) as BasicInfo;
          const desiredReceiverId = receiverIdRef.current;
          if (desiredReceiverId && raw.receiver_id && raw.receiver_id !== desiredReceiverId) {
            return;
          }
          try {
            if (raw.audio_unique_id) {
              window.sessionStorage.setItem('novasdr.audio_unique_id', raw.audio_unique_id);
            }
          } catch {
            // ignore
          }
          setBasicInfo(raw);
          const isOpus = raw.audio_compression === 'opus';
          smeterOffsetDbRef.current = typeof raw.smeter_offset === 'number' ? raw.smeter_offset : 0;
          const outputSps = Math.max(1, Math.round(raw.audio_max_sps));
          const adjustedOutputSps = (isOpus) ? 48000 : outputSps;

          ensureAudioGraph(adjustedOutputSps);
          const ctx = audioCtxRef.current;
          if (!ctx) return;
          pcmQueueRef.current = [];
          pcmQueuedSamplesRef.current = 0;
          playTimeRef.current = ctx.currentTime + 0.06;
          startedPlaybackRef.current = false;
          targetLeadSecRef.current = getBufferMsForMode(settingsRef.current.bufferMode) / 1000;
          packetsReceivedRef.current = 0;
          packetsDroppedRef.current = 0;

          const codec = AudioCodec.Flac;

          // The DSP audio stream is produced by taking an IFFT of size `audio_max_fft` from the main FFT,
          // so its *effective* sample rate is derived from the FFT parameters (not necessarily exactly the
          // configured `audio_max_sps`).
          //
          // Rate derivation:
          // - Each main FFT frame advances by fft_size/2 samples (50% overlap)
          // - Per frame the audio path produces audio_max_fft/2 new audio samples (overlap/add)
          // => audio_sps = (audio_max_fft / fft_size) * sps
          const fftSize = raw.fft_result_size * (raw.total_bandwidth === raw.sps / 2 ? 2 : 1);
          const trueAudioSps = Math.max(1, Math.round((raw.audio_max_fft / fftSize) * raw.sps));

          const adjustedTrueAudioSps = (isOpus) ? trueAudioSps * 48000 / raw.audio_max_sps : trueAudioSps;
          const adjustedOutputSampleRate = (isOpus) ? 48000 : ctx.sampleRate;

          try {
            decoderRef.current?.free();
          } catch {
            // ignore
          }
          decoderConfigRef.current = {
            codec,
            codecRate: raw.audio_max_sps,
            inputRate: adjustedTrueAudioSps,
            outputRate: adjustedOutputSampleRate,
          };
          decoderRef.current = new Audio(codec, raw.audio_max_sps, adjustedTrueAudioSps, adjustedOutputSampleRate);
          const current = settingsRef.current;
          desiredDspRef.current = { nr: current.nr, nb: current.nb, an: current.an };
          decoderRef.current.set_nr(current.nr);
          decoderRef.current.set_nb(current.nb);
          decoderRef.current.set_an(current.an);
          decoderNeedsRebuildRef.current = false;
        } catch (e: unknown) {
          setStatus('error');
          setError(e instanceof Error ? e.message : 'invalid settings');
          closeWsRef.current?.();
        }
        return;
      }

      if (!(event.data instanceof ArrayBuffer)) return;
      let decoder = decoderRef.current;
      const ctx = audioCtxRef.current;
      const gain = gainRef.current;
      if (!decoder) return;

      const wire = parseAudioWireFrame(event.data);
      if (!wire) return;
      const audioPkt: AudioPacket = {
        frame_num: wire.frameNum,
        l: wire.l,
        m: wire.m,
        r: wire.r,
        pwr: wire.pwr,
        frames: wire.frames,
      };

      packetsReceivedRef.current += 1;

      const n = Math.max(1, audioPkt.r - audioPkt.l);
      const avgPerBin = audioPkt.pwr / n;
      const normalized = avgPerBin / n;
      const smeterOffsetDb = smeterOffsetDbRef.current;
      setPwrDb(10 * Math.log10(Math.max(1e-20, normalized)) + smeterOffsetDb);

      if (!ctx || !gain) return;
      if (ctx.state !== 'running') {
        setNeedsUserGesture(true);
        return;
      }

      // Apply DSP setting changes at safe packet boundaries.
      // NB is special-cased: rebuild the decoder when it toggles to avoid known panics.
      if (decoderNeedsRebuildRef.current) {
        const cfg = decoderConfigRef.current;
        if (cfg) {
          try {
            decoderRef.current?.free();
          } catch {
            // ignore
          }
          decoderRef.current = new Audio(cfg.codec, cfg.codecRate, cfg.inputRate, cfg.outputRate);
          decoder = decoderRef.current;
          decoderNeedsRebuildRef.current = false;

          // Re-apply DSP settings to the fresh decoder.
          const desired = desiredDspRef.current;
          try {
            decoder.set_nr(desired.nr);
            decoder.set_nb(desired.nb);
            decoder.set_an(desired.an);
          } catch {
            // ignore; we'll fall back to defaults if wasm rejects the call
          }
        }
      } else {
        const desired = desiredDspRef.current;
        try {
          decoder.set_nr(desired.nr);
          decoder.set_nb(desired.nb);
          decoder.set_an(desired.an);
        } catch {
          // ignore; avoid crashing the audio pipeline from a UI toggle
        }
      }

      wireCodecForDebugStats.current = wire.codec;

      let raw_pcm: Float32Array | null = null;
      try {
        if (wire.codec === 1) {
          const frames = audioPkt.frames.map(x => decodeImaAdpcmMono(x));
          raw_pcm = combineFrames(frames);
        } else if (wire.codec === 2 && opusDecoderNativeRef.current) {
          for (const frame of audioPkt.frames) {
            const chunk = new EncodedAudioChunk({ "data": frame, "type": "key", "timestamp": 0 });
            opusDecoderNativeRef.current.decode(chunk);
          }
          return;
        } else if (wire.codec === 2 && opusDecoderWasmRef.current) {
          const frames = audioPkt.frames
            .map(x => {
              const d = opusDecoderWasmRef.current!.decodeFrame(x);
              return d.channelData[0];
            })
            .filter(x => x.length > 0);
          raw_pcm = combineFrames(frames);
        } else {
          return;
        }
      } catch {
        // ignore
        packetsDroppedRef.current += 1;
        return;
      }
      audioPrePump(ctx, gain, decoder, raw_pcm);
    };
    messageHandlerRef.current = handleMessage;

    return () => {
      messageHandlerRef.current = () => undefined;
      try {
        decoderRef.current?.free();
      } catch {
        // ignore
      }
      decoderRef.current = null;
      decoderConfigRef.current = null;
      const el = mediaElRef.current;
      if (el) {
        try {
          el.pause();
        } catch {
          // ignore
        }
        try {
          el.srcObject = null;
        } catch {
          // ignore
        }
      }
      try {
        audioCtxRef.current?.close();
      } catch {
        // ignore
      }
      audioCtxRef.current = null;
      gainRef.current = null;
      destRef.current = null;
      closeWsRef.current?.();
    };
  }, [ensureAudioGraph, pumpAudio]);

  useEffect(() => {
    const gain = gainRef.current;
    if (!gain) return;
    gain.gain.value = clamp((settings.volume / 100) * 5, 0, 8);
  }, [settings.volume]);

  useEffect(() => {
    // Resend on reconnect even if the mode hasn't changed locally.
    if (lastDemodRef.current === effectiveDemod && connectionNonce > 0) return;
    if (!send({ cmd: 'demodulation', demodulation: effectiveDemod })) return;
    lastDemodRef.current = effectiveDemod;
  }, [connectionNonce, effectiveDemod, receiverSessionNonce, send]);

  useEffect(() => {
    if (!basicInfo || centerHz == null) return;
    if (audioWindow) return;
    const win = computeAudioWindow(basicInfo, effectiveDemod, centerHz);
    if (!win) return;
    const key = `${win.l}:${win.m}:${win.r}`;
    if (key === lastWindowRef.current) return;
    if (!send({ cmd: 'window', l: win.l, r: win.r, m: win.m })) return;
    lastWindowRef.current = key;
  }, [audioWindow, basicInfo, centerHz, computeAudioWindow, connectionNonce, effectiveDemod, receiverSessionNonce, send]);

  useEffect(() => {
    if (!basicInfo || !audioWindow) return;
    const normalized = normalizeAudioWindow(basicInfo, audioWindow);
    const key = `${normalized.l}:${normalized.m}:${normalized.r}`;
    if (key === lastWindowRef.current) return;
    if (!send({ cmd: 'window', l: normalized.l, r: normalized.r, m: normalized.m })) return;
    lastWindowRef.current = key;
  }, [audioWindow, basicInfo, connectionNonce, receiverSessionNonce, send]);

  useEffect(() => {
    if (!basicInfo) return;
    const desiredMute = settings.mute;
    if (lastSentMuteRef.current === desiredMute) return;
    if (!send({ cmd: 'mute', mute: desiredMute })) return;
    lastSentMuteRef.current = desiredMute;
  }, [basicInfo, connectionNonce, send, settings.mute]);

  useEffect(() => {
    if (!basicInfo) return;
    const enabled = settings.squelch;
    if (lastSentSquelchRef.current === enabled) return;
    if (!send({ cmd: 'squelch', enabled })) return;
    lastSentSquelchRef.current = enabled;
  }, [basicInfo, connectionNonce, send, settings.squelch]);

  useEffect(() => {
    if (!basicInfo) return;
    const key = `${settings.agcSpeed}:${settings.agcAttackMs}:${settings.agcReleaseMs}`;
    if (lastSentAgcRef.current === key) return;
    const payload: Record<string, unknown> = { cmd: 'agc', speed: settings.agcSpeed };
    if (settings.agcSpeed === 'custom') {
      payload.attack = settings.agcAttackMs;
      payload.release = settings.agcReleaseMs;
    }
    if (!send(payload)) return;
    lastSentAgcRef.current = key;
  }, [basicInfo, connectionNonce, send, settings.agcSpeed, settings.agcAttackMs, settings.agcReleaseMs]);

  const startRecording = useCallback(() => {
    ensureAudioGraph();
    const dest = destRef.current;
    if (!dest) return;
    if (recorder) return;
    if (!('MediaRecorder' in window)) return;

    chunksRef.current = [];
    const mediaRecorder = new MediaRecorder(dest.stream);
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mediaRecorder.onstop = () => {
      setRecordedBlob(new Blob(chunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' }));
      chunksRef.current = [];
      setRecorder(null);
    };
    mediaRecorder.start();
    setRecorder(mediaRecorder);
    setRecordedBlob(null);
  }, [ensureAudioGraph, recorder]);

  const stopRecording = useCallback(() => {
    recorder?.stop();
  }, [recorder]);

  const downloadRecording = useCallback(() => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recording.webm';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [recordedBlob]);

  useEffect(() => {
    const interval = setInterval(() => {
      const ctx = audioCtxRef.current;
      const decoderConfig = decoderConfigRef.current;
      if (!ctx) return;

      setDebugStats({
        wireCodec: wireCodecForDebugStats.current,
        packetsReceived: packetsReceivedRef.current,
        packetsDropped: packetsDroppedRef.current,
        latencyControl: latencyControlRef.current,
        currentLatencyMs: Math.round(currentLatencyMsRef.current),
        targetLatencyMs: Math.round(getBufferMsForMode(settingsRef.current.bufferMode)),
        queuedSamples: pcmQueuedSamplesRef.current,
        bufferHealth: Math.min(10, currentLatencyMsRef.current / (targetLeadSecRef.current * 1000)),
        codecRate: decoderConfig?.codecRate ?? 0,
        outputRate: decoderConfig?.outputRate ?? 0,
      });
    }, 250);

    return () => clearInterval(interval);
  }, []);

  // Update target buffer when mode changes
  useEffect(() => {
    targetLeadSecRef.current = getBufferMsForMode(settings.bufferMode) / 1000;
  }, [settings.bufferMode]);

  return {
    status,
    error,
    pwrDb,
    needsUserGesture,
    isRecording: !!recorder,
    canDownload: !!recordedBlob,
    debugStats,
    gridLocator: basicInfo?.grid_locator ?? null,
    audioMaxSps: basicInfo?.audio_max_sps ?? null,
    startRecording,
    stopRecording,
    downloadRecording,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function normalizeAudioWindow(info: BasicInfo, w: AudioWindow): AudioWindow {
  const max = Math.max(0, info.fft_result_size - 1);
  const maxSpan = info.audio_max_fft;

  let l = clampInt(Math.floor(w.l), 0, max);
  let r = clampInt(Math.ceil(w.r), 0, max);
  const m = clampInt(Math.round(w.m), 0, max);

  if (r <= l) {
    if (l >= max) l = Math.max(0, max - 1);
    r = Math.min(max, l + 1);
  }

  if (maxSpan > 0 && r - l > maxSpan) {
    const half = Math.floor(maxSpan / 2);
    l = clampInt(m - half, 0, Math.max(0, max - maxSpan));
    r = l + maxSpan;
  }
  return { l, m, r };
}

function combineFrames(frames: Float32Array[]): Float32Array {
  const totalElements = frames.reduce((acc, x) => acc + x.length, 0);
  const res = new Float32Array(totalElements);
  let pos = 0;
  for (const frame of frames) {
    res.set(frame, pos);
    pos += frame.length;
  }
  return res;
}
