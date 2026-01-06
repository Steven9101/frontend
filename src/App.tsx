import { useEffect, useRef, useState } from 'react';

import { WebSdrHeader } from './components/app/WebSdrHeader';
import { BackendReconnectOverlay } from './components/app/BackendReconnectOverlay';
import { TimeSyncOverlay } from './components/app/TimeSyncOverlay';
import { BackgroundImage } from './components/app/BackgroundImage';
import { WebSdrUi } from './components/receiver/WebSdrUi';
import type { AudioDebugStats, AudioUiSettings } from './components/audio/types';
import { fetchReceiversInfo, type ReceiversInfo } from './lib/receivers';
import { resolveFrequencyHzFromQueryParam } from './lib/parseFrequency';
import { isReceiverMode, type ReceiverMode } from './lib/receiverMode';

const LS_PERSIST = 'novasdr.persist_settings';
const LS_AUDIO = 'novasdr.audio_settings';
const LS_TUNING_STEP = 'novasdr.tuning_step_hz';
const LS_AUTO_BAND = 'novasdr.auto_band_mode';

type PersistedAudioSettings = Pick<AudioUiSettings, 'agcSpeed' | 'agcAttackMs' | 'agcReleaseMs' | 'bufferMode'>;

type ReceiversState =
  | { kind: 'loading' }
  | { kind: 'ready'; value: ReceiversInfo }
  | { kind: 'error' };

type InitialUrlTune = {
  receiverId: string;
  frequencyHz: number | null;
  mode: ReceiverMode | null;
};

function readUrlReceiverMode(url: URL): ReceiverMode | null {
  const raw = (url.searchParams.get('modulation') ?? url.searchParams.get('mode'))?.trim() ?? '';
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return isReceiverMode(upper) ? (upper as ReceiverMode) : null;
}

function pickReceiverForFrequencyHz(info: ReceiversInfo, hz: number, preferredId: string | null): string | null {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  const receivers = info.receivers.filter((r) => typeof r.min_hz === 'number' && typeof r.max_hz === 'number') as Array<
    ReceiversInfo['receivers'][number] & { min_hz: number; max_hz: number }
  >;
  if (receivers.length === 0) return null;
  if (preferredId && receivers.some((r) => r.id === preferredId && hz >= r.min_hz && hz <= r.max_hz)) return preferredId;

  let best: (typeof receivers)[number] | null = null;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const r of receivers) {
    if (hz < r.min_hz || hz > r.max_hz) continue;
    const span = r.max_hz - r.min_hz;
    if (span < bestSpan) {
      best = r;
      bestSpan = span;
    }
  }
  return best?.id ?? null;
}

function readPersistedAudioSettings(fallback: PersistedAudioSettings): PersistedAudioSettings {
  const raw = readJson<Partial<PersistedAudioSettings> | null>(LS_AUDIO, null);
  if (!raw) return fallback;
  const out: PersistedAudioSettings = { ...fallback };
  if (raw.agcSpeed === 'off' || raw.agcSpeed === 'fast' || raw.agcSpeed === 'medium' || raw.agcSpeed === 'slow') {
    out.agcSpeed = raw.agcSpeed;
  }
  if (typeof raw.agcAttackMs === 'number' && Number.isFinite(raw.agcAttackMs)) out.agcAttackMs = raw.agcAttackMs;
  if (typeof raw.agcReleaseMs === 'number' && Number.isFinite(raw.agcReleaseMs)) out.agcReleaseMs = raw.agcReleaseMs;
  if (raw.bufferMode === 'low' || raw.bufferMode === 'medium' || raw.bufferMode === 'high') out.bufferMode = raw.bufferMode;
  return out;
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === 'true';
  } catch {
    return fallback;
  }
}

