import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Clock, Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useBackendConnection } from '../../lib/backendConnectionContext';
import { persistDailyTimeSyncResult, readTimeOffsetMs, shouldRunDailyTimeSync } from '../../lib/timeSync';

type Phase = 'checking' | 'success' | 'error';

async function fetchEstimatedOffsetMs(): Promise<number> {
  const t0 = Date.now();
  const res = await fetch('https://worldtimeapi.org/api/ip', { cache: 'no-store' });
  const t1 = Date.now();
  if (!res.ok) throw new Error(`time api ${res.status}`);
  const json = (await res.json()) as unknown;

  let serverMs: number | null = null;
  if (typeof (json as any)?.unixtime === 'number' && Number.isFinite((json as any).unixtime)) {
    serverMs = Math.round((json as any).unixtime * 1000);
  } else if (typeof (json as any)?.utc_datetime === 'string') {
    const parsed = Date.parse((json as any).utc_datetime);
    if (Number.isFinite(parsed)) serverMs = Math.round(parsed);
  } else if (typeof (json as any)?.datetime === 'string') {
    const parsed = Date.parse((json as any).datetime);
    if (Number.isFinite(parsed)) serverMs = Math.round(parsed);
  }

  if (serverMs == null) throw new Error('time api response missing time');
  const midpoint = Math.round((t0 + t1) / 2);
  return serverMs - midpoint;
}

export function TimeSyncOverlay() {
  const { snapshot, everConnected } = useBackendConnection();
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<Phase>('checking');
  const [offsetMs, setOffsetMs] = useState<number | null>(null);
  const [detail, setDetail] = useState<string>('Checking browser clock…');
  const hideTimerRef = useRef<number | null>(null);
  const startedRef = useRef(false);
  const backendStableSinceMsRef = useRef<number | null>(null);
  const visibleSinceMsRef = useRef<number | null>(null);

  const backendStable = useMemo(() => {
    const keys = Object.keys(snapshot);
    if (!everConnected) return false;
    if (keys.length === 0) return false;
    return Object.values(snapshot).every((s) => s.state === 'connected');
  }, [everConnected, snapshot]);

  useEffect(() => {
    if (!backendStable) {
      backendStableSinceMsRef.current = null;
      return;
    }
    if (backendStableSinceMsRef.current == null) {
      backendStableSinceMsRef.current = Date.now();
    }
  }, [backendStable]);

  useEffect(() => {
    const force =
      typeof window !== 'undefined' &&
      (new URLSearchParams(window.location.search).get('force_time_sync') === '1' ||
        new URLSearchParams(window.location.search).get('force_time_sync') === 'true');

    if (!force && !shouldRunDailyTimeSync()) return;
    if (!backendStable) return;
    if (startedRef.current) return;
    startedRef.current = true;

    const WAIT_AFTER_BACKEND_MS = 2500;
    const START_DELAY_MS = 1200;
    const MIN_CHECK_MS = 1500;
    const MIN_TOTAL_VISIBLE_MS = 6000;
    const HOLD_RESULT_MS = 3200;

    let canceled = false;
    const stableSince = backendStableSinceMsRef.current ?? Date.now();
    const stableForMs = Date.now() - stableSince;
    const delayMs = Math.max(0, WAIT_AFTER_BACKEND_MS - stableForMs) + START_DELAY_MS;

    const startTimer = window.setTimeout(() => {
      if (!backendStable) {
        startedRef.current = false;
        return;
      }

      setVisible(true);
      setPhase('checking');
      setDetail('Checking browser clock…');
      setOffsetMs(null);
      visibleSinceMsRef.current = Date.now();
      const startMs = Date.now();

      (async () => {
        const MAX_ATTEMPTS = 3; // initial + 2 retries
        let ok = false;
        let lastOffset: number | null = null;

        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
          try {
            if (attempt > 0) setDetail(`Retrying time sync (${attempt}/2)…`);
            const offset = await fetchEstimatedOffsetMs();
            ok = true;
            lastOffset = offset;
            break;
          } catch {
            if (attempt >= MAX_ATTEMPTS - 1) break;
            const backoffMs = Math.round(900 * Math.pow(2, attempt) + Math.random() * 150);
            await new Promise((r) => setTimeout(r, backoffMs));
            if (canceled) return;
          }
        }

        const elapsed = Date.now() - startMs;
        const remaining = Math.max(0, MIN_CHECK_MS - elapsed);
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
        if (canceled) return;

        if (ok && lastOffset != null) {
          setOffsetMs(lastOffset);
          persistDailyTimeSyncResult(lastOffset);
          setPhase('success');
          setDetail('Time check complete (used for FT8 timing).');
        } else {
          const previous = readTimeOffsetMs();
          persistDailyTimeSyncResult(previous);
          setOffsetMs(previous);
          setPhase('error');
          setDetail('Time sync failed; using last offset.');
        }

        if (hideTimerRef.current != null) window.clearTimeout(hideTimerRef.current);
        const visibleSince = visibleSinceMsRef.current ?? Date.now();
        const shownForMs = Date.now() - visibleSince;
        const hideAfterMs = Math.max(HOLD_RESULT_MS, MIN_TOTAL_VISIBLE_MS - shownForMs);
        hideTimerRef.current = window.setTimeout(() => {
          setVisible(false);
          hideTimerRef.current = null;
          visibleSinceMsRef.current = null;
        }, hideAfterMs);
      })();
    }, delayMs);

    return () => {
      canceled = true;
      window.clearTimeout(startTimer);
      startedRef.current = false;
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [backendStable]);

  const title = useMemo(() => {
    if (phase === 'checking') return 'Syncing time';
    if (phase === 'success') return 'Time synced';
    return 'Time sync failed';
  }, [phase]);

  const icon = useMemo(() => {
    if (phase === 'checking') return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
    if (phase === 'success') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    return <TriangleAlert className="h-4 w-4 text-amber-500" />;
  }, [phase]);

  const offsetLabel = useMemo(() => {
    if (offsetMs == null) return null;
    const sign = offsetMs >= 0 ? '+' : '';
    return `${sign}${offsetMs}ms`;
  }, [offsetMs]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            className="w-full max-w-md rounded-xl border bg-background/90 px-4 py-3 shadow-lg backdrop-blur"
            initial={{ scale: 0.98 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.98 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md border bg-muted/30 p-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={phase}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      className="inline-flex"
                    >
                      {icon}
                    </motion.span>
                  </AnimatePresence>
                  {title}
                </div>
                <AnimatePresence mode="wait">
                  <motion.div
                    key={`${phase}:${detail}`}
                    className="mt-1 text-xs text-muted-foreground"
                    initial={{ opacity: 0, y: -2 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -2 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  >
                    {detail}
                    {offsetLabel ? ` Offset ${offsetLabel}.` : null}
                  </motion.div>
                </AnimatePresence>
                {phase === 'checking' ? (
                  <div className="mt-2 h-1 w-full overflow-hidden rounded bg-muted/40">
                    <motion.div
                      className="h-full w-1/2 bg-muted-foreground/35"
                      initial={{ x: '-120%' }}
                      animate={{ x: '220%' }}
                      transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
