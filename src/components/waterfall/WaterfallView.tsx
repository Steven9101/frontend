import { decode as cborDecode } from 'cbor-x';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ZstdStreamDecoder } from '../../modules/novasdrdsp.js';
import { createPalette } from './colormaps';
import type { WaterfallSettings } from './protocol';
import type { WaterfallDisplaySettings } from './viewSettings';
import { useReconnectingWebSocket } from '../../lib/useReconnectingWebSocket';
import { useServerEvents } from '../../lib/useServerEvents';
import type { ReceiverMode } from '../../lib/receiverMode';

export type BandModeOverlay = { mode: ReceiverMode; startHz: number; endHz: number };
export type BandOverlay = { name: string; startHz: number; endHz: number; color?: string; modes?: BandModeOverlay[] };

type Props = {
  receiverId: string | null;
  bands: BandOverlay[];
  activeVfo?: 'A' | 'B';
  onConnecting: () => void;
  onConnected: (settings: WaterfallSettings) => void;
  onError: (message: string) => void;
  onSetFrequencyHz?: (hz: number) => void;
  onSetMode?: (mode: NonNullable<Props['mode']>) => void;
  display: WaterfallDisplaySettings;
  onDisplayChange: React.Dispatch<React.SetStateAction<WaterfallDisplaySettings>>;
  onPassbandChange?: (p: { l: number; m: number; r: number }) => void;
  onViewportChange?: (vp: { l: number; r: number }) => void;
  mode?: ReceiverMode;
  audioMaxSps?: number | null;
  frequencyAdjust?: { nonce: number; deltaHz: number } | null;
  frequencySet?: { nonce: number; centerHz: number } | null;
  bandwidthAdjust?: { nonce: number; deltaHz: number } | null;
  resetTune?: { nonce: number; vfo: 'A' | 'B' } | null;
  passbandSet?: { nonce: number; l: number; m: number; r: number } | null;
  viewportSet?: { nonce: number; l: number; r: number } | null;
  tuningStepHz: number;
  onTuningChange?: (t: { centerHz: number; bandwidthHz: number }) => void;
};

type Viewport = { l: number; r: number };

const DEFAULT_SCALE = 0.85;
const MIN_VIEWPORT_SPAN = 256;
const SCALE_LABEL_HEIGHT_WITH_BANDS_CSS = 54;
const WATERFALL_HEIGHT_CSS = 308;
const WATERFALL_HEIGHT_BIG_CSS = 468;
const SPECTRUM_HEIGHT_CSS = 140;
const MIN_PASSBAND_SPAN_IDX = 2;
const MIN_PASSBAND_VISUAL_PX = 14;
const AUTO_ADJUST_BUFFER_SAMPLES = 1024;
const AUTO_ADJUST_PADDING_DB = 20;
const AUTO_ADJUST_DAMPING = 0.18;
const AUTO_ADJUST_EMIT_INTERVAL_MS = 120;

