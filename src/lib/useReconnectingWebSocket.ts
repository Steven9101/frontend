import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useBackendConnection } from './backendConnectionContext';

export type ReconnectingWsStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

type Options = {
  source: string;
  url: string;
  binaryType?: BinaryType;
  connectTimeoutMs?: number;
  onOpen?: (socket: WebSocket) => void;
  onClose?: (event: CloseEvent) => void;
  onMessage?: (event: MessageEvent) => void;
};

function computeDelayMs(attempt: number): number {
  const cappedAttempt = Math.min(8, Math.max(0, attempt));
  const base = Math.min(30_000, 800 * 2 ** cappedAttempt);
  const jitter = base * 0.25 * (Math.random() * 2 - 1);
  return Math.max(800, Math.round(base + jitter));
}

export function useReconnectingWebSocket({ source, url, binaryType, connectTimeoutMs, onOpen, onClose, onMessage }: Options) {
  const { report } = useBackendConnection();
  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const connectIdRef = useRef(0);
  const closedByUserRef = useRef(false);
  const everConnectedRef = useRef(false);
  const lastFailureRef = useRef<string | null>(null);

  const [status, setStatus] = useState<ReconnectingWsStatus>('connecting');

  const clearTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  }, []);

  const close = useCallback(() => {
    closedByUserRef.current = true;
    clearTimer();
    try {
      socketRef.current?.close();
    } catch {
      // ignore
    }
    socketRef.current = null;
    setStatus('disconnected');
    report(source, { state: 'disconnected' });
  }, [clearTimer, report, source]);

  const connect = useCallback(() => {
    clearTimer();
    if (closedByUserRef.current) return;

    connectIdRef.current += 1;
    const connectId = connectIdRef.current;

    const nextState: ReconnectingWsStatus = everConnectedRef.current ? 'reconnecting' : 'connecting';
    setStatus(nextState);
    report(source, { state: nextState === 'connecting' ? 'connecting' : 'reconnecting' });

    try {
      socketRef.current?.close();
    } catch {
      // ignore
    }

    const ws = new WebSocket(url);
    if (binaryType) ws.binaryType = binaryType;
    socketRef.current = ws;

    const isStale = () =>
      closedByUserRef.current || connectIdRef.current !== connectId || socketRef.current !== ws;

    const timeoutMs = Math.max(1_000, Math.round(connectTimeoutMs ?? 8_000));
    connectTimeoutRef.current = window.setTimeout(() => {
      connectTimeoutRef.current = null;
      if (isStale()) return;
      if (ws.readyState === WebSocket.OPEN) return;
      lastFailureRef.current = 'connect timeout';
      try {
        ws.close();
      } catch {
        // ignore
      }
    }, timeoutMs);

    ws.onopen = () => {
      if (isStale()) {
        try {
          ws.close();
        } catch {
          // ignore
        }
        return;
      }
      if (connectTimeoutRef.current != null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
      attemptRef.current = 0;
      everConnectedRef.current = true;
      lastFailureRef.current = null;
      setStatus('connected');
      report(source, { state: 'connected' });
      onOpen?.(ws);
    };

    ws.onmessage = (ev) => {
      onMessage?.(ev);
    };

    ws.onerror = () => {
      if (isStale()) return;
      if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return;
      lastFailureRef.current = 'socket error';
      try {
        ws.close();
      } catch {
        // ignore
      }
    };

    ws.onclose = (ev) => {
      if (isStale()) return;
      if (connectTimeoutRef.current != null) {
        window.clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }

      const attempt = attemptRef.current + 1;
      attemptRef.current = attempt;
      const delay = computeDelayMs(attempt);

      setStatus('reconnecting');
      const reason = lastFailureRef.current ?? `closed (${ev.code})`;
      lastFailureRef.current = null;
      report(source, { state: 'reconnecting', message: `${reason}, retrying in ${delay}ms (attempt ${attempt})` });
      onClose?.(ev);
      reconnectTimerRef.current = window.setTimeout(() => connect(), delay);
    };
  }, [binaryType, clearTimer, connectTimeoutMs, onClose, onMessage, onOpen, report, source, url]);

  useEffect(() => {
    closedByUserRef.current = false;
    connect();
    return () => close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const sendJson = useCallback((msg: unknown): boolean => {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }, []);

  return useMemo(
    () => ({
      status,
      sendJson,
      close,
    }),
    [close, sendJson, status],
  );
}


