import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, PlugZap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useBackendConnection } from '../../lib/backendConnectionContext';
import { Badge } from '../ui/badge';

function labelForSource(source: string): string {
  if (source === 'audio') return 'Audio';
  if (source === 'waterfall') return 'Waterfall';
  if (source === 'events') return 'Events';
  if (source === 'chat') return 'Chat';
  return source ? `${source.slice(0, 1).toUpperCase()}${source.slice(1)}` : 'Backend';
}

function statusText(state: string): string {
  if (state === 'connecting') return 'connecting';
  if (state === 'reconnecting') return 'reconnecting';
  if (state === 'disconnected') return 'disconnected';
  return 'connecting';
}

function indicatorClassForState(state: string): string {
  if (state === 'connected') return 'bg-emerald-500';
  if (state === 'reconnecting') return 'bg-amber-500';
  if (state === 'disconnected') return 'bg-rose-500';
  return 'bg-muted-foreground';
}

export function BackendReconnectOverlay() {
  const { snapshot, everConnected } = useBackendConnection();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [lostSinceMs, setLostSinceMs] = useState<number | null>(null);
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const notConnected = useMemo(() => Object.entries(snapshot).filter(([, s]) => s.state !== 'connected'), [snapshot]);
  const shouldShow = everConnected && notConnected.length > 0;
  const connectionBadges = useMemo(() => {
    const entries = Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b));
    const MAX = 4;
    const display = entries.slice(0, MAX);
    const remaining = Math.max(0, entries.length - display.length);
    return { display, remaining };
  }, [snapshot]);

  useEffect(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    if (shouldShow) {
      setVisible(true);
      setLostSinceMs((prev) => {
        if (prev != null) return prev;
        const changedAtMs = Math.min(...notConnected.map(([, s]) => s.changedAtMs));
        return Number.isFinite(changedAtMs) ? changedAtMs : Date.now();
      });
      return;
    }

    if (!visible) {
      setLostSinceMs(null);
      return;
    }

    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      setLostSinceMs(null);
      hideTimerRef.current = null;
    }, 1500);

    return () => {
      if (hideTimerRef.current != null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [notConnected, shouldShow, visible]);

  useEffect(() => {
    if (!visible) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [visible]);

  const elapsedSec = useMemo(() => {
    if (!visible || lostSinceMs == null) return null;
    const elapsedMs = Math.max(0, nowMs - lostSinceMs);
    return Math.floor(elapsedMs / 1000);
  }, [lostSinceMs, nowMs, visible]);

  const detail = useMemo(() => {
    if (notConnected.length === 0) return null;
    const sorted = [...notConnected].sort(([a], [b]) => a.localeCompare(b));
    const parts = sorted.map(([source, s]) => `${labelForSource(source)} ${statusText(s.state)}`);
    const summary =
      parts.length <= 2 ? parts.join(' / ') : `${parts.slice(0, 2).join(' / ')} / +${parts.length - 2} more`;
    const suffix = elapsedSec == null ? '' : ` (${elapsedSec}s)`;
    return `${summary}${suffix}`;
  }, [elapsedSec, notConnected]);

  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <motion.div
            className="w-full max-w-md rounded-xl border bg-background/90 px-4 py-3 shadow-lg backdrop-blur"
            initial={{ scale: 0.98 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-md border bg-muted/30 p-2">
                <PlugZap className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  Connection to backend lost
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  {connectionBadges.display.map(([source, s]) => (
                    <Badge
                      key={source}
                      variant="outline"
                      className={s.state === 'connected' ? 'border-muted-foreground/20 text-muted-foreground' : 'border-amber-500/30 text-foreground'}
                    >
                      <span className="mr-1 inline-flex items-center">
                        <span className={`h-1.5 w-1.5 rounded-full ${indicatorClassForState(s.state)}`} />
                      </span>
                      {labelForSource(source)}
                    </Badge>
                  ))}
                  {connectionBadges.remaining > 0 ? (
                    <Badge variant="outline" className="border-muted-foreground/20 text-muted-foreground">
                      +{connectionBadges.remaining}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{detail ?? 'Reconnecting...'}</div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
