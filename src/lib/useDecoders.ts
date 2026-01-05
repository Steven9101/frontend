import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type DecoderId = 'ft8';

export type DecodeLine = {
  id: string;
  ts: number;
  decoder: DecoderId;
  text: string;
};

type WorkerIn =
  | { type: 'init'; inputSampleRate: number }
  | { type: 'pcm'; pcm: Float32Array }
  | { type: 'stop' };

type WorkerOut =
  | { type: 'ready' }
  | { type: 'log'; text: string }
  | { type: 'error'; message: string };

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const GRID_RE = /[A-R]{2}[0-9]{2}([A-X]{2})?/i;

export function useDecoders() {
  const [enabled, setEnabled] = useState<Record<DecoderId, boolean>>({ ft8: false });
  const [lines, setLines] = useState<DecodeLine[]>([]);
  const [unread, setUnread] = useState<Record<DecoderId, number>>({ ft8: 0 });
  const [errors, setErrors] = useState<Record<DecoderId, string | null>>({ ft8: null });

  const workerRef = useRef<Worker | null>(null);
  const readyRef = useRef<boolean>(false);
  const inputRateRef = useRef<number | null>(null);

  const pcmAccRef = useRef<Float32Array>(new Float32Array(0));
  const pcmAccLenRef = useRef<number>(0);
  const pcmFlushTimerRef = useRef<number | null>(null);

  const stopWorker = useCallback(() => {
    const w = workerRef.current;
    workerRef.current = null;
    readyRef.current = false;
    inputRateRef.current = null;
    if (pcmFlushTimerRef.current != null) {
      window.clearInterval(pcmFlushTimerRef.current);
      pcmFlushTimerRef.current = null;
    }
    try {
      w?.postMessage({ type: 'stop' } satisfies WorkerIn);
    } catch {
      // ignore
    }
    try {
      w?.terminate();
    } catch {
      // ignore
    }
  }, []);

  const ensureWorker = useCallback((inputSampleRate: number) => {
    if (workerRef.current && inputRateRef.current === inputSampleRate) return;

    stopWorker();

    inputRateRef.current = inputSampleRate;
    const w = new Worker(new URL('../decoders/ft8/ft8Worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = w;

    w.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const msg = ev.data;
      if (msg.type === 'ready') {
        readyRef.current = true;
        return;
      }
      if (msg.type === 'error') {
        setErrors((prev) => ({ ...prev, ft8: String(msg.message ?? 'FT8 worker error') }));
        return;
      }
      if (msg.type === 'log') {
        const text = String(msg.text ?? '').trim();
        if (!text) return;
        // Filter to "real decodes" only: the previous UI only displayed lines that contain a grid locator.
        if (!GRID_RE.test(text)) return;
        // Filter a little noise.
        if (/^ft8_lib\b/i.test(text)) return;
        setLines((prev) => [{ id: makeId(), ts: Date.now(), decoder: 'ft8' as const, text }, ...prev].slice(0, 500));
        setUnread((prev) => ({ ...prev, ft8: prev.ft8 + 1 }));
      }
    };

    w.postMessage({ type: 'init', inputSampleRate } satisfies WorkerIn);

    // Flush PCM to the worker in batches (keeps the UI thread light).
    pcmAccRef.current = new Float32Array(48_000); // ~1s at 48kHz (will grow if needed)
    pcmAccLenRef.current = 0;
    pcmFlushTimerRef.current = window.setInterval(() => {
      const ww = workerRef.current;
      if (!ww || !readyRef.current) return;
      const n = pcmAccLenRef.current;
      if (n <= 0) return;
      const chunk = pcmAccRef.current.subarray(0, n);
      const copy = new Float32Array(chunk); // transferable copy
      pcmAccLenRef.current = 0;
      ww.postMessage({ type: 'pcm', pcm: copy } satisfies WorkerIn, [copy.buffer]);
    }, 250);
  }, [stopWorker]);

  const feedAudio = useCallback(
    (pcm: Float32Array, inputSampleRate: number) => {
      if (!enabled.ft8) return;
      if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) return;
      ensureWorker(inputSampleRate);

      // Accumulate PCM into a staging buffer.
      const needed = pcmAccLenRef.current + pcm.length;
      if (pcmAccRef.current.length < needed) {
        const next = new Float32Array(Math.max(needed, pcmAccRef.current.length * 2, 48_000));
        next.set(pcmAccRef.current.subarray(0, pcmAccLenRef.current), 0);
        pcmAccRef.current = next;
      }
      pcmAccRef.current.set(pcm, pcmAccLenRef.current);
      pcmAccLenRef.current += pcm.length;
    },
    [enabled.ft8, ensureWorker],
  );

  const toggle = useCallback(
    (id: DecoderId, next?: boolean) => {
      setEnabled((prev) => {
        const value = next ?? !prev[id];
        return { ...prev, [id]: value };
      });
      if (id === 'ft8') {
        setErrors((prev) => ({ ...prev, ft8: null }));
        if (next === false) stopWorker();
      }
    },
    [stopWorker],
  );

  const clear = useCallback((id?: DecoderId) => {
    if (!id) {
      setLines([]);
      setUnread({ ft8: 0 });
      return;
    }
    setLines((prev) => prev.filter((l) => l.decoder !== id));
    setUnread((prev) => ({ ...prev, [id]: 0 }));
  }, []);

  const markRead = useCallback((id: DecoderId) => {
    setUnread((prev) => ({ ...prev, [id]: 0 }));
  }, []);

  useEffect(() => {
    // cleanup on unmount
    return () => stopWorker();
  }, [stopWorker]);

  const stats = useMemo(() => {
    return {
      enabled,
      unread,
      totalLines: lines.length,
    };
  }, [enabled, unread, lines.length]);

  return {
    enabled,
    unread,
    lines,
    stats,
    errors,
    toggle,
    clear,
    markRead,
    feedAudio,
  };
}

export type DecodersController = ReturnType<typeof useDecoders>;