export function WaterfallView({
  receiverId,
  bands,
  onConnected,
  onConnecting,
  onError,
  onSetFrequencyHz,
  onSetMode,
  activeVfo = 'A',
  display,
  onDisplayChange,
  onPassbandChange,
  onViewportChange,
  mode = 'USB',
  audioMaxSps,
  frequencyAdjust,
  frequencySet,
  bandwidthAdjust,
  resetTune,
  passbandSet,
  viewportSet,
  tuningStepHz,
  onTuningChange,
}: Props) {
  const serverEvents = useServerEvents();
  const serverEventsValue = serverEvents.kind === 'ready' ? serverEvents.value : null;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scaleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<ZstdStreamDecoder | null>(null);
  const closeWsRef = useRef<null | (() => void)>(null);
  const messageHandlerRef = useRef<(event: MessageEvent) => void>(() => undefined);
  const receiverIdRef = useRef<string | null>(receiverId);

  useEffect(() => {
    receiverIdRef.current = receiverId;
  }, [receiverId]);

  const settingsRef = useRef<WaterfallSettings | null>(null);
  const [settingsState, setSettingsState] = useState<WaterfallSettings | null>(null);
  const bandsRef = useRef<BandOverlay[]>(bands);
  const [markers, setMarkers] = useState<Array<{ frequencyHz: number; name: string; mode?: Props['mode']; bandwidthHz?: number }>>([]);
  const viewportRef = useRef<Viewport>({ l: 0, r: 0 });
  const modeRef = useRef<Props['mode']>('USB');
  const pointerStateRef = useRef<PointerState>({
    pointers: new Map(),
    dragLastClientX: null,
    pinchLastDistance: null,
  });
  const clickStateRef = useRef<null | { pointerId: number; startX: number; movedPx: number }>(null);
  const scaleDragRef = useRef<null | { pointerId: number; movedPx: number }>(null);
  const bgColorRef = useRef<string>('');
  const lastFrequencyNonceRef = useRef<number>(0);
  const lastBandwidthNonceRef = useRef<number>(0);
  const lastResetNonceByVfoRef = useRef<Record<'A' | 'B', number>>({ A: 0, B: 0 });
  const lastFrequencySetNonceRef = useRef<number>(0);
  const lastPassbandSetNonceRef = useRef<number>(0);
  const lastViewportSetNonceRef = useRef<number>(0);
  const setWaterfallRangeRef = useRef<(newL: number, newR: number) => void>(() => undefined);
  const expectedWindowRef = useRef<null | { l: number; r: number; atMs: number }>(null);
  const tuningCallbackRef = useRef<Props['onTuningChange']>(undefined);
  const viewportCallbackRef = useRef<Props['onViewportChange']>(undefined);

  const [isReady, setIsReady] = useState(false);
  const [hover, setHover] = useState<{ x: number; freqHz: number } | null>(null);
  const [passband, setPassband] = useState<Passband | null>(null);
  const [viewportState, setViewportState] = useState<Viewport>({ l: 0, r: 0 });

  const maxPassbandSpanIdx = null;
  const maxDragSpanIdx = useMemo(
    () => computeMaxPassbandSpanIdx(settingsState, audioMaxSps ?? null),
    [audioMaxSps, settingsState],
  );

  useEffect(() => {
    bandsRef.current = bands;
  }, [bands]);

  useEffect(() => {
    expectedWindowRef.current = null;
    lastFrequencyNonceRef.current = 0;
    lastBandwidthNonceRef.current = 0;
    lastResetNonceByVfoRef.current = { A: 0, B: 0 };
    lastFrequencySetNonceRef.current = 0;
    lastPassbandSetNonceRef.current = 0;
    lastViewportSetNonceRef.current = 0;
    setPassband(null);
    viewportRef.current = { l: 0, r: 0 };
    setViewportState({ l: 0, r: 0 });
    setMarkers([]);
    setIsReady(false);
    pointerStateRef.current = { pointers: new Map(), dragLastClientX: null, pinchLastDistance: null };
    clickStateRef.current = null;
    scaleDragRef.current = null;
    settingsRef.current = null;
    setSettingsState(null);
  }, [receiverId]);

  const markerLayout = useMemo(() => {
    const settings = settingsState;
    if (!settings) return null;
    const vp = viewportState;
    const freqL = idxToFreqHz(settings, vp.l);
    const freqR = idxToFreqHz(settings, vp.r);
    const span = freqR - freqL;
    if (span <= 0) return null;

    if (span > 3_500_000) return null;
    const visibleMarkers = markers.filter((m) => m.frequencyHz >= freqL && m.frequencyHz <= freqR);
    if (visibleMarkers.length === 0) return null;

    return { freqL, span, visibleMarkers };
  }, [markers, settingsState, viewportState]);

  const otherUsersLayout = useMemo(() => {
    const changes = serverEventsValue?.signal_changes;
    if (!changes) return null;

    const settings = settingsRef.current;
    const viewport = viewportRef.current;
    if (!settings || !viewport) return null;

    const idxToHz = (idx: number) => settings.basefreq + (idx / settings.fft_result_size) * settings.total_bandwidth;
    const freqL = idxToHz(viewport.l);
    const freqR = idxToHz(viewport.r);
    const span = freqR - freqL;
    if (!Number.isFinite(span) || span <= 0) return null;

    const prefix = `${receiverId}:`;
    let selfKey: string | null = null;
    try {
      const selfUniqueId = window.sessionStorage.getItem('novasdr.audio_unique_id');
      if (selfUniqueId) selfKey = `${receiverId}:${selfUniqueId}`;
    } catch {
      selfKey = null;
    }
    const pts: Array<{ key: string; hz: number }> = [];
    for (const [k, v] of Object.entries(changes)) {
      if (!k.startsWith(prefix)) continue;
      if (selfKey && k === selfKey) continue;
      const m = Array.isArray(v) ? Number(v[1]) : NaN;
      if (!Number.isFinite(m)) continue;
      const hz = idxToHz(m);
      if (!Number.isFinite(hz)) continue;
      if (hz < freqL || hz > freqR) continue;
      pts.push({ key: k, hz });
    }
    if (pts.length === 0) return null;

    // Keep it subtle: cap the number of indicators rendered.
    const MAX = 40;
    const display = pts.length > MAX ? pts.slice(0, MAX) : pts;

    return { freqL, span, display, remaining: Math.max(0, pts.length - display.length) };
  }, [receiverId, serverEventsValue, settingsState, viewportState]);

  const palette = useMemo(() => createPalette(display.colormap), [display.colormap]);
  const paletteRef = useRef<Uint32Array>(palette);
  const displayRef = useRef<WaterfallDisplaySettings>(display);
  const valueLutRef = useRef<Uint8Array>(new Uint8Array(256));
  const autoRangeRef = useRef<{ minDb: number; maxDb: number }>({ minDb: display.minDb, maxDb: display.maxDb });
  const autoStatsRef = useRef<{ min: number; max: number; count: number; lastEmitMs: number }>({
    min: Infinity,
    max: -Infinity,
    count: 0,
    lastEmitMs: 0,
  });

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);


  const lastModeForPassbandRef = useRef<Props['mode']>('USB');

  useEffect(() => {
    viewportCallbackRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    displayRef.current = display;
  }, [display]);

  useEffect(() => {
    paletteRef.current = palette;
  }, [palette]);

  const recomputeValueLut = useCallback((minDb: number, maxDb: number) => {
    const lut = valueLutRef.current;
    const lo = Math.min(minDb, maxDb - 1);
    const hi = Math.max(maxDb, lo + 1);
    const span = hi - lo;
    for (let b = 0; b < 256; b++) {
      const v = b - 128;
      const clamped = Math.min(hi, Math.max(lo, v));
      const t = span <= 0 ? 0 : (clamped - lo) / span;
      lut[b] = Math.max(0, Math.min(255, Math.floor(t * 255)));
    }
  }, []);

  useEffect(() => {
    autoRangeRef.current = { minDb: display.minDb, maxDb: display.maxDb };
    recomputeValueLut(display.minDb, display.maxDb);
  }, [display.autoAdjust, display.minDb, display.maxDb, recomputeValueLut]);

  useEffect(() => {
    autoStatsRef.current.min = Infinity;
    autoStatsRef.current.max = -Infinity;
    autoStatsRef.current.count = 0;
    autoStatsRef.current.lastEmitMs = 0;
  }, [display.autoAdjust]);

  useEffect(() => {
    tuningCallbackRef.current = onTuningChange;
  }, [onTuningChange]);

  useEffect(() => {
    const cb = tuningCallbackRef.current;
    const settings = settingsRef.current;
    if (!cb || !settings || !passband) return;
    const center = idxToFreqHz(settings, passband.m);
    const left = idxToFreqHz(settings, passband.l);
    const right = idxToFreqHz(settings, passband.r);
    cb({ centerHz: center, bandwidthHz: Math.max(0, right - left) });
  }, [mode, passband]);

  useEffect(() => {
    const settings = settingsRef.current;
    if (!settings || !passband || !onPassbandChange) return;
    onPassbandChange({ l: passband.l, m: passband.m, r: passband.r });
  }, [onPassbandChange, passband]);

  useEffect(() => {
    const settings = settingsRef.current;
    if (!settings || !passbandSet) return;
    if (passbandSet.nonce === lastPassbandSetNonceRef.current) return;
    lastPassbandSetNonceRef.current = passbandSet.nonce;
    setPassband(() => {
      const next = clampPassband(
        { l: passbandSet.l, m: passbandSet.m, r: passbandSet.r },
        settings,
        maxPassbandSpanIdx,
      );
      return normalizePassbandForMode(settings, next, maxPassbandSpanIdx);
    });
  }, [maxPassbandSpanIdx, passbandSet, settingsState]);

  useEffect(() => {
    const settings = settingsRef.current;
    if (!settings || !resetTune) return;
    if (resetTune.vfo !== activeVfo) return;
    if (resetTune.nonce === lastResetNonceByVfoRef.current[resetTune.vfo]) return;
    lastResetNonceByVfoRef.current[resetTune.vfo] = resetTune.nonce;
    setPassband(defaultPassband(settings, modeRef.current ?? 'USB', maxPassbandSpanIdx));
    setWaterfallRangeRef.current(0, settings.fft_result_size);
  }, [activeVfo, maxPassbandSpanIdx, resetTune, settingsState]);

  useEffect(() => {
    const settings = settingsRef.current;
    if (!settings || !frequencyAdjust) return;
    if (frequencyAdjust.nonce === lastFrequencyNonceRef.current) return;
    lastFrequencyNonceRef.current = frequencyAdjust.nonce;
    const span = viewportRef.current.r - viewportRef.current.l;
    setPassband((prev) => {
      if (!prev) return prev;
      const mode = modeRef.current ?? 'USB';
      const center = idxToFreqHz(settings, prev.m) + frequencyAdjust.deltaHz;
      const centerIdx = freqHzToIdx(settings, center);
      if (span > 0) {
        setWaterfallRangeRef.current(centerIdx - span / 2, centerIdx + span / 2);
      }
      return clampPassband(
        movePassbandToTuningCenterIdx(settings, prev, mode, centerIdx, maxPassbandSpanIdx),
        settings,
        maxPassbandSpanIdx,
      );
    });
  }, [frequencyAdjust, maxPassbandSpanIdx, settingsState]);

  useEffect(() => {
    const settings = settingsRef.current;
    if (!settings || !frequencySet) return;
    if (frequencySet.nonce === lastFrequencySetNonceRef.current) return;
    lastFrequencySetNonceRef.current = frequencySet.nonce;
    const span = viewportRef.current.r - viewportRef.current.l;
    setPassband((prev) => {
      const mode = modeRef.current ?? 'USB';
      const centerIdx = freqHzToIdx(settings, frequencySet.centerHz);
      if (!prev) {
        if (span > 0) setWaterfallRangeRef.current(centerIdx - span / 2, centerIdx + span / 2);
        return clampPassband(
          passbandFromCenter(settings, frequencySet.centerHz, mode),
          settings,
          maxPassbandSpanIdx,
        );
      }
      const isFullyZoomedOut = span >= Math.floor(settings.fft_result_size * 0.9);
      if (isFullyZoomedOut) {
        for (const band of bandsRef.current) {
          const bandCenter = (band.startHz + band.endHz) / 2;
          const freqDiff = Math.abs(frequencySet.centerHz - bandCenter);
          const bandWidth = band.endHz - band.startHz;
          if (freqDiff > bandWidth * 0.05) continue;
          
          const padHz = Math.max(2000, Math.round(bandWidth * 0.08));
          const targetL = freqHzToIdx(settings, band.startHz - padHz);
          const targetR = freqHzToIdx(settings, band.endHz + padHz);
          setWaterfallRangeRef.current(targetL, targetR);
          return clampPassband(
            movePassbandToTuningCenterIdx(settings, prev, mode, centerIdx, maxPassbandSpanIdx),
            settings,
            maxPassbandSpanIdx,
          );
        }
      }
      if (span > 0) setWaterfallRangeRef.current(centerIdx - span / 2, centerIdx + span / 2);
      return clampPassband(
        movePassbandToTuningCenterIdx(settings, prev, mode, centerIdx, maxPassbandSpanIdx),
        settings,
        maxPassbandSpanIdx,
      );
    });
  }, [frequencySet, maxPassbandSpanIdx, settingsState]);

  useEffect(() => {
    const settings = settingsRef.current;
    if (!settings || !bandwidthAdjust) return;
    if (bandwidthAdjust.nonce === lastBandwidthNonceRef.current) return;
    lastBandwidthNonceRef.current = bandwidthAdjust.nonce;
    const deltaHz = bandwidthAdjust.deltaHz;
    setPassband((prev) => {
      if (!prev) return prev;

      const centerHz = idxToFreqHz(settings, prev.m);
      let leftHz = idxToFreqHz(settings, prev.l);
      let rightHz = idxToFreqHz(settings, prev.r);
      const currentWidthHz = Math.max(0, rightHz - leftHz);

      const defaultSsbLowCutHzRaw = settings.defaults?.ssb_lowcut_hz ?? 100;
      const defaultSsbLowCutHz = Math.max(0, Math.floor(Number(defaultSsbLowCutHzRaw) || 0));

      const currentMode = modeRef.current ?? 'USB';
      if (currentMode === 'USB') {
        const inferredLowCutHz = Math.max(0, leftHz - centerHz);
        const lowCutHz = inferredLowCutHz > 0 ? inferredLowCutHz : defaultSsbLowCutHz;
        let nextWidthHz = currentWidthHz + deltaHz;
        if (nextWidthHz < 50) nextWidthHz = 50;
        leftHz = centerHz + lowCutHz;
        rightHz = leftHz + nextWidthHz;
      } else if (currentMode === 'LSB') {
        const inferredLowCutHz = Math.max(0, centerHz - rightHz);
        const lowCutHz = inferredLowCutHz > 0 ? inferredLowCutHz : defaultSsbLowCutHz;
        let nextWidthHz = currentWidthHz + deltaHz;
        if (nextWidthHz < 50) nextWidthHz = 50;
        rightHz = centerHz - lowCutHz;
        leftHz = rightHz - nextWidthHz;
      } else if (currentMode === 'CW') {
        // CW passband is offset from the carrier (BFO). Keep the tone center stable while resizing.
        const toneCenterHz = (leftHz + rightHz) / 2;
        let nextWidthHz = currentWidthHz + deltaHz;
        if (nextWidthHz < 50) nextWidthHz = 50;
        leftHz = toneCenterHz - nextWidthHz / 2;
        rightHz = toneCenterHz + nextWidthHz / 2;
        // Keep CW on the USB side of the carrier by default.
        if (leftHz < centerHz) {
          rightHz += centerHz - leftHz;
          leftHz = centerHz;
        }
      } else {
        let nextWidthHz = currentWidthHz + deltaHz;
        if (nextWidthHz < 50) nextWidthHz = 50;
        leftHz = centerHz - nextWidthHz / 2;
        rightHz = centerHz + nextWidthHz / 2;
      }

      const next: Passband = {
        l: freqHzToIdx(settings, leftHz),
        m: prev.m,
        r: freqHzToIdx(settings, rightHz),
      };
      return clampPassband(next, settings, maxPassbandSpanIdx);
    });
  }, [bandwidthAdjust, maxPassbandSpanIdx, settingsState]);

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = useMemo(() => `${proto}://${window.location.host}/waterfall`, [proto]);

  const onWsMessage = useCallback((event: MessageEvent) => {
    messageHandlerRef.current(event);
  }, []);

  const ws = useReconnectingWebSocket({
    source: 'waterfall',
    url: wsUrl,
    binaryType: 'arraybuffer',
    connectTimeoutMs: 6_000,
    onOpen: (socket) => {
      onConnecting();
      setSettingsState(null);
      setMarkers([]);
      setIsReady(false);
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
      onConnecting();
      setSettingsState(null);
      setMarkers([]);
      setIsReady(false);
    },
    onMessage: (ev) => onWsMessage(ev),
  });
  const sendJson = ws.sendJson;

  useEffect(() => {
    if (!receiverId) return;
    sendJson({ cmd: 'receiver', receiver_id: receiverId });
  }, [receiverId, sendJson]);

  useEffect(() => {
    closeWsRef.current = ws.close;
  }, [ws.close]);

  const sendWindow = useCallback((vp: Viewport) => {
    const l = Math.round(vp.l);
    const r = Math.round(vp.r);
    expectedWindowRef.current = { l, r, atMs: performance.now() };
    sendJson({ cmd: 'window', l, r });
  }, [sendJson]);

  const drawScale = useCallback(() => {
    const settings = settingsRef.current;
    const vp = viewportRef.current;
    const canvas = scaleCanvasRef.current;
    const container = containerRef.current;
    if (!settings || !canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const widthPx = Math.max(1, Math.floor(container.clientWidth * dpr));
    const heightPx = Math.max(1, Math.floor(SCALE_LABEL_HEIGHT_WITH_BANDS_CSS * dpr));

    if (canvas.width !== widthPx || canvas.height !== heightPx) {
      canvas.width = widthPx;
      canvas.height = heightPx;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, widthPx, heightPx);
    ctx.fillStyle = 'rgba(0,0,0,0)';

    const freqL = idxToFreqHz(settings, vp.l);
    const freqR = idxToFreqHz(settings, vp.r);
    const span = freqR - freqL;
    if (span <= 0) return;

    const tick = cssHsl('--border', '214.3 31.8% 91.4%');
    const text = cssHsl('--muted-foreground', '215.4 16.3% 46.9%');
    ctx.strokeStyle = `hsl(${tick} / 0.55)`;
    ctx.fillStyle = `hsl(${text} / 0.9)`;
    ctx.lineWidth = Math.max(1, Math.floor(dpr));
    ctx.font = `${Math.max(10, Math.floor(11 * dpr))}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textBaseline = 'top';

    drawBandPlan(ctx, { bands: bandsRef.current, settings, vp, widthPx, dpr });

    const majorTickTargetPx = Math.max(90, Math.floor(120 * dpr));
    const majorCount = Math.max(2, Math.floor(widthPx / majorTickTargetPx));
    const majorStepHz = niceTickStepHz(span / majorCount);
    const minorStepHz = majorStepHz / 5;

    // Axis: ticks and labels live at the top.
    const labelTop = Math.floor(2 * dpr);
    const axisTop = Math.floor(16 * dpr);
    const majorBottom = axisTop + Math.floor(12 * dpr);
    const minorBottom = axisTop + Math.floor(7 * dpr);

    // Minor ticks
    if (minorStepHz > 0) {
      const firstMinor = Math.ceil(freqL / minorStepHz) * minorStepHz;
      for (let hz = firstMinor; hz <= freqR + minorStepHz * 0.25; hz += minorStepHz) {
        // Skip where a major tick will be drawn.
        const isMajor = Math.abs((hz / majorStepHz) - Math.round(hz / majorStepHz)) < 1e-9;
        if (isMajor) continue;
        const x = Math.round(((hz - freqL) / span) * widthPx);
        if (x < 0 || x > widthPx) continue;
      ctx.beginPath();
        ctx.moveTo(x + 0.5, axisTop);
        ctx.lineTo(x + 0.5, minorBottom);
      ctx.stroke();
      }
    }

    // Major ticks + labels
    if (majorStepHz > 0) {
      const firstMajor = Math.ceil(freqL / majorStepHz) * majorStepHz;
      for (let hz = firstMajor; hz <= freqR + majorStepHz * 0.25; hz += majorStepHz) {
        const x = Math.round(((hz - freqL) / span) * widthPx);
        if (x < 0 || x > widthPx) continue;
        ctx.beginPath();
        ctx.moveTo(x + 0.5, axisTop);
        ctx.lineTo(x + 0.5, majorBottom);
        ctx.stroke();

      const label = formatFreq(hz);
      const w = ctx.measureText(label).width;
      const lx = clamp(Math.round(x - w / 2), 0, widthPx - Math.round(w));
        ctx.fillText(label, lx, labelTop);
      }
    }
  }, []);

  const resizeCanvases = useCallback(() => {
    const settings = settingsRef.current;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!settings || !container || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const widthPx = Math.max(1, Math.floor(container.clientWidth * dpr));
    const heightCss = displayRef.current.biggerWaterfall ? WATERFALL_HEIGHT_BIG_CSS : WATERFALL_HEIGHT_CSS;
    const heightPx = Math.max(1, Math.floor(heightCss * dpr));

    if (canvas.width !== widthPx || canvas.height !== heightPx) {
      canvas.width = widthPx;
      canvas.height = heightPx;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
      }
    }

    if (!scratchRef.current) {
      scratchRef.current = document.createElement('canvas');
    }
    if (scratchRef.current.width !== widthPx || scratchRef.current.height !== heightPx) {
      scratchRef.current.width = widthPx;
      scratchRef.current.height = heightPx;
      const ctx = scratchRef.current.getContext('2d');
      if (ctx) ctx.imageSmoothingEnabled = false;
    }

    const spectrum = spectrumCanvasRef.current;
    if (spectrum) {
      const spectrumHeightPx = Math.max(1, Math.floor(SPECTRUM_HEIGHT_CSS * dpr));
      if (spectrum.width !== widthPx || spectrum.height !== spectrumHeightPx) {
        spectrum.width = widthPx;
        spectrum.height = spectrumHeightPx;
        const ctx = spectrum.getContext('2d');
        if (ctx) ctx.imageSmoothingEnabled = false;
      }
    }

    drawScale();
  }, [drawScale]);

  useEffect(() => {
    resizeCanvases();
  }, [display.biggerWaterfall, resizeCanvases]);

  useEffect(() => {
    resizeCanvases();
  }, [display.spectrumOverlay, resizeCanvases]);

  const setWaterfallRange = useCallback(
    (newL: number, newR: number) => {
      const settings = settingsRef.current;
      const canvas = canvasRef.current;
      if (!settings || !canvas) return;
      if (newL >= newR) return;

      const width = newR - newL;
      const max = settings.fft_result_size;
      if (newL < 0 && newR > max) {
        newL = 0;
        newR = max;
      } else if (newL < 0) {
        newL = 0;
        newR = width;
      } else if (newR > max) {
        newR = max;
        newL = newR - width;
      }

      const prev = viewportRef.current;
      viewportRef.current = { l: newL, r: newR };
      setViewportState(viewportRef.current);
      const cb = viewportCallbackRef.current;
      if (cb) cb({ l: viewportRef.current.l, r: viewportRef.current.r });

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingEnabled = false;
        const bg = bgColorRef.current || getComputedStyle(document.body).backgroundColor;
        bgColorRef.current = bg;

        const scratch = scratchRef.current;
        const scratchCtx = scratch?.getContext('2d') ?? null;
        if (scratch && scratchCtx) {
          scratchCtx.imageSmoothingEnabled = false;
          scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
          scratchCtx.drawImage(canvas, 0, 0);
        }

        const spanNew = viewportRef.current.r - viewportRef.current.l;
        const newX1 = idxToCanvasX(prev.l, viewportRef.current, canvas.width);
        const newX2 = idxToCanvasX(prev.r, viewportRef.current, canvas.width);
        const newCanvasWidth = newX2 - newX1;
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (newCanvasWidth > 1 && scratchRef.current) {
          ctx.drawImage(scratchRef.current, 0, 0, canvas.width, canvas.height, newX1, 0, newCanvasWidth, canvas.height);
        }

        const spanPrev = prev.r - prev.l;
        if (spanPrev <= spanNew + 1) {
          const leftW = clamp(newX1, 0, canvas.width);
          const rightX = clamp(newX2, 0, canvas.width);
          ctx.fillRect(0, 0, leftW, canvas.height);
          ctx.fillRect(rightX, 0, canvas.width - rightX, canvas.height);
        }
      }

      drawScale();
      sendWindow(viewportRef.current);
    },
    [drawScale, sendWindow],
  );

  useEffect(() => {
    setWaterfallRangeRef.current = setWaterfallRange;
  }, [setWaterfallRange]);

  useEffect(() => {
    const settings = settingsRef.current;
    if (!settings || !viewportSet) return;
    if (viewportSet.nonce === lastViewportSetNonceRef.current) return;
    lastViewportSetNonceRef.current = viewportSet.nonce;
    // If r is set to fft_result_size, treat as "reset to full span"
    const r = viewportSet.r === 524288 || viewportSet.r >= settings.fft_result_size 
      ? settings.fft_result_size 
      : viewportSet.r;
    setWaterfallRange(viewportSet.l, r);
  }, [setWaterfallRange, viewportSet, settingsState]);

  const zoomAt = useCallback(
    (xCss: number, zoomAmount: number, scaleAmount?: number) => {
      const settings = settingsRef.current;
      const canvas = canvasRef.current;
      if (!settings || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const span = viewportRef.current.r - viewportRef.current.l;
      if (span <= MIN_VIEWPORT_SPAN && zoomAmount < 0) return;

      const scale = scaleAmount ?? DEFAULT_SCALE;
      const x = clamp(xCss, 0, rect.width);

      const l = viewportRef.current.l;
      const r = viewportRef.current.r;

      const center = l + (x / rect.width) * (r - l);
      let widthL = center - l;
      let widthR = r - center;

      if (zoomAmount < 0) {
        widthL *= scale;
        widthR *= scale;
      } else if (zoomAmount > 0) {
        widthL *= 1 / scale;
        widthR *= 1 / scale;
      }

      const nextL = center - widthL;
      const nextR = center + widthR;
      setWaterfallRange(nextL, nextR);
    },
    [setWaterfallRange],
  );

  useEffect(() => {
    let raf: number | null = null;
    let row: ImageData | null = null;
    let rowBytes: Uint8ClampedArray | null = null;
    let pending: Array<{ l: number; r: number; data: Int8Array }> = [];

    const observeAutoRange = (data: Int8Array) => {
      const d = displayRef.current;
      if (!d.autoAdjust) return;

      const stats = autoStatsRef.current;
      const step = Math.max(1, Math.floor(data.length / 512));
      for (let i = 0; i < data.length; i += step) {
        const v = data[i];
        stats.min = Math.min(stats.min, v);
        stats.max = Math.max(stats.max, v);
        stats.count++;
      }

      if (stats.count < AUTO_ADJUST_BUFFER_SAMPLES) return;
      stats.count = 0;

      const targetMin = stats.min - AUTO_ADJUST_PADDING_DB;
      const targetMax = stats.max + AUTO_ADJUST_PADDING_DB;
      stats.min = Infinity;
      stats.max = -Infinity;

      const prev = autoRangeRef.current;
      const nextMin = prev.minDb + (targetMin - prev.minDb) * AUTO_ADJUST_DAMPING;
      const nextMaxRaw = prev.maxDb + (targetMax - prev.maxDb) * AUTO_ADJUST_DAMPING;
      const nextMax = Math.max(nextMaxRaw, nextMin + 1);

      autoRangeRef.current = { minDb: nextMin, maxDb: nextMax };
      recomputeValueLut(nextMin, nextMax);

      const now = performance.now();
      if (now - stats.lastEmitMs < AUTO_ADJUST_EMIT_INTERVAL_MS) return;
      stats.lastEmitMs = now;

      onDisplayChange((cur) =>
        cur.autoAdjust ? { ...cur, minDb: autoRangeRef.current.minDb, maxDb: autoRangeRef.current.maxDb } : cur,
      );
    };

    const drawSpectrum = (pkt: { l: number; r: number; data: Int8Array }) => {
      const d = displayRef.current;
      if (!d.spectrumOverlay) return;
      const canvas = spectrumCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const range = d.autoAdjust ? autoRangeRef.current : { minDb: d.minDb, maxDb: d.maxDb };
      const lo = Math.min(range.minDb, range.maxDb - 1);
      const hi = Math.max(range.maxDb, lo + 1);
      const span = hi - lo;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const plotHeight = canvas.height;
      ctx.lineWidth = Math.max(1, Math.floor((window.devicePixelRatio || 1) * 1.5));
      ctx.strokeStyle = 'rgba(3, 157, 252, 0.85)';
      ctx.fillStyle = 'rgba(3, 157, 252, 0.18)';

      ctx.beginPath();
      const w = canvas.width;
      const data = pkt.data;
      const sourceWidth = data.length;
      const fullSpan = pkt.r - pkt.l;
      if (sourceWidth <= 0 || fullSpan <= 0) return;
      const downsample = Math.max(1, Math.round(fullSpan / sourceWidth));
      const vp = viewportRef.current;
      const vpSpan = vp.r - vp.l;
      
      for (let x = 0; x < w; x++) {
        const binIdx = vp.l + (x * vpSpan) / w;
        const relBins = binIdx - pkt.l;
        const src =
          relBins >= 0 && binIdx < pkt.r
            ? data[Math.min(sourceWidth - 1, Math.floor(relBins / downsample))]
            : lo;
        const clamped = Math.min(hi, Math.max(lo, src));
        const valueT = span <= 0 ? 0 : (clamped - lo) / span;
        const y = plotHeight - valueT * plotHeight;
        if (x === 0) ctx.moveTo(x + 0.5, y);
        else ctx.lineTo(x + 0.5, y);
      }
      ctx.lineTo(w, plotHeight);
      ctx.lineTo(0, plotHeight);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const binIdx = vp.l + (x * vpSpan) / w;
        const relBins = binIdx - pkt.l;
        const src =
          relBins >= 0 && binIdx < pkt.r
            ? data[Math.min(sourceWidth - 1, Math.floor(relBins / downsample))]
            : lo;
        const clamped = Math.min(hi, Math.max(lo, src));
        const valueT = span <= 0 ? 0 : (clamped - lo) / span;
        const y = plotHeight - valueT * plotHeight;
        if (x === 0) ctx.moveTo(x + 0.5, y);
        else ctx.lineTo(x + 0.5, y);
      }
      ctx.stroke();
    };

    const flush = () => {
      raf = null;
      const settings = settingsRef.current;
      const canvas = canvasRef.current;
      if (!settings || !canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (!row || row.width !== canvas.width) {
        row = ctx.createImageData(canvas.width, 1);
        rowBytes = row.data;
      }
      if (!rowBytes) return;

      const scratch = scratchRef.current;
      const scratchCtx = scratch?.getContext('2d') ?? null;
      if (scratch && scratchCtx && (scratch.width !== canvas.width || scratch.height !== canvas.height)) {
        scratch.width = canvas.width;
        scratch.height = canvas.height;
      }

      for (const pkt of pending) {
        // Newest row goes at the bottom: waterfall scrolls bottom -> top.
        if (scratch && scratchCtx) {
          scratchCtx.clearRect(0, 0, scratch.width, scratch.height);
          scratchCtx.drawImage(canvas, 0, 0);
          ctx.drawImage(scratch, 0, 1, canvas.width, canvas.height - 1, 0, 0, canvas.width, canvas.height - 1);
        } else {
          ctx.drawImage(canvas, 0, 1, canvas.width, canvas.height - 1, 0, 0, canvas.width, canvas.height - 1);
        }

        const w = canvas.width;
        const data = pkt.data;
        const sourceWidth = data.length;
        const fullSpan = pkt.r - pkt.l;
        if (sourceWidth <= 0 || fullSpan <= 0) continue;
        const downsample = Math.max(1, Math.round(fullSpan / sourceWidth));
        const palette = paletteRef.current;
        const lut = valueLutRef.current;
        const vp = viewportRef.current;
        const vpSpan = vp.r - vp.l;
        
        for (let x = 0; x < w; x++) {
          const binIdx = vp.l + (x * vpSpan) / w;
          const relBins = binIdx - pkt.l;
          const src =
            relBins >= 0 && binIdx < pkt.r
              ? data[Math.min(sourceWidth - 1, Math.floor(relBins / downsample))]
              : -128;
          const idx = lut[(src + 128) & 0xff];
          const c = palette[idx];
          const p = x * 4;
          rowBytes[p] = (c >> 24) & 0xff;
          rowBytes[p + 1] = (c >> 16) & 0xff;
          rowBytes[p + 2] = (c >> 8) & 0xff;
          rowBytes[p + 3] = c & 0xff;
        }

        ctx.putImageData(row, 0, canvas.height - 1);
        drawSpectrum(pkt);
      }
      pending = [];
    };

    const scheduleFlush = () => {
      if (raf !== null) return;
      raf = window.requestAnimationFrame(flush);
    };

    const handleMessage = (event: MessageEvent) => {
      if (typeof event.data === 'string') {
        try {
          const raw = JSON.parse(event.data) as WaterfallSettings;
          validateSettings(raw);
          const desiredReceiverId = receiverIdRef.current;
          if (desiredReceiverId && raw.receiver_id && raw.receiver_id !== desiredReceiverId) {
            return;
          }
          settingsRef.current = raw;
          setSettingsState(raw);

          try {
            decoderRef.current?.free();
          } catch {
            // ignore
          }
          decoderRef.current = new ZstdStreamDecoder();

          resizeCanvases();
          window.requestAnimationFrame(() => resizeCanvases());
          window.setTimeout(() => resizeCanvases(), 0);

          viewportRef.current = { l: 0, r: raw.fft_result_size };
          setViewportState(viewportRef.current);
          sendWindow(viewportRef.current);
          drawScale();

          // Parse markers.json payload (stringified JSON) from settings.
          // Markers.json format supports both verbose and short keys:
          // { "markers": [{ frequency|f, name|d|description, mode|m|modulation, bandwidthHz|bwHz|bw }, ...] }
          try {
            const parsed = JSON.parse(String((raw as unknown as { markers?: string }).markers ?? '{}')) as unknown;
              const obj = parsed as { markers?: Array<{ frequency?: unknown; name?: unknown; mode?: unknown; bandwidthHz?: unknown; bwHz?: unknown; bw?: unknown }> };
              if (!Array.isArray(obj.markers)) {
                setMarkers([]);
              } else {
              const next: Array<{ frequencyHz: number; name: string; mode?: Props['mode']; bandwidthHz?: number }> = [];
              for (const m of obj.markers) {
                const mm = m as unknown as {
                  frequency?: unknown;
                  f?: unknown;
                  name?: unknown;
                  d?: unknown;
                  description?: unknown;
                  mode?: unknown;
                  m?: unknown;
                  modulation?: unknown;
                  bandwidthHz?: unknown;
                  bwHz?: unknown;
                  bw?: unknown;
                };
                const frequencyValue = mm.frequency ?? mm.f;
                const nameValue = mm.name ?? mm.d ?? mm.description;
                const modeValue = mm.mode ?? mm.m ?? mm.modulation;
                const bwValue = mm.bandwidthHz ?? mm.bwHz ?? mm.bw;

                const frequencyHz = typeof frequencyValue === 'number' ? frequencyValue : Number(frequencyValue);
                const name = typeof nameValue === 'string' ? nameValue : String(nameValue ?? '').trim();
                const modeRaw = typeof modeValue === 'string' ? modeValue : String(modeValue ?? '').trim();
                const modeUpper = modeRaw ? modeRaw.toUpperCase() : '';
                const mode =
                  modeUpper === 'USB' || modeUpper === 'LSB' || modeUpper === 'CW' || modeUpper === 'AM' || modeUpper === 'SAM' || modeUpper === 'FM' || modeUpper === 'FMC' || modeUpper === 'WBFM'
                    ? (modeUpper as Props['mode'])
                    : undefined;

                const bandwidthHz = parseBandwidthHz(bwValue);
                if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) continue;
                if (!name) continue;
                next.push({ frequencyHz: Math.round(frequencyHz), name, mode, bandwidthHz: bandwidthHz ?? undefined });
              }
              next.sort((a, b) => a.frequencyHz - b.frequencyHz);
              setMarkers(next);
            }
          } catch {
            setMarkers([]);
          }

          setIsReady(true);
          onConnected(raw);

          const maxSpanIdx = null;
          setPassband((prev) => {
            if (prev) return prev;
            const d = raw.defaults;
            if (
              d &&
              typeof d.l === 'number' &&
              typeof d.m === 'number' &&
              typeof d.r === 'number' &&
              d.l >= 0 &&
              d.r >= d.l &&
              d.r <= raw.fft_result_size
            ) {
              return clampPassband({ l: d.l, m: d.m, r: d.r }, raw, maxSpanIdx);
            }
            return defaultPassband(raw, modeRef.current ?? 'USB', maxSpanIdx);
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'invalid settings payload';
          onError(msg);
          closeWsRef.current?.();
        }
        return;
      }

      if (!(event.data instanceof ArrayBuffer)) return;
      const decoder = decoderRef.current;
      if (!decoder) return;

      let outputs: Uint8Array[];
      try {
        outputs = decoder.decode(new Uint8Array(event.data));
      } catch {
        try {
          decoderRef.current?.free();
        } catch {
          // ignore
        }
        decoderRef.current = new ZstdStreamDecoder();
        return;
      }

      for (const output of outputs) {
        let pkt: { l: number; r: number; data: Uint8Array };
        try {
          pkt = cborDecode(output) as { l: number; r: number; data: Uint8Array };
        } catch {
          continue;
        }
        const data = new Int8Array(pkt.data.buffer, pkt.data.byteOffset, pkt.data.byteLength);
        observeAutoRange(data);
        pending.push({ l: pkt.l, r: pkt.r, data });
      }
      scheduleFlush();
    };

    messageHandlerRef.current = handleMessage;

    return () => {
      messageHandlerRef.current = () => undefined;
      if (raf !== null) window.cancelAnimationFrame(raf);
      try {
        decoderRef.current?.free();
      } catch {
        // ignore
      }
      decoderRef.current = null;
      settingsRef.current = null;
      viewportRef.current = { l: 0, r: 0 };
    };
  }, [drawScale, onConnected, onDisplayChange, onError, recomputeValueLut, resizeCanvases, sendWindow]);

  useEffect(() => {
    const settings = settingsRef.current;
    if (!settings) return;
    lastModeForPassbandRef.current = mode;
    setPassband((prev) => {
      if (!prev) return defaultPassband(settings, mode, maxPassbandSpanIdx);
      const centerHz = idxToFreqHz(settings, prev.m);
      return clampPassband(
        passbandFromCenter(settings, centerHz, mode),
        settings,
        maxPassbandSpanIdx,
      );
    });
  }, [maxPassbandSpanIdx, mode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => resizeCanvases());
    ro.observe(container);
    window.addEventListener('resize', resizeCanvases);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', resizeCanvases);
    vv?.addEventListener('scroll', resizeCanvases);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', resizeCanvases);
      vv?.removeEventListener('resize', resizeCanvases);
      vv?.removeEventListener('scroll', resizeCanvases);
    };
  }, [resizeCanvases]);

  useEffect(() => {
    const root = document.documentElement;
    const mo = new MutationObserver(() => {
      bgColorRef.current = '';
      drawScale();
    });
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, [drawScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      if (!isReady) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      zoomAt(x, e.deltaY);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [isReady, zoomAt]);

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!isReady) return;
      e.currentTarget.setPointerCapture(e.pointerId);

      const ps = pointerStateRef.current;
      ps.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ps.pointers.size === 1) {
        ps.dragLastClientX = e.clientX;
        ps.pinchLastDistance = null;
        clickStateRef.current = { pointerId: e.pointerId, startX: e.clientX, movedPx: 0 };
      }
      if (ps.pointers.size === 2) {
        const pts = Array.from(ps.pointers.values());
        ps.pinchLastDistance = distance(pts[0], pts[1]);
        ps.dragLastClientX = null;
        clickStateRef.current = null;
      }
    },
    [isReady],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const settings = settingsRef.current;
      const canvas = canvasRef.current;
      if (!settings || !canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const freqHz = idxToFreqHz(settings, canvasXToIdx(x, rect.width, viewportRef.current));
      setHover({ x, freqHz });

      const ps = pointerStateRef.current;
      ps.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (!isReady) return;

      const click = clickStateRef.current;
      if (click && click.pointerId === e.pointerId) {
        click.movedPx = Math.max(click.movedPx, Math.abs(e.clientX - click.startX));
      }

      if (ps.pointers.size === 1 && ps.dragLastClientX !== null) {
        const movementX = e.clientX - ps.dragLastClientX;
        ps.dragLastClientX = e.clientX;
        const span = viewportRef.current.r - viewportRef.current.l;
        const frequencyMovement = (movementX * span) / rect.width;
        setWaterfallRange(
          viewportRef.current.l - frequencyMovement,
          viewportRef.current.r - frequencyMovement,
        );
        return;
      }

      if (ps.pointers.size >= 2) {
        const pts = Array.from(ps.pointers.values());
        const d = distance(pts[0], pts[1]);
        if (ps.pinchLastDistance === null) {
          ps.pinchLastDistance = d;
          return;
        }
        if (ps.pinchLastDistance <= 0) {
          ps.pinchLastDistance = d;
          return;
        }
        const ratio = d / ps.pinchLastDistance;
        ps.pinchLastDistance = d;

        const centerX = (pts[0].x + pts[1].x) / 2 - rect.left;
        if (ratio > 1.01) {
          zoomAt(centerX, -1, clamp(1 / ratio, 0.6, 0.95));
        } else if (ratio < 0.99) {
          zoomAt(centerX, 1, clamp(ratio, 0.6, 0.95));
        }
      }
    },
    [isReady, setWaterfallRange, zoomAt],
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const settings = settingsRef.current;
    const canvas = canvasRef.current;
    if (settings && canvas) {
      const click = clickStateRef.current;
      if (click && click.pointerId === e.pointerId && click.movedPx < 3) {
        const rect = canvas.getBoundingClientRect();
        const x = clamp(e.clientX - rect.left, 0, rect.width);
        setPassband((prev) => {
          if (!prev) return prev;
          const centerIdx = canvasXToIdx(x, rect.width, viewportRef.current);
          const activeMode = modeRef.current ?? mode;
          return movePassbandToTuningCenterIdx(
            settings,
            prev,
            activeMode,
            centerIdx,
            maxPassbandSpanIdx,
          );
        });
      }
    }
    if (clickStateRef.current?.pointerId === e.pointerId) clickStateRef.current = null;

    const ps = pointerStateRef.current;
    ps.pointers.delete(e.pointerId);
    if (ps.pointers.size === 0) {
      ps.dragLastClientX = null;
      ps.pinchLastDistance = null;
      return;
    }
    if (ps.pointers.size === 1) {
      const pt = Array.from(ps.pointers.values())[0];
      ps.dragLastClientX = pt.x;
      ps.pinchLastDistance = null;
    }
    if (ps.pointers.size >= 2) {
      const pts = Array.from(ps.pointers.values());
      ps.dragLastClientX = null;
      ps.pinchLastDistance = distance(pts[0], pts[1]);
    }
  }, [maxPassbandSpanIdx, mode]);

  const handleScalePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const settings = settingsRef.current;
      const canvas = canvasRef.current;
      if (!isReady || !settings || !canvas) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      scaleDragRef.current = { pointerId: e.pointerId, movedPx: 0 };
      setPassband((prev) => {
        if (!prev) return prev;
        const rect = canvas.getBoundingClientRect();
        const x = clamp(e.clientX - rect.left, 0, rect.width);
        const centerIdx = canvasXToIdx(x, rect.width, viewportRef.current);
        return movePassbandToTuningCenterIdx(
          settings,
          prev,
          modeRef.current ?? mode,
          centerIdx,
          maxPassbandSpanIdx,
        );
      });
      e.preventDefault();
    },
    [isReady, maxPassbandSpanIdx, mode],
  );

  const handleScalePointerMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const settings = settingsRef.current;
    const canvas = canvasRef.current;
    const drag = scaleDragRef.current;
    if (!settings || !canvas || !drag) return;
    if (drag.pointerId !== e.pointerId) return;

    const rect = canvas.getBoundingClientRect();
    drag.movedPx = Math.max(drag.movedPx, Math.abs(e.movementX));

    setPassband((prev) => {
      if (!prev) return prev;
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const centerIdx = canvasXToIdx(x, rect.width, viewportRef.current);
      return movePassbandToTuningCenterIdx(
        settings,
        prev,
        modeRef.current ?? 'USB',
        centerIdx,
        maxPassbandSpanIdx,
      );
    });
  }, [maxPassbandSpanIdx]);

  const handleScalePointerUp = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = scaleDragRef.current;
    if (!drag) return;
    if (drag.pointerId !== e.pointerId) return;
    scaleDragRef.current = null;
  }, []);

  return (
    <div ref={containerRef} className="relative w-full select-none">
      {display.spectrumOverlay ? (
        <div className="border-b bg-muted/15">
          <canvas
            ref={spectrumCanvasRef}
            className="block w-full"
            style={{ height: `${SPECTRUM_HEIGHT_CSS}px` }}
            aria-label="Spectrum"
          />
        </div>
      ) : null}

      <canvas
        ref={canvasRef}
        className="block w-full touch-none"
        style={{ height: `${display.biggerWaterfall ? WATERFALL_HEIGHT_BIG_CSS : WATERFALL_HEIGHT_CSS}px` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHover(null)}
        aria-label="Waterfall display"
      />

      <div className="relative border-t bg-background">
        {passband ? (
          <PassbandTunerBar
            viewport={viewportState}
            settingsRef={settingsRef}
            passband={passband}
            setPassband={setPassband}
            mode={mode}
            maxSpanIdx={maxDragSpanIdx}
            tuningStepHz={tuningStepHz}
          />
        ) : null}
        <div className="relative">
          <canvas
            className="block w-full touch-none"
            style={{ height: `${SCALE_LABEL_HEIGHT_WITH_BANDS_CSS}px` }}
            ref={scaleCanvasRef}
            aria-hidden="true"
            onPointerDown={handleScalePointerDown}
            onPointerMove={handleScalePointerMove}
            onPointerUp={handleScalePointerUp}
            onPointerCancel={handleScalePointerUp}
          />

          {/* Markers.json markers */}
          {markerLayout ? (
              <div
                className="pointer-events-none absolute inset-x-0 overflow-visible"
                // Place markers in the same top axis area as the ticks (no separate background bar).
                style={{ top: '16px', height: '14px' }}
              >
                <div className="relative h-[14px] w-full">
                {markerLayout.visibleMarkers.map((m) => {
                  const xPct = ((m.frequencyHz - markerLayout.freqL) / markerLayout.span) * 100;
                    return (
                      <button
                        key={`${m.frequencyHz}-${m.name}`}
                        type="button"
                        className="pointer-events-auto absolute top-0 h-[14px] p-0 group"
                        style={{ left: `${xPct}%` }}
                        onClick={() => {
                          if (m.mode) onSetMode?.(m.mode);
                          onSetFrequencyHz?.(m.frequencyHz);
                          if (m.bandwidthHz != null && m.bandwidthHz > 0) {
                            const settings = settingsRef.current;
                            if (settings) {
                              const modeForWindow = m.mode ?? (modeRef.current ?? 'USB');
                              setPassband(
                                clampPassband(
                                  passbandFromCenterWithSpan(
                                    settings,
                                    m.frequencyHz,
                                    modeForWindow,
                                    m.bandwidthHz,
                                  ),
                                  settings,
                                  maxPassbandSpanIdx,
                                ),
                              );
                            }
                          }
                        }}
                        aria-label={`Marker: ${m.name}`}
                      >
                        <div
                          className="absolute top-0 z-0 h-[12px] w-px bg-yellow-500/80 shadow-[0_0_3px_rgba(250,204,21,0.45)] transition-shadow duration-300 group-hover:shadow-[0_0_6px_rgba(250,204,21,0.7)]"
                          aria-hidden="true"
                        />
                        <div
                          className="absolute top-[-2px] left-2 z-10 max-w-[180px] overflow-hidden whitespace-nowrap rounded-md border border-yellow-600/40 bg-background/90 px-2 py-0.5 text-left text-[11px] font-medium text-amber-700 shadow-sm backdrop-blur-sm transition-all duration-300 ease-out dark:text-yellow-300 group-hover:z-20 group-hover:max-w-[360px] group-hover:shadow-md"
                          title={m.name}
                        >
                          {m.name}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
          ) : null}

          {/* Other users: subtle tuning indicators (if enabled server-side). */}
          {otherUsersLayout ? (
            <div className="pointer-events-none absolute inset-x-0" style={{ top: '2px', height: '10px' }}>
              <div className="relative h-[10px] w-full">
                {otherUsersLayout.display.map((p) => {
                  const xPct = ((p.hz - otherUsersLayout.freqL) / otherUsersLayout.span) * 100;
                  return (
                    <div
                      key={p.key}
                      className="absolute top-0 h-[10px] w-[2px] bg-indigo-600/80 shadow-[0_0_0_1px_rgba(0,0,0,0.35),0_0_6px_rgba(79,70,229,0.35)] dark:bg-indigo-300/60 dark:shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_0_8px_rgba(129,140,248,0.25)]"
                      style={{ left: `${xPct}%` }}
                      aria-hidden="true"
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>

        {/* Hover marker (not markers.json): show in the header area, not over the waterfall. */}
        {hover ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20" style={{ height: `${22 + SCALE_LABEL_HEIGHT_WITH_BANDS_CSS}px` }}>
            <div className="absolute inset-y-0 w-px bg-foreground/20" style={{ left: `${hover.x}px` }} />
            <div
              className="absolute -translate-x-1/2 rounded-md border bg-background/95 px-2 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm"
              style={{ left: `${hover.x}px`, top: '4px' }}
            >
              {formatFreq(hover.freqHz)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type PointerState = {
  pointers: Map<number, { x: number; y: number }>;
  dragLastClientX: number | null;
  pinchLastDistance: number | null;
};

type Passband = {
  l: number;
  m: number;
  r: number;
};

function computeMaxPassbandSpanIdx(
  settings: WaterfallSettings | null,
  audioMaxSps: number | null,
): number | null {
  if (!settings) return null;
  if (audioMaxSps == null || !Number.isFinite(audioMaxSps) || audioMaxSps <= 0) {
    return null;
  }
  const spanHz = Math.min(audioMaxSps, settings.total_bandwidth);
  const spanIdx = (spanHz / settings.total_bandwidth) * settings.fft_result_size;
  if (!Number.isFinite(spanIdx) || spanIdx <= 0) return null;
  return Math.max(MIN_PASSBAND_SPAN_IDX, Math.floor(spanIdx));
}

function defaultPassband(
  settings: WaterfallSettings,
  mode: Props['mode'],
  maxSpanIdx?: number | null,
): Passband {
  const centerHz = settings.basefreq + settings.total_bandwidth / 2;
  return clampPassband(
    passbandFromCenter(settings, centerHz, mode ?? 'USB'),
    settings,
    maxSpanIdx,
  );
}

function parseBandwidthHz(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    // Treat small numbers as kHz (e.g. 9 -> 9 kHz).
    const hz = raw < 1000 ? raw * 1000 : raw;
    return clampBandwidthHz(hz);
  }
  const s0 = String(raw).trim();
  if (!s0) return null;
  const s = s0.toLowerCase().replace(/\s+/g, '');
  let v: number;
  if (s.endsWith('khz')) {
    v = Number(s.slice(0, -3)) * 1000;
  } else if (s.endsWith('k')) {
    v = Number(s.slice(0, -1)) * 1000;
  } else if (s.endsWith('hz')) {
    v = Number(s.slice(0, -2));
  } else {
    // Default to kHz for bare values (common in AM markers).
    v = Number(s) * 1000;
  }
  if (!Number.isFinite(v) || v < 0) return null;
  return clampBandwidthHz(v);
}

function clampBandwidthHz(hz: number): number | null {
  // Practical range: 100 Hz .. 250 kHz
  if (!Number.isFinite(hz)) return null;
  if (hz < 100) return 100;
  if (hz > 250_000) return 250_000;
  return Math.round(hz);
}

function ssbDefaultsHz(settings: WaterfallSettings): { lowCutHz: number; highCutHz: number } {
  const lowRaw = settings.defaults?.ssb_lowcut_hz;
  const highRaw = settings.defaults?.ssb_highcut_hz;
  const lowCutHz = Math.max(0, Math.floor(typeof lowRaw === 'number' ? lowRaw : Number(lowRaw ?? NaN)));
  const highCutHz = Math.max(lowCutHz + 1, Math.floor(typeof highRaw === 'number' ? highRaw : Number(highRaw ?? NaN)));
  return {
    lowCutHz: Number.isFinite(lowCutHz) ? lowCutHz : 100,
    highCutHz: Number.isFinite(highCutHz) ? highCutHz : 2800,
  };
}

function defaultModeSpanHz(settings: WaterfallSettings, mode: Props['mode']): number {
  if (mode === 'USB' || mode === 'LSB') {
    const ssb = ssbDefaultsHz(settings);
    return clampBandwidthHz(ssb.highCutHz - ssb.lowCutHz) ?? 2700;
  }
  if (mode === 'WBFM') return 180_000;
  if (mode === 'AM' || mode === 'SAM') return 10_000;
  if (mode === 'FM' || mode === 'FMC') return 12_000;
  if (mode === 'CW') return 400;
  return 2_700;
}

function passbandFromCenter(settings: WaterfallSettings, centerHz: number, mode: Props['mode']): Passband {
  const ssb = ssbDefaultsHz(settings);
  const spanHz = defaultModeSpanHz(settings, mode);
  let lHz: number;
  let rHz: number;
  let mHz = centerHz;

  if (mode === 'USB') {
    lHz = centerHz + ssb.lowCutHz;
    rHz = centerHz + ssb.highCutHz;
  } else if (mode === 'LSB') {
    lHz = centerHz - ssb.highCutHz;
    rHz = centerHz - ssb.lowCutHz;
  } else if (mode === 'CW') {
    const bfoHz = 750;
    const toneHz = centerHz + bfoHz;
    lHz = toneHz - spanHz / 2;
    rHz = toneHz + spanHz / 2;
    if (lHz < mHz) {
      rHz += mHz - lHz;
      lHz = mHz;
    }
  } else {
    lHz = centerHz - spanHz / 2;
    rHz = centerHz + spanHz / 2;
  }

  return {
    l: freqHzToIdx(settings, lHz),
    m: freqHzToIdx(settings, mHz),
    r: freqHzToIdx(settings, rHz),
  };
}

function passbandFromCenterWithSpan(settings: WaterfallSettings, centerHz: number, mode: Props['mode'], spanHz: number): Passband {
  const ssb = ssbDefaultsHz(settings);
  const s = clampBandwidthHz(spanHz) ?? defaultModeSpanHz(settings, mode);
  let lHz: number;
  let rHz: number;
  let mHz = centerHz;

  if (mode === 'USB') {
    lHz = centerHz + ssb.lowCutHz;
    rHz = lHz + s;
  } else if (mode === 'LSB') {
    rHz = centerHz - ssb.lowCutHz;
    lHz = rHz - s;
  } else if (mode === 'CW') {
    const bfoHz = 750;
    const toneHz = centerHz + bfoHz;
    lHz = toneHz - s / 2;
    rHz = toneHz + s / 2;
    if (lHz < mHz) {
      rHz += mHz - lHz;
      lHz = mHz;
    }
  } else {
    lHz = centerHz - s / 2;
    rHz = centerHz + s / 2;
  }

  return {
    l: freqHzToIdx(settings, lHz),
    m: freqHzToIdx(settings, mHz),
    r: freqHzToIdx(settings, rHz),
  };
}

function movePassbandToCenterIdx(
  settings: WaterfallSettings,
  prev: Passband,
  centerIdx: number,
  maxSpanIdx?: number | null,
): Passband {
  const leftOffset = prev.l - prev.m;
  const rightOffset = prev.r - prev.m;
  return clampPassband(
    { l: centerIdx + leftOffset, m: centerIdx, r: centerIdx + rightOffset },
    settings,
    maxSpanIdx,
  );
}

function movePassbandToTuningCenterIdx(
  settings: WaterfallSettings,
  prev: Passband,
  mode: Props['mode'],
  centerIdx: number,
  maxSpanIdx?: number | null,
): Passband {
  void mode;
  return movePassbandToCenterIdx(settings, prev, centerIdx, maxSpanIdx);
}

function freqHzToIdx(settings: WaterfallSettings, hz: number): number {
  const t = clamp((hz - settings.basefreq) / settings.total_bandwidth, 0, 1);
  return t * settings.fft_result_size;
}

function validateSettings(s: WaterfallSettings): void {
  if (typeof s.sps !== 'number' || s.sps <= 0) throw new Error('invalid settings.sps');
  if (typeof s.fft_result_size !== 'number' || s.fft_result_size <= 0) {
    throw new Error('invalid settings.fft_result_size');
  }
  if (typeof s.basefreq !== 'number') throw new Error('invalid settings.basefreq');
  if (typeof s.total_bandwidth !== 'number' || s.total_bandwidth <= 0) {
    throw new Error('invalid settings.total_bandwidth');
  }
  if (!s.defaults || typeof s.defaults !== 'object') throw new Error('invalid settings.defaults');
}

function idxToCanvasX(idx: number, vp: Viewport, canvasWidthPx: number): number {
  const span = vp.r - vp.l;
  if (span <= 0) return 0;
  return ((idx - vp.l) * canvasWidthPx) / span;
}

function canvasXToIdx(x: number, canvasWidthCss: number, vp: Viewport): number {
  const t = clamp(x / canvasWidthCss, 0, 1);
  const span = vp.r - vp.l;
  return vp.l + t * span;
}

function idxToFreqHz(settings: WaterfallSettings, idx: number): number {
  const t = idx / settings.fft_result_size;
  return settings.basefreq + t * settings.total_bandwidth;
}

function clampPassband(
  p: Passband,
  settings: WaterfallSettings,
  maxSpanIdx?: number | null,
): Passband {
  const max = settings.fft_result_size;
  let l = clamp(p.l, 0, max);
  let r = clamp(p.r, 0, max);
  if (r < l) [l, r] = [r, l];
  const m = clamp(p.m, 0, max);
  if (maxSpanIdx != null && Number.isFinite(maxSpanIdx) && maxSpanIdx > 0) {
    const maxSpan = Math.max(
      MIN_PASSBAND_SPAN_IDX,
      Math.min(max, Math.floor(maxSpanIdx)),
    );
    const span = r - l;
    if (span > maxSpan) {
      const half = maxSpan / 2;
      let nextL = m - half;
      let nextR = nextL + maxSpan;
      if (nextL < 0) {
        nextR -= nextL;
        nextL = 0;
      }
      if (nextR > max) {
        nextL -= nextR - max;
        nextR = max;
      }
      l = clamp(nextL, 0, max);
      r = clamp(nextR, 0, max);
    }
  }
  return { l, m, r };
}

function normalizePassbandForMode(
  settings: WaterfallSettings,
  p: Passband,
  maxSpanIdx?: number | null,
): Passband {
  const clamped = clampPassband(p, settings, maxSpanIdx);
  const span = clamped.r - clamped.l;
  if (span >= MIN_PASSBAND_SPAN_IDX) return clamped;

  const max = settings.fft_result_size;
  const half = MIN_PASSBAND_SPAN_IDX / 2;
  const m = clamp(clamped.m, half, max - half);
  return clampPassband({ l: m - half, m, r: m + half }, settings, maxSpanIdx);
}

function enforceMinSpanForEdgeDrag(
  settings: WaterfallSettings,
  p: Passband,
  kind: 'l' | 'r',
  maxSpanIdx?: number | null,
): Passband {
  const max = settings.fft_result_size;
  let l = clamp(p.l, 0, max);
  let r = clamp(p.r, 0, max);
  let m = clamp(p.m, 0, max);
  if (r < l) [l, r] = [r, l];

  let span = r - l;
  if (maxSpanIdx != null && Number.isFinite(maxSpanIdx) && maxSpanIdx > 0) {
    const maxSpan = Math.max(
      MIN_PASSBAND_SPAN_IDX,
      Math.min(max, Math.floor(maxSpanIdx)),
    );
    if (span > maxSpan) {
      if (kind === 'l') {
        l = r - maxSpan;
      } else {
        r = l + maxSpan;
      }
      l = clamp(l, 0, max);
      r = clamp(r, 0, max);
      span = r - l;
    }
  }

  if (span >= MIN_PASSBAND_SPAN_IDX) return { l, m, r };
  if (kind === 'l') {
    l = r - MIN_PASSBAND_SPAN_IDX;
  } else {
    r = l + MIN_PASSBAND_SPAN_IDX;
  }
  l = clamp(l, 0, max);
  r = clamp(r, 0, max);
  return { l, m: clamp(m, 0, max), r };
}

function PassbandTunerBar({
  viewport,
  settingsRef,
  passband,
  setPassband,
  mode,
  maxSpanIdx,
  tuningStepHz,
}: {
  viewport: Viewport;
  settingsRef: React.MutableRefObject<WaterfallSettings | null>;
  passband: Passband;
  setPassband: React.Dispatch<React.SetStateAction<Passband | null>>;
  mode: Props['mode'];
  maxSpanIdx?: number | null;
  tuningStepHz: number;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barWidth, setBarWidth] = useState<number>(0);
  const dragRef = useRef<
    | null
    | {
        kind: 'move' | 'l' | 'r' | 'click';
        pointerId: number;
        startClientX: number;
        movedPx: number;
        start: Passband;
      }
  >(null);

  const span = viewport.r - viewport.l;
  const hasViewport = span > 0;

  const toX = (idx: number): number => {
    if (!hasViewport || barWidth <= 0) return 0;
    const t = (idx - viewport.l) / span;
    return t * barWidth;
  };

  const setCenterByClientX = (clientX: number) => {
    const settings = settingsRef.current;
    const bar = barRef.current;
    if (!settings || !bar || !hasViewport) return;

    const rect = bar.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const centerIdx = viewport.l + (x / rect.width) * span;
    setPassband((prev) => {
      if (!prev) return prev;
      return clampPassband(
        movePassbandToTuningCenterIdx(settings, prev, mode, centerIdx, maxSpanIdx),
        settings,
        maxSpanIdx,
      );
    });
  };

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const ro = new ResizeObserver(() => setBarWidth(bar.clientWidth));
    ro.observe(bar);
    setBarWidth(bar.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    const handleWheel = (e: WheelEvent) => {
      const settings = settingsRef.current;
      if (!settings) return;

      e.preventDefault();
      e.stopPropagation();

      // Invert deltaY: scroll up (negative deltaY) should increase frequency
      const stepHz = -Math.sign(e.deltaY) * tuningStepHz;
      const stepIdx = (stepHz / settings.total_bandwidth) * settings.fft_result_size;

      setPassband((prev) => {
        if (!prev) return prev;
        const shifted = { l: prev.l + stepIdx, m: prev.m + stepIdx, r: prev.r + stepIdx };
        return clampPassband(shifted, settings, maxSpanIdx);
      });
    };

    bar.addEventListener('wheel', handleWheel, { passive: false });
    return () => bar.removeEventListener('wheel', handleWheel);
  }, [maxSpanIdx, setPassband, settingsRef, tuningStepHz]);

  const startDrag = (kind: 'move' | 'l' | 'r' | 'click') => (e: ReactPointerEvent<HTMLElement>) => {
    const settings = settingsRef.current;
    if (!settings) return;

    dragRef.current = {
      kind,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      movedPx: 0,
      start: normalizePassbandForMode(settings, passband, maxSpanIdx),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
    e.preventDefault();
  };

  const onMove = (e: ReactPointerEvent<HTMLElement>) => {
    const settings = settingsRef.current;
    const bar = barRef.current;
    const drag = dragRef.current;
    if (!settings || !bar || !drag) return;
    if (!hasViewport) return;
    if (drag.pointerId !== e.pointerId) return;

    const rect = bar.getBoundingClientRect();
    const dxPx = e.clientX - drag.startClientX;
    const dxIdx = (dxPx / rect.width) * span;
    drag.movedPx = Math.max(drag.movedPx, Math.abs(dxPx));

    if (drag.kind === 'move') {
      const startCenter = mode === 'CW' ? (drag.start.l + drag.start.r) / 2 : drag.start.m;
      setPassband(
        clampPassband(
          movePassbandToTuningCenterIdx(settings, drag.start, mode, startCenter + dxIdx, maxSpanIdx),
          settings,
          maxSpanIdx,
        ),
      );
      return;
    }

    if (drag.kind === 'click') {
      const x = clamp(e.clientX - rect.left, 0, rect.width);
      const centerIdx = viewport.l + (x / rect.width) * span;
      setPassband(
        clampPassband(
          movePassbandToTuningCenterIdx(settings, drag.start, mode, centerIdx, maxSpanIdx),
          settings,
          maxSpanIdx,
        ),
      );
      return;
    }

    const start = drag.start;
    if (drag.kind === 'l') {
      setPassband(
        enforceMinSpanForEdgeDrag(
          settings,
          { l: start.l + dxIdx, m: start.m, r: start.r },
          'l',
          maxSpanIdx,
        ),
      );
      return;
    }
    if (drag.kind === 'r') {
      setPassband(
        enforceMinSpanForEdgeDrag(
          settings,
          { l: start.l, m: start.m, r: start.r + dxIdx },
          'r',
          maxSpanIdx,
        ),
      );
      return;
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.pointerId !== e.pointerId) return;

    const moved = drag.movedPx;
    const kind = drag.kind;
    dragRef.current = null;

    if (moved < 4 && (kind === 'click' || kind === 'move')) {
      setCenterByClientX(e.clientX);
    }
  };

  const leftX = toX(passband.l);
  const midX = toX(passband.m);
  const rightX = toX(passband.r);
  const toneX = mode === 'CW' ? toX((passband.l + passband.r) / 2) : null;
  const pxWidth = Math.max(0, rightX - leftX);

  const isVisible = rightX >= 0 && leftX <= barWidth;

  const handleOpacity = pxWidth >= 22 ? 1 : 0.45;
  const MIDLINE_HIT_GUARD_PX = 4;
  const moveHitWidth = Math.max(pxWidth, MIN_PASSBAND_VISUAL_PX);
  const baseMoveHitLeft = (mode === 'USB' || mode === 'CW') ? leftX : mode === 'LSB' ? rightX - moveHitWidth : midX - moveHitWidth / 2;
  const guard = (mode === 'USB' || mode === 'CW' || mode === 'LSB') ? MIDLINE_HIT_GUARD_PX : 0;
  const moveHitWidthEffective = Math.max(0, moveHitWidth - guard);
  const moveHitLeft = clamp(
    baseMoveHitLeft + (mode === 'USB' || mode === 'CW' ? guard : 0),
    0,
    Math.max(0, barWidth - moveHitWidthEffective),
  );

  // Handles sit just outside the passband edges so they never "cross".
  // when zoomed out (even if the passband is narrower than the handle width).
  const handleSizePx = 16;
  const leftHandleLeft = leftX - handleSizePx;
  const rightHandleLeft = rightX;

  return (
    <div
      ref={barRef}
      className="relative h-[22px] w-full touch-none bg-background"
      onPointerDown={startDrag('click')}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      role="presentation"
    >
      {isVisible && (
        <>
      <div className="pointer-events-none absolute inset-y-0 w-px bg-yellow-500/90" style={{ left: `${midX}px` }} />
      {toneX != null ? (
        <div className="pointer-events-none absolute inset-y-0 w-px bg-sky-500/90" style={{ left: `${toneX}px` }} />
      ) : null}
      <div
        className="pointer-events-none absolute inset-y-0 bg-yellow-500/10"
        style={{ left: `${leftX}px`, width: `${Math.max(1, pxWidth)}px` }}
      />
      <div
        className="pointer-events-none absolute top-[20%] h-0 border-t border-yellow-500/90"
        style={{ left: `${leftX}px`, width: `${Math.max(1, pxWidth)}px` }}
      />
      <div
        className="absolute inset-y-0 z-10 cursor-grab bg-transparent"
        style={{ left: `${moveHitLeft}px`, width: `${moveHitWidthEffective}px` }}
        onPointerDown={startDrag('move')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="slider"
        aria-label="Passband"
      >
        <div className="pointer-events-none absolute inset-0" />
      </div>

      <div
        className="absolute inset-y-0 z-20 w-4 cursor-w-resize"
        style={{ left: `${leftHandleLeft}px`, opacity: handleOpacity }}
        onPointerDown={startDrag('l')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="slider"
        aria-label="Passband left edge"
      >
        <svg className="h-full w-full" viewBox="0 0 16 22" aria-hidden="true">
          <line x1="16" y1="4" x2="4" y2="22" stroke="rgb(234 179 8)" strokeWidth="1.25" />
          <line x1="0" y1="22" x2="4" y2="22" stroke="rgb(234 179 8)" strokeWidth="1.25" />
        </svg>
      </div>

      <div
        className="absolute inset-y-0 z-20 w-4 cursor-e-resize"
        style={{ left: `${rightHandleLeft}px`, opacity: handleOpacity }}
        onPointerDown={startDrag('r')}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="slider"
        aria-label="Passband right edge"
      >
        <svg className="h-full w-full" viewBox="0 0 16 22" aria-hidden="true">
          <line x1="0" y1="4" x2="12" y2="22" stroke="rgb(234 179 8)" strokeWidth="1.25" />
          <line x1="12" y1="22" x2="16" y2="22" stroke="rgb(234 179 8)" strokeWidth="1.25" />
        </svg>
      </div>
        </>
      )}
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function cssHsl(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return raw.length ? raw : fallback;
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function formatFreq(hz: number): string {
  if (hz >= 1_000_000) return `${(hz / 1_000_000).toFixed(3)} MHz`;
  if (hz >= 1_000) return `${(hz / 1_000).toFixed(3)} kHz`;
  return `${Math.round(hz)} Hz`;
}

function drawBandPlan(
  ctx: CanvasRenderingContext2D,
  {
    bands,
    settings,
    vp,
    widthPx,
    dpr,
  }: { bands: BandOverlay[]; settings: WaterfallSettings; vp: Viewport; widthPx: number; dpr: number },
) {
  ctx.save();
  const freqL = idxToFreqHz(settings, vp.l);
  const freqR = idxToFreqHz(settings, vp.r);
  if (freqR <= freqL) {
    ctx.restore();
    return;
  }

  // Keep the band plan in the lower part of the scale area so ticks/labels can live at the top.
  const bandY = Math.floor(42 * dpr);
  const labelY = bandY - Math.floor(2 * dpr);
  const lineWidth = Math.max(2, Math.floor(2 * dpr));
  const fontSize = Math.max(10, Math.floor(10 * dpr));
  ctx.font = `${fontSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';

  for (const band of bands) {
    if (band.endHz <= freqL || band.startHz >= freqR) continue;

    const startIdx = freqHzToIdx(settings, band.startHz);
    const endIdx = freqHzToIdx(settings, band.endHz);
    const x1Raw = idxToCanvasX(startIdx, vp, widthPx);
    const x2Raw = idxToCanvasX(endIdx, vp, widthPx);
    const x1 = clamp(x1Raw, 0, widthPx);
    const x2 = clamp(x2Raw, 0, widthPx);
    const visibleW = x2 - x1;
    if (visibleW <= 2) continue;

    ctx.save();
    const color = band.color ?? `hsl(${cssHsl('--primary', '221.2 83.2% 53.3%')} / 0.55)`;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.floor(2 * dpr);
    ctx.beginPath();
    ctx.moveTo(x1 + 0.5, bandY + 0.5);
    ctx.lineTo(x2 + 0.5, bandY + 0.5);
    ctx.stroke();
    ctx.restore();

    // Keep the label anchored to the *true* band center so it doesn't "slide"
    // when the band is partially offscreen. If the center goes out of view,
    // the label disappears.
    const centerXRaw = (x1Raw + x2Raw) / 2;
    if (centerXRaw < 0 || centerXRaw > widthPx) continue;

    const rawW = Math.abs(x2Raw - x1Raw);
    const fits = ctx.measureText(band.name).width <= rawW - Math.floor(6 * dpr);
    const label = fits ? band.name : abbreviateBandName(ctx, band.name, rawW - Math.floor(6 * dpr));
    if (!label) continue;

    ctx.save();
    const fg = cssHsl('--foreground', '222.2 84% 4.9%');
    const bg = cssHsl('--background', '0 0% 100%');
    ctx.lineWidth = Math.max(2, Math.floor(3 * dpr));
    ctx.strokeStyle = `hsl(${bg} / 0.75)`;
    ctx.fillStyle = `hsl(${fg} / 0.9)`;
    const cx = centerXRaw;
    ctx.strokeText(label, cx, labelY);
    ctx.fillText(label, cx, labelY);
    ctx.restore();
  }
  ctx.restore();
}

function niceTickStepHz(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const exp = Math.floor(Math.log10(raw));
  const base = Math.pow(10, exp);
  const f = raw / base;
  const snapped = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return snapped * base;
}

function abbreviateBandName(ctx: CanvasRenderingContext2D, name: string, maxWidth: number): string | null {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return null;
  const initials = words.map((w) => w[0]).join('');
  if (ctx.measureText(initials).width <= maxWidth) return initials;
  return null;
}
