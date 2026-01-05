import { useCallback, useEffect, useRef, useState } from 'react';

import { AudioPanel } from './panels/AudioPanel';
import { ChatPanel } from './panels/ChatPanel';
import { DemodBandwidthPanel } from './panels/DemodBandwidthPanel';
import { ServerInfoPanel } from './panels/ServerInfoPanel';
import { WaterfallControlsPanel } from './panels/WaterfallControlsPanel';
import { WaterfallCard } from '../waterfall/WaterfallCard';
import type { WaterfallDisplaySettings } from '../waterfall/viewSettings';
import type { AudioDebugStats, AudioUiSettings } from '../audio/types';
import { triggerAudioResume } from '../audio/audioGate';
import { useDecoders } from '../../lib/useDecoders';
import { DEFAULT_BANDS } from '../waterfall/bands';
import type { BandOverlay } from '../waterfall/WaterfallView';
import type { WaterfallSettings } from '../waterfall/protocol';
import type { ReceiverMode } from '../../lib/receiverMode';

type Props = {
  receiverId: string | null;
  onReceiverChange?: (receiverId: string) => void;
  audioSettings: AudioUiSettings;
  onAudioSettingsChange: React.Dispatch<React.SetStateAction<AudioUiSettings>>;
  tuningStepHz: number;
  onDebugStatsChange: React.Dispatch<React.SetStateAction<AudioDebugStats | null>>;
  autoBandMode: boolean;
  onPreferReceiverForFrequencyHz?: (hz: number) => string | null;
  initialUrlTune?: { receiverId: string; frequencyHz: number | null; mode: ReceiverMode | null } | null;
  onInitialUrlTuneApplied?: () => void;
};

