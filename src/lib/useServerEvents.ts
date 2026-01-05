import { useCallback, useMemo, useState } from 'react';

import { useReconnectingWebSocket } from './useReconnectingWebSocket';

export type ServerEventsInfo = {
  waterfall_clients: number;
  signal_clients: number;
  waterfall_kbits: number;
  audio_kbits: number;
  signal_changes?: Record<string, [number, number, number]>;
};

type ServerEventsState =
  | { kind: 'loading' }
  | { kind: 'ready'; value: ServerEventsInfo }
  | { kind: 'error' };

function isServerEventsInfo(v: unknown): v is ServerEventsInfo {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.waterfall_clients === 'number' &&
    typeof obj.signal_clients === 'number' &&
    typeof obj.waterfall_kbits === 'number' &&
    typeof obj.audio_kbits === 'number'
  );
}

export function useServerEvents(): ServerEventsState {
  const [state, setState] = useState<ServerEventsState>({ kind: 'loading' });

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = useMemo(() => `${proto}://${window.location.host}/events`, [proto]);

  const onMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }
    if (!isServerEventsInfo(parsed)) return;
    setState({ kind: 'ready', value: parsed });
  }, []);

  const ws = useReconnectingWebSocket({ source: 'events', url: wsUrl, connectTimeoutMs: 6_000, onMessage });

  if (ws.status !== 'connected' && state.kind !== 'ready') {
    return ws.status === 'connecting' ? { kind: 'loading' } : { kind: 'error' };
  }

  return state;
}