function readNumber(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [persistSettings, setPersistSettings] = useState<boolean>(() => readBool(LS_PERSIST, true));
  const [autoBandMode, setAutoBandMode] = useState<boolean>(() =>
    persistSettings ? readBool(LS_AUTO_BAND, true) : true,
  );
  const [receivers, setReceivers] = useState<ReceiversState>({ kind: 'loading' });
  const [receiverId, setReceiverId] = useState<string | null>(null);
  const [initialUrlTune, setInitialUrlTune] = useState<InitialUrlTune | null>(null);
  const initialUrlSelectionAppliedRef = useRef(false);

  const [audioSettings, setAudioSettings] = useState<AudioUiSettings>(() => {
    const fallback: AudioUiSettings = {
      volume: 20,
      mute: false,
      squelch: false,
      nr: false,
      nb: false,
      an: false,
      agcSpeed: 'medium',
      agcAttackMs: 10,
      agcReleaseMs: 150,
      bufferMode: 'medium',
    };
    if (!persistSettings) return fallback;
    const persisted = readPersistedAudioSettings({
      agcSpeed: fallback.agcSpeed,
      agcAttackMs: fallback.agcAttackMs,
      agcReleaseMs: fallback.agcReleaseMs,
      bufferMode: fallback.bufferMode,
    });
    return { ...fallback, ...persisted };
  });

  const [tuningStepHz, setTuningStepHz] = useState<number>(() =>
    persistSettings ? readNumber(LS_TUNING_STEP, 100) : 100,
  );
  const [debugStats, setDebugStats] = useState<AudioDebugStats | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchReceiversInfo(ctrl.signal)
      .then((value) => {
        setReceivers({ kind: 'ready', value });
        setReceiverId((prev) => prev ?? value.active_receiver_id);
      })
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setReceivers({ kind: 'error' });
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (initialUrlSelectionAppliedRef.current) return;
    if (receivers.kind !== 'ready') return;

    const url = new URL(window.location.href);
    const frequencyRaw = url.searchParams.get('frequency');
    const rxRaw = url.searchParams.get('rx');
    const mode = readUrlReceiverMode(url);

    if (!frequencyRaw && !rxRaw && !mode) {
      initialUrlSelectionAppliedRef.current = true;
      return;
    }
    initialUrlSelectionAppliedRef.current = true;

    const rxId =
      rxRaw && receivers.value.receivers.some((r) => r.id === rxRaw) ? rxRaw : null;
    const frequencyHz =
      frequencyRaw ? resolveFrequencyHzFromQueryParam(frequencyRaw, { receivers: receivers.value.receivers, rxId }) : null;

    const pickedReceiverId =
      rxId ?? (frequencyHz != null ? pickReceiverForFrequencyHz(receivers.value, frequencyHz, receiverId) : null);

    if (pickedReceiverId && pickedReceiverId !== receiverId) setReceiverId(pickedReceiverId);

    if (frequencyHz == null && mode == null) return;
    const targetReceiverId = pickedReceiverId ?? receiverId ?? receivers.value.active_receiver_id;
    if (!targetReceiverId) return;
    setInitialUrlTune({ receiverId: targetReceiverId, frequencyHz, mode });
  }, [receiverId, receivers]);

  useEffect(() => {
    if (receivers.kind !== 'ready') return;
    if (receiverId && receivers.value.receivers.some((r) => r.id === receiverId)) return;
    setReceiverId(receivers.value.active_receiver_id);
  }, [receiverId, receivers]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LS_PERSIST, String(persistSettings));
    } catch {
      // ignore
    }
  }, [persistSettings]);

  useEffect(() => {
    if (!persistSettings) return;
    try {
      const persisted: PersistedAudioSettings = {
        agcSpeed: audioSettings.agcSpeed,
        agcAttackMs: audioSettings.agcAttackMs,
        agcReleaseMs: audioSettings.agcReleaseMs,
        bufferMode: audioSettings.bufferMode,
      };
      window.localStorage.setItem(LS_AUDIO, JSON.stringify(persisted));
      window.localStorage.setItem(LS_TUNING_STEP, String(tuningStepHz));
      window.localStorage.setItem(LS_AUTO_BAND, String(autoBandMode));
    } catch {
      // ignore
    }
  }, [audioSettings, autoBandMode, persistSettings, tuningStepHz]);

  const preferReceiverForFrequencyHz = (hz: number): string | null => {
    if (receivers.kind !== 'ready') return receiverId;
    const picked = pickReceiverForFrequencyHz(receivers.value, hz, receiverId);
    if (picked && picked !== receiverId) setReceiverId(picked);
    return picked ?? receiverId;
  };

  return (
    <div className="relative min-h-dvh bg-background text-foreground">
      <BackgroundImage />
      <div className="relative z-20 flex min-h-dvh flex-col">
        <BackendReconnectOverlay />
        <TimeSyncOverlay />
        <WebSdrHeader 
          receivers={receivers.kind === 'ready' ? receivers.value.receivers : null}
          receiverId={receiverId}
          onReceiverChange={setReceiverId}
          audioSettings={audioSettings} 
          onAudioSettingsChange={setAudioSettings} 
          tuningStepHz={tuningStepHz} 
          onTuningStepChange={setTuningStepHz}
          debugStats={debugStats}
          autoBandMode={autoBandMode}
          onAutoBandModeChange={setAutoBandMode}
          persistSettings={persistSettings}
          onPersistSettingsChange={setPersistSettings}
        />
        <main className="flex-1 bg-muted/20 lg:min-h-0 lg:overflow-hidden">
          <WebSdrUi 
            receiverId={receiverId}
            onReceiverChange={setReceiverId}
            audioSettings={audioSettings} 
            onAudioSettingsChange={setAudioSettings} 
            tuningStepHz={tuningStepHz}
            onDebugStatsChange={setDebugStats}
            autoBandMode={autoBandMode}
            onPreferReceiverForFrequencyHz={preferReceiverForFrequencyHz}
            initialUrlTune={initialUrlTune}
            onInitialUrlTuneApplied={() => setInitialUrlTune(null)}
          />
        </main>
      </div>
    </div>
  );
}