export function WebSdrUi({
  receiverId,
  onReceiverChange,
  audioSettings,
  onAudioSettingsChange,
  tuningStepHz,
  onDebugStatsChange,
  autoBandMode,
  onPreferReceiverForFrequencyHz,
  initialUrlTune,
  onInitialUrlTuneApplied,
}: Props) {
  const [mode, setMode] = useState<'USB' | 'LSB' | 'CW' | 'AM' | 'FM' | 'FMC' | 'WBFM' | 'SAM'>('USB');
  const [centerHz, setCenterHz] = useState<number | null>(null);
  const [bandwidthHz, setBandwidthHz] = useState<number | null>(null);
  const [gridLocator, setGridLocator] = useState<string | null>(null);
  const [viewport, setViewport] = useState<{ l: number; r: number } | null>(null);
  const [audioMaxSps, setAudioMaxSps] = useState<number | null>(null);
  const [frequencyAdjust, setFrequencyAdjust] = useState<{ nonce: number; deltaHz: number } | null>(null);
  const [bandwidthAdjust, setBandwidthAdjust] = useState<{ nonce: number; deltaHz: number } | null>(null);
  const [frequencySet, setFrequencySet] = useState<{ nonce: number; centerHz: number } | null>(null);
  const [resetTune, setResetTune] = useState<{ nonce: number; vfo: 'A' | 'B' } | null>(null);
  const [audioWindow, setAudioWindow] = useState<{ l: number; m: number; r: number } | null>(null);
  const [waterfallDisplay, setWaterfallDisplay] = useState<WaterfallDisplaySettings>({
    minDb: -30,
    maxDb: 110,
    colormap: 'gqrx',
    autoAdjust: false,
    spectrumOverlay: false,
    biggerWaterfall: false,
    manualMinDb: -30,
    manualMaxDb: 110,
  });
  const [audioGateOpen, setAudioGateOpen] = useState(true);
  const decoders = useDecoders();
  const [currentVfo, setCurrentVfo] = useState<'A' | 'B'>('A');
  const currentVfoRef = useRef<'A' | 'B'>('A');
  const liveRef = useRef<{
    mode: typeof mode;
    centerHz: number | null;
    bandwidthHz: number | null;
    passband: { l: number; m: number; r: number } | null;
    viewport: { l: number; r: number } | null;
  }>({ mode, centerHz, bandwidthHz, passband: audioWindow, viewport });
  const vfoARef = useRef<{
    mode: typeof mode;
    centerHz: number;
    bandwidthHz: number | null;
    passband: { l: number; m: number; r: number } | null;
    viewport: { l: number; r: number } | null;
  } | null>(null);
  const vfoBRef = useRef<{
    mode: typeof mode;
    centerHz: number;
    bandwidthHz: number | null;
    passband: { l: number; m: number; r: number } | null;
    viewport: { l: number; r: number } | null;
  } | null>(null);
  const vfoInitializedRef = useRef(false);
  const [passbandSet, setPassbandSet] = useState<null | { nonce: number; l: number; m: number; r: number }>(null);
  const [viewportSet, setViewportSet] = useState<null | { nonce: number; l: number; r: number }>(null);
  const passbandSetNonceRef = useRef(0);
  const viewportSetNonceRef = useRef(0);
  const frequencyAdjustNonceRef = useRef(0);
  const bandwidthAdjustNonceRef = useRef(0);
  const frequencySetNonceRef = useRef(0);
  const resetTuneNonceRef = useRef(0);
  const suppressAutoBandRef = useRef(false);
  const lastAutoBandKeyRef = useRef<string | null>(null);
  const canWbfm = (audioMaxSps ?? 0) > 100_000;
  const [receiverSessionNonce, setReceiverSessionNonce] = useState(0);
  const lastReceiverIdRef = useRef<string | null>(receiverId);
  const squelchTouchedRef = useRef(false);
  const [bands, setBands] = useState<BandOverlay[]>(DEFAULT_BANDS);
  const preferReceiverRef = useRef<Props['onPreferReceiverForFrequencyHz']>(onPreferReceiverForFrequencyHz);
  const pendingExplicitTuneRef = useRef<null | { hz: number; mode: typeof mode; receiverId: string }>(null);
  const waterfallSettingsRef = useRef<WaterfallSettings | null>(null);
  const initialUrlTuneAppliedRef = useRef(false);

  useEffect(() => {
    preferReceiverRef.current = onPreferReceiverForFrequencyHz;
  }, [onPreferReceiverForFrequencyHz]);

  useEffect(() => {
    currentVfoRef.current = currentVfo;
  }, [currentVfo]);

  useEffect(() => {
    liveRef.current.mode = mode;
    liveRef.current.centerHz = centerHz;
    liveRef.current.bandwidthHz = bandwidthHz;
  }, [bandwidthHz, centerHz, mode]);

  const writeActiveVfo = useCallback((updater: (v: NonNullable<typeof vfoARef.current>) => void) => {
    const target = currentVfoRef.current === 'A' ? vfoARef : vfoBRef;
    const cur = target.current;
    if (!cur) return;
    updater(cur);
  }, []);

  const requestFrequencySetHz = useCallback((hz: number) => {
    if (!Number.isFinite(hz)) return;
    const rounded = Math.round(hz);
    if (rounded <= 0) return;
    frequencySetNonceRef.current += 1;
    setFrequencySet({ nonce: frequencySetNonceRef.current, centerHz: rounded });
  }, []);

  const requestFrequencyAdjustHz = useCallback((deltaHz: number) => {
    if (!Number.isFinite(deltaHz)) return;
    frequencyAdjustNonceRef.current += 1;
    setFrequencyAdjust({ nonce: frequencyAdjustNonceRef.current, deltaHz: Math.round(deltaHz) });
  }, []);

  const requestBandwidthAdjustHz = useCallback((deltaHz: number) => {
    if (!Number.isFinite(deltaHz)) return;
    bandwidthAdjustNonceRef.current += 1;
    setBandwidthAdjust({ nonce: bandwidthAdjustNonceRef.current, deltaHz: Math.round(deltaHz) });
  }, []);

  const requestResetTune = useCallback((vfo: 'A' | 'B') => {
    resetTuneNonceRef.current += 1;
    setResetTune({ nonce: resetTuneNonceRef.current, vfo });
  }, []);

  const passbandForTune = useCallback(
    (settings: WaterfallSettings, hz: number, nextMode: typeof mode) => {
      const fft = settings.fft_result_size;
      const base = settings.basefreq;
      const bw = settings.total_bandwidth;
      if (!Number.isFinite(fft) || fft <= 0) return null;
      if (!Number.isFinite(base) || !Number.isFinite(bw) || bw <= 0) return null;

      const maxIdx = Math.max(0, Math.floor(fft) - 1);

      const centerIdx = ((hz - base) / bw) * fft;
      if (!Number.isFinite(centerIdx)) return null;

      const ssbLowCutHzRaw = settings.defaults?.ssb_lowcut_hz ?? 300;
      const ssbHighCutHzRaw = settings.defaults?.ssb_highcut_hz ?? 3000;
      const ssbLowCutHz = Math.max(0, Math.floor(Number(ssbLowCutHzRaw) || 0));
      const ssbHighCutHz = Math.max(ssbLowCutHz + 1, Math.floor(Number(ssbHighCutHzRaw) || 0));

      const spanHz =
        nextMode === 'USB' || nextMode === 'LSB'
          ? Math.max(100, ssbHighCutHz - ssbLowCutHz)
          : nextMode === 'WBFM'
            ? 180_000
            : nextMode === 'AM' || nextMode === 'SAM'
              ? 10_000
              : nextMode === 'FM' || nextMode === 'FMC'
                ? 12_000
              : nextMode === 'CW'
                ? 800
                : 2_700;
      const spanIdx = (spanHz / bw) * fft;

      const clampIdx = (v: number) => Math.max(0, Math.min(maxIdx, Math.round(v)));
      const ssbLowCutIdx = (ssbLowCutHz / bw) * fft;
      const ssbHighCutIdx = (ssbHighCutHz / bw) * fft;

      let l = clampIdx(centerIdx - spanIdx / 2);
      let r = clampIdx(centerIdx + spanIdx / 2);
      if (nextMode === 'USB') {
        l = clampIdx(centerIdx + ssbLowCutIdx);
        r = clampIdx(centerIdx + ssbHighCutIdx);
      } else if (nextMode === 'LSB') {
        l = clampIdx(centerIdx - ssbHighCutIdx);
        r = clampIdx(centerIdx - ssbLowCutIdx);
      }
      if (r < l) [l, r] = [r, l];
      return { l, m: clampIdx(centerIdx), r };
    },
    [],
  );

  const setModeForActiveVfo = useCallback(
    (nextMode: typeof mode) => {
      const sanitized = nextMode === 'WBFM' && !canWbfm ? 'FM' : nextMode;
      setMode(sanitized);
      writeActiveVfo((v) => {
        v.mode = sanitized;
      });

      const settings = waterfallSettingsRef.current;
      const hz = liveRef.current.centerHz;
      if (!settings || hz == null) return;

      const pb = passbandForTune(settings, hz, sanitized);
      if (!pb) return;

      setAudioWindow(pb);
      writeActiveVfo((v) => {
        v.passband = pb;
      });
      passbandSetNonceRef.current += 1;
      setPassbandSet({ nonce: passbandSetNonceRef.current, l: pb.l, m: pb.m, r: pb.r });
    },
    [canWbfm, passbandForTune, writeActiveVfo],
  );

  const tuneTo = useCallback(
    (hz: number, nextMode?: typeof mode, receiverOverride?: string) => {
      const targetHz = Math.round(hz);
      if (!Number.isFinite(targetHz) || targetHz <= 0) return;

      const requestedReceiverId = receiverOverride ?? (preferReceiverRef.current?.(targetHz) ?? receiverId);
      const rawMode = nextMode ?? liveRef.current.mode;
      const sanitizedMode = rawMode === 'WBFM' && !canWbfm ? 'FM' : rawMode;
      if (requestedReceiverId && requestedReceiverId !== receiverId) {
        defaultsAppliedRef.current = false;
        suppressAutoBandRef.current = true;
        pendingExplicitTuneRef.current = { hz: targetHz, mode: sanitizedMode, receiverId: requestedReceiverId };
        onReceiverChange?.(requestedReceiverId);
        return;
      }

      if (nextMode) {
        suppressAutoBandRef.current = true;
        setModeForActiveVfo(nextMode);

        const settings = waterfallSettingsRef.current;
        if (settings) {
          const pb = passbandForTune(settings, targetHz, sanitizedMode);
          if (pb) {
            passbandSetNonceRef.current += 1;
            setPassbandSet({ nonce: passbandSetNonceRef.current, l: pb.l, m: pb.m, r: pb.r });
          }
        }
      }

      const settings = waterfallSettingsRef.current;
      if (!settings && receiverId) {
        pendingExplicitTuneRef.current = { hz: targetHz, mode: sanitizedMode, receiverId };
      }
      defaultsAppliedRef.current = true;
      requestFrequencySetHz(targetHz);
    },
    [canWbfm, onReceiverChange, passbandForTune, receiverId, requestFrequencySetHz, setModeForActiveVfo],
  );

  useEffect(() => {
    if (!initialUrlTune || initialUrlTuneAppliedRef.current) return;
    if (!receiverId || receiverId !== initialUrlTune.receiverId) return;

    initialUrlTuneAppliedRef.current = true;
    suppressAutoBandRef.current = true;

    if (initialUrlTune.frequencyHz != null) {
      tuneTo(initialUrlTune.frequencyHz, initialUrlTune.mode ?? undefined, receiverId);
    } else if (initialUrlTune.mode != null) {
      setModeForActiveVfo(initialUrlTune.mode);
    }

    onInitialUrlTuneApplied?.();
  }, [initialUrlTune, onInitialUrlTuneApplied, receiverId, setModeForActiveVfo, tuneTo]);

  const maybeApplyAutoBandMode = useCallback(
    (nextCenterHz: number) => {
      if (!autoBandMode) return;
      if (suppressAutoBandRef.current) {
        suppressAutoBandRef.current = false;
        return;
      }

      const band = bands.find((b) => nextCenterHz >= b.startHz && nextCenterHz <= b.endHz) ?? null;
      const bandKey = band ? `${band.startHz}-${band.endHz}-${band.name}` : null;
      if (bandKey === lastAutoBandKeyRef.current) return;
      lastAutoBandKeyRef.current = bandKey;
      if (!band) return;

      let recommended: typeof mode | null = null;
      const modeFromBand =
        band.modes?.find((m) => nextCenterHz >= m.startHz && nextCenterHz <= m.endHz)?.mode ?? null;
      if (modeFromBand) {
        recommended = modeFromBand;
      } else if (/\bAM\b/i.test(band.name) && !/\bHAM\b/i.test(band.name)) {
        recommended = 'AM';
      } else if (/\bHAM\b/i.test(band.name)) {
        recommended = nextCenterHz < 10_000_000 ? 'LSB' : 'USB';
      }

      const currentMode = liveRef.current.mode;
      if (currentMode === 'SAM' && recommended === 'AM') return;
      if (recommended && recommended !== currentMode) setModeForActiveVfo(recommended);
    },
    [autoBandMode, bands, setModeForActiveVfo],
  );

  const handleViewportChange = useCallback((vp: { l: number; r: number }) => {
    liveRef.current.viewport = vp;
    setViewport(vp);
    writeActiveVfo((v) => {
      v.viewport = vp;
    });
  }, [writeActiveVfo]);

  const handlePassbandChange = useCallback((p: { l: number; m: number; r: number }) => {
    liveRef.current.passband = p;
    setAudioWindow(p);
    writeActiveVfo((v) => {
      v.passband = p;
    });
  }, [writeActiveVfo]);

  const requestViewportSet = useCallback((vp: { l: number; r: number }) => {
    viewportSetNonceRef.current += 1;
    setViewportSet({ nonce: viewportSetNonceRef.current, l: vp.l, r: vp.r });
  }, []);
  const defaultsAppliedRef = useRef(false);

  useEffect(() => {
    if (!receiverId) return;
    const prev = lastReceiverIdRef.current;
    if (prev === receiverId) return;
    lastReceiverIdRef.current = receiverId;
    if (prev == null) return;

    const pending = pendingExplicitTuneRef.current;
    const pendingReceiverMatches = pending?.receiverId === receiverId;

    defaultsAppliedRef.current = false;
    lastAutoBandKeyRef.current = null;
    squelchTouchedRef.current = false;
    suppressAutoBandRef.current = pendingReceiverMatches;
    vfoInitializedRef.current = false;
    vfoARef.current = null;
    vfoBRef.current = null;
    currentVfoRef.current = 'A';
    setCurrentVfo('A');

    setCenterHz(null);
    setBandwidthHz(null);
    setGridLocator(null);
    setViewport(null);
    setAudioMaxSps(null);
    setFrequencyAdjust(null);
    setBandwidthAdjust(null);
    setFrequencySet(null);
    setResetTune(null);
    setAudioWindow(null);
    setPassbandSet(null);
    setViewportSet(null);
    setBands(DEFAULT_BANDS);
    waterfallSettingsRef.current = null;

    if (pending && !pendingReceiverMatches) pendingExplicitTuneRef.current = null;
    setMode(pendingReceiverMatches ? pending.mode : 'USB');
    if (pendingReceiverMatches) {
      requestFrequencySetHz(pending.hz);
    }

    setReceiverSessionNonce((n) => n + 1);
  }, [receiverId, requestFrequencySetHz]);

  const switchVfo = useCallback(() => {
    const nextVfo: 'A' | 'B' = currentVfoRef.current === 'A' ? 'B' : 'A';
    const next = nextVfo === 'A' ? vfoARef.current : vfoBRef.current;
    currentVfoRef.current = nextVfo;
    setCurrentVfo(nextVfo);
    if (next && next.centerHz != null) {
      suppressAutoBandRef.current = true;
      setMode(next.mode);
      setCenterHz(next.centerHz);
      setBandwidthHz(next.bandwidthHz ?? null);

      const pb = next.passband;
      const vp = next.viewport;
      const needsFreshInit = !pb || !vp;

      // For an uninitialized VFO, do the same thing as a fresh page load:
      // let `WaterfallView` generate a sane default passband based on mode/settings
      // via `resetTune` (instead of forcing a fake {0,0,0} passband).
      if (needsFreshInit) {
        setAudioWindow(null);
        setPassbandSet(null);
        setViewport(null);
        setViewportSet(null);
        requestResetTune(nextVfo);
        return;
      }

      setAudioWindow(pb);
      passbandSetNonceRef.current += 1;
      setPassbandSet({ nonce: passbandSetNonceRef.current, l: pb.l, m: pb.m, r: pb.r });

      setViewport(vp);
      viewportSetNonceRef.current += 1;
      setViewportSet({ nonce: viewportSetNonceRef.current, l: vp.l, r: vp.r });
    }
  }, []);

  useEffect(() => {
    const isEditableTarget = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        switchVfo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [switchVfo]);

  const unlockAudio = () => {
    setAudioGateOpen(false);
    triggerAudioResume();
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-[1320px] flex-col px-3 pb-[calc(4.5rem+env(safe-area-inset-bottom))] pt-3 sm:px-4 sm:pb-4 sm:pt-4 lg:min-h-0 lg:overflow-hidden">
      {audioGateOpen ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-background/40 backdrop-blur-md"
          role="button"
          tabIndex={0}
          onPointerDown={unlockAudio}
          onTouchStart={unlockAudio}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') unlockAudio();
          }}
        >
          <div className="text-center">
            <div className="text-lg font-semibold tracking-tight">Start audio</div>
            <div className="mt-1 text-sm text-muted-foreground">Click anywhere to enable playback.</div>
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:overflow-hidden">
        <WaterfallCard
          receiverId={receiverId}
          mode={mode}
          centerHz={centerHz}
          onSetMode={setModeForActiveVfo}
          frequencyAdjust={frequencyAdjust}
          frequencySet={frequencySet}
          bandwidthAdjust={bandwidthAdjust}
          resetTune={resetTune}
          display={waterfallDisplay}
          onDisplayChange={setWaterfallDisplay}
          tuningStepHz={tuningStepHz}
          decoders={decoders}
          currentVfo={currentVfo}
          onToggleVfo={switchVfo}
          gridLocator={gridLocator}
          passbandSet={passbandSet}
          viewportSet={viewportSet}
          viewport={viewport}
          passbandCenterIdx={audioWindow?.m ?? null}
          onViewportSet={requestViewportSet}
          audioMute={audioSettings.mute}
          onToggleAudioMute={() => onAudioSettingsChange((prev) => ({ ...prev, mute: !prev.mute }))}
          onViewportChange={handleViewportChange}
          onBandsChange={setBands}
          onSetFrequencyHz={(hz) => {
            tuneTo(hz);
          }}
          onPassbandChange={handlePassbandChange}
          onServerSettings={(s) => {
            waterfallSettingsRef.current = s;
            const pending = pendingExplicitTuneRef.current;
            if (!pending) return;
            if (pending.receiverId !== receiverId) return;
            const pb = passbandForTune(s, pending.hz, pending.mode);
            if (!pb) return;
            passbandSetNonceRef.current += 1;
            setPassbandSet({ nonce: passbandSetNonceRef.current, l: pb.l, m: pb.m, r: pb.r });
            pendingExplicitTuneRef.current = null;
          }}
          onServerDefaults={(d) => {
            const pending = pendingExplicitTuneRef.current;
            if (pending && pending.receiverId === receiverId) {
              defaultsAppliedRef.current = true;
              suppressAutoBandRef.current = true;
              setModeForActiveVfo(pending.mode);
              requestFrequencySetHz(pending.hz);
              return;
            }

            if (defaultsAppliedRef.current) return;

            // Otherwise apply server defaults
            defaultsAppliedRef.current = true;

            const defaultSquelch =
              typeof d?.squelch_enabled === 'boolean'
                ? d.squelch_enabled
                : typeof d?.squelch === 'boolean'
                  ? d.squelch
                  : null;
            if (defaultSquelch != null && !squelchTouchedRef.current) {
              onAudioSettingsChange((prev) => ({ ...prev, squelch: defaultSquelch }));
            }
            const raw = (d?.modulation ?? 'USB').toUpperCase();
            const normalized =
              raw === 'USB' ||
              raw === 'LSB' ||
              raw === 'CW' ||
              raw === 'AM' ||
              raw === 'FM' ||
              raw === 'FMC' ||
              raw === 'WBFM' ||
              raw === 'SAM'
                  ? raw
                  : 'USB';
            const sanitizedMode = audioMaxSps != null && normalized === 'WBFM' && !canWbfm ? 'FM' : normalized;
            suppressAutoBandRef.current = true;
            setModeForActiveVfo(sanitizedMode);
            if (typeof d?.l === 'number' && typeof d?.m === 'number' && typeof d?.r === 'number') {
              passbandSetNonceRef.current += 1;
              setPassbandSet({
                nonce: passbandSetNonceRef.current,
                l: Math.round(d.l),
                m: Math.round(d.m),
                r: Math.round(d.r),
              });
            }
            if (typeof d?.frequency === 'number' && Number.isFinite(d.frequency)) {
              requestFrequencySetHz(d.frequency);
              if (!vfoInitializedRef.current) {
                vfoInitializedRef.current = true;
                vfoARef.current = { mode: sanitizedMode, centerHz: d.frequency, bandwidthHz: null, passband: null, viewport: null };
                vfoBRef.current = { mode: sanitizedMode, centerHz: d.frequency, bandwidthHz: null, passband: null, viewport: null };
              }
            }
          }}
          onTuningChange={(t) => {
            setCenterHz(t.centerHz);
            setBandwidthHz(t.bandwidthHz);
            writeActiveVfo((v) => {
              v.centerHz = t.centerHz;
              v.bandwidthHz = t.bandwidthHz;
            });
            maybeApplyAutoBandMode(t.centerHz);
          }}
        />

        <div className="min-h-0 flex-1 lg:overflow-hidden">
          <div className="grid gap-3 lg:h-full lg:grid-cols-12 lg:grid-rows-2 lg:gap-3 lg:overflow-hidden">
            <div className="lg:col-span-4 lg:row-span-1 lg:min-h-0">
              <DemodBandwidthPanel
                mode={mode}
                canWbfm={canWbfm}
                centerHz={centerHz}
                bandwidthHz={bandwidthHz}
                onModeChange={setModeForActiveVfo}
                onSetFrequencyKhz={(khz) => {
                  tuneTo(khz * 1_000);
                }}
                onFrequencyAdjustKhz={(khz) => {
                  if (khz === 0) {
                    if (centerHz !== null) {
                      const roundedKhz = Math.round(centerHz / 1_000);
                  tuneTo(roundedKhz * 1_000);
                  return;
                }
                requestResetTune(currentVfoRef.current);
                return;
              }
              requestFrequencyAdjustHz(Math.round(khz * 1_000));
            }}
            onBandwidthAdjustHz={(delta) => {
              requestBandwidthAdjustHz(delta);
            }}
          />
            </div>
            <div className="lg:col-span-4 lg:row-span-1 lg:min-h-0">
              <AudioPanel
                receiverId={receiverId}
                receiverSessionNonce={receiverSessionNonce}
                mode={mode}
                centerHz={centerHz}
                audioWindow={audioWindow}
                settings={audioSettings}
                onChange={(action) => {
                  onAudioSettingsChange((prev) => {
                    const next = typeof action === 'function' ? action(prev) : action;
                    if (next.squelch !== prev.squelch) squelchTouchedRef.current = true;
                    return next;
                  });
                }}
                onDebugStatsChange={onDebugStatsChange}
                onGridLocatorChange={setGridLocator}
                onAudioMaxSpsChange={setAudioMaxSps}
                onPcm={decoders.feedAudio}
              />
            </div>
            <div className="lg:col-span-4 lg:row-span-1 lg:min-h-0">
              <WaterfallControlsPanel settings={waterfallDisplay} onChange={setWaterfallDisplay} />
            </div>

            <div className="lg:col-span-8 lg:row-span-1 lg:min-h-0">
              <ChatPanel
                centerHz={centerHz}
                mode={mode}
                receiverId={receiverId}
                onTune={(hz, nextMode, rx) => {
                  tuneTo(hz, nextMode, rx);
                }}
              />
            </div>
            <div className="lg:col-span-4 lg:row-span-1 lg:min-h-0">
              <ServerInfoPanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
