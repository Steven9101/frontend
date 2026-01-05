import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useReconnectingWebSocket } from './useReconnectingWebSocket';

export type ChatMessage = {
  id: string;
  username: string;
  message: string;
  timestamp: string;
  user_id: string;
  type: string;
  reply_to_id: string;
  reply_to_username: string;
};

type HistoryEnvelope = { type: 'history'; messages: ChatMessage[] };

function messageMentionsUser(message: string, username: string): boolean {
  const u = username.trim();
  if (!u) return false;
  const escaped = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|\\s)@${escaped}(\\b|$)`, 'i');
  return re.test(message);
}

function isChatMessage(v: unknown): v is ChatMessage {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.username === 'string' &&
    typeof obj.message === 'string' &&
    typeof obj.timestamp === 'string' &&
    typeof obj.user_id === 'string'
  );
}

function isHistoryEnvelope(v: unknown): v is HistoryEnvelope {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  if (obj.type !== 'history') return false;
  if (!Array.isArray(obj.messages)) return false;
  return obj.messages.every(isChatMessage);
}

function loadUsername(): string {
  const raw = window.localStorage.getItem('chatusername') ?? '';
  const trimmed = raw.trim();
  if (trimmed) return trimmed.slice(0, 14);
  return `user${Math.floor(Math.random() * 10_000)}`;
}

function loadUserId(): string {
  const key = 'chatuserid';
  const existing = window.sessionStorage.getItem(key);
  if (existing) return existing;
  const created = `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  window.sessionStorage.setItem(key, created);
  return created;
}

export function useChatClient() {
  const [username, setUsername] = useState(loadUsername);
  const usernameRef = useRef(username);
  const userIdRef = useRef<string>(loadUserId());

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pingToast, setPingToast] = useState<null | { id: string; from: string; text: string }>(null);
  const pingTimerRef = useRef<number | null>(null);
  const historyPrimedRef = useRef(false);
  const seenMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    usernameRef.current = username;
  }, [username]);

  useEffect(() => {
    return () => {
      if (pingTimerRef.current != null) window.clearTimeout(pingTimerRef.current);
    };
  }, []);

  const maybeToastPing = useCallback((m: ChatMessage) => {
    const me = usernameRef.current.trim();
    if (!me) return;
    if (m.username === me) return;
    if (!messageMentionsUser(m.message, me)) return;

    setPingToast({ id: m.id, from: m.username, text: m.message });
    if (pingTimerRef.current != null) window.clearTimeout(pingTimerRef.current);
    pingTimerRef.current = window.setTimeout(() => setPingToast(null), 3200);
  }, []);

  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = useMemo(() => `${proto}://${window.location.host}/chat`, [proto]);

  const onMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(event.data) as unknown;
    } catch {
      return;
    }

    if (isHistoryEnvelope(parsed)) {
      historyPrimedRef.current = true;
      const nextSeen = seenMessageIdsRef.current;
      for (const m of parsed.messages) nextSeen.add(m.id);
      setMessages(parsed.messages);
      return;
    }
    if (isChatMessage(parsed)) {
      const nextSeen = seenMessageIdsRef.current;
      if (nextSeen.has(parsed.id)) return;
      nextSeen.add(parsed.id);
      setMessages((prev) => [...prev, parsed]);
      if (historyPrimedRef.current) maybeToastPing(parsed);
      return;
    }
  }, [maybeToastPing]);

  const ws = useReconnectingWebSocket({
    source: 'chat',
    url: wsUrl,
    connectTimeoutMs: 6_000,
    onMessage,
    onOpen: () => setLastError(null),
    onClose: () => setLastError('reconnecting'),
  });

  const setAndPersistUsername = useCallback((next: string) => {
    const normalized = next.trim().slice(0, 14);
    setUsername(normalized || 'user');
    try {
      window.localStorage.setItem('chatusername', normalized);
    } catch {
      // ignore
    }
  }, []);

  const send = useCallback(
    (message: string, reply?: { id: string; username: string }) => {
      const trimmed = message.trim();
      if (!trimmed) return false;
      const payload: Record<string, unknown> = {
        cmd: 'chat',
        message: trimmed,
        username,
        user_id: userIdRef.current,
      };
      if (reply) {
        payload.reply_to_id = reply.id;
        payload.reply_to_username = reply.username;
      }
      const ok = ws.sendJson(payload);
      if (!ok) setLastError('not connected');
      return ok;
    },
    [username, ws],
  );

  return {
    status: ws.status,
    messages,
    username,
    setUsername: setAndPersistUsername,
    send,
    lastError,
    pingToast,
  };
}



