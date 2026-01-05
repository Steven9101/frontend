import { CornerUpLeft, MessageSquare, Reply, Send, User } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AnimatedDialog } from '../../ui/animated-dialog';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { ScrollArea } from '../../ui/scroll-area';
import { useChatClient, type ChatMessage } from '../../../lib/useChatClient';
import { fetchServerInfo } from '../../../lib/serverInfo';
import { normalizeReceiverMode, type ReceiverMode } from '../../../lib/receiverMode';

type Props = {
  centerHz: number | null;
  mode: ReceiverMode;
  receiverId: string | null;
  onTune: (hz: number, mode: ReceiverMode, receiverId?: string) => void;
};

function mentionToken(username: string): string {
  const u = String(username ?? '').trim();
  if (!u) return '';
  if (/\s/.test(u)) return `@[${u}] `;
  return `@${u} `;
}

function formatFreqLabel(hz: number): string {
  const khz = hz / 1_000;
  if (Math.abs(khz) < 1_000) return `${khz.toFixed(3)} kHz`;
  const mhz = hz / 1_000_000;
  return `${mhz.toFixed(6)} MHz`;
}

export function ChatPanel({ centerHz, mode, receiverId, onTune }: Props) {
  const chat = useChatClient();
  const [serverChatEnabled, setServerChatEnabled] = useState<boolean | null>(null);
  const [draft, setDraft] = useState('');
  const [usernameOpen, setUsernameOpen] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState('');
  const [replyTo, setReplyTo] = useState<null | { id: string; username: string }>(null);
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionReplace, setMentionReplace] = useState<null | { start: number; end: number }>(null);
  const [newMessages, setNewMessages] = useState(0);
  const lastMessageCountRef = useRef(0);
  const isAtBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  const isViewportNearBottom = useCallback((viewport: HTMLElement): boolean => {
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    return distance <= 24;
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    fetchServerInfo(ctrl.signal)
      .then((info) => setServerChatEnabled(info.chatEnabled))
      .catch(() => setServerChatEnabled(null));
    return () => ctrl.abort();
  }, []);

  const handleUsernameOpenChange = useCallback(
    (open: boolean) => {
      setUsernameOpen(open);
      if (open) setUsernameDraft(chat.username);
    },
    [chat.username],
  );

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;

    let raf = 0;
    const onScroll = () => {
      const atBottom = isViewportNearBottom(viewport);
      isAtBottomRef.current = atBottom;
      if (!atBottom) return;

      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => setNewMessages(0));
    };

    viewport.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      window.cancelAnimationFrame(raf);
      viewport.removeEventListener('scroll', onScroll);
    };
  }, [isViewportNearBottom]);

  useEffect(() => {
    const count = chat.messages.length;
    const prev = lastMessageCountRef.current;
    lastMessageCountRef.current = count;
    if (count === 0) return;

    const delta = Math.max(0, count - prev);
    if (!initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true;
      const id = window.requestAnimationFrame(() => scrollToBottom());
      return () => window.cancelAnimationFrame(id);
    }

    if (delta === 0) return;
    if (isAtBottomRef.current) {
      const id = window.requestAnimationFrame(() => scrollToBottom());
      return () => window.cancelAnimationFrame(id);
    }

    setNewMessages((n) => n + delta);
  }, [chat.messages.length, scrollToBottom]);

  const canSend = serverChatEnabled !== false && chat.status === 'connected' && draft.trim().length > 0;

  const shareToken = useMemo(() => {
    if (centerHz == null) return null;
    const rx = receiverId ? `:${receiverId}` : '';
    return `[FREQ:${Math.round(centerHz)}:${mode}${rx}]`;
  }, [centerHz, mode, receiverId]);

  const handleSend = () => {
    const ok = chat.send(draft, replyTo ?? undefined);
    if (!ok) return;
    setDraft('');
    setReplyTo(null);
    setNewMessages(0);
    scrollToBottom();
  };

  const usernames = useMemo(() => {
    const set = new Set<string>();
    for (const m of chat.messages) {
      const u = String(m.username ?? '').trim();
      if (u) set.add(u);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [chat.messages]);

  const mentionSuggestions = useMemo(() => {
    if (!mentionOpen) return [];
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return usernames.slice(0, 8);
    return usernames.filter((u) => u.toLowerCase().startsWith(q)).slice(0, 8);
  }, [mentionOpen, mentionQuery, usernames]);

  const pasteFrequency = useCallback(() => {
    if (!shareToken) return;
    setDraft((prev) => (prev ? `${prev} ${shareToken}` : shareToken));
  }, [shareToken]);

  const messagesById = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of chat.messages) map.set(m.id, m);
    return map;
  }, [chat.messages]);

  const renderedMessages = chat.messages.map((m) => (
        <ChatMessageRow
          key={m.id}
          msg={m}
          replyPreview={m.reply_to_id ? messagesById.get(m.reply_to_id)?.message ?? null : null}
          isPinged={messageMentionsUser(m.message, chat.username)}
          onReply={() => {
            setReplyTo({ id: m.id, username: m.username });
        const token = mentionToken(m.username);
            setDraft((prev) => {
              if (!token) return prev;
              if (prev.startsWith(token) || prev.includes(token.trim())) return prev;
              return `${token}${prev}`;
            });
            window.requestAnimationFrame(() => {
              const el = inputRef.current;
              if (!el) return;
              el.focus();
              // If we inserted the mention at the start, keep the caret right after it.
              if (token && el.value.startsWith(token)) {
                el.setSelectionRange(token.length, token.length);
              }
            });
          }}
          onTune={onTune}
        />
  ));

  return (
    <Card className="flex min-h-0 flex-col shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Chat</CardTitle>
        </div>
        <AnimatedDialog
          open={usernameOpen}
          onOpenChange={handleUsernameOpenChange}
          title="Chat username"
          description="This name is shown to others in chat."
          trigger={
            <Button type="button" variant="secondary" size="sm" className="gap-2">
              <User className="h-4 w-4" />
              {chat.username}
            </Button>
          }
          contentClassName="max-w-sm"
          footer={
            <>
              <Button type="button" variant="secondary" onClick={() => setUsernameOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  chat.setUsername(usernameDraft);
                  setUsernameOpen(false);
                }}
                disabled={usernameDraft.trim().length === 0}
              >
                Save
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <Label className="text-sm font-medium">Username</Label>
            <Input 
              value={usernameDraft} 
              onChange={(e) => setUsernameDraft(e.target.value)} 
              placeholder={chat.username}
              className="font-medium"
            />
            <p className="text-xs text-muted-foreground">This name is shown to others when you send messages.</p>
        </div>
        </AnimatedDialog>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 pb-4 pt-0">
        <div className="relative">
          <ScrollArea ref={scrollAreaRef} className="h-[240px] min-h-0 rounded-md border bg-background">
            {renderedMessages.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Reply className="h-4 w-4" />
                  No messages.
                </div>
              </div>
            ) : (
              <div className="space-y-2 p-3">
                {renderedMessages}
              </div>
            )}
          </ScrollArea>

          <AnimatePresence>
            {newMessages > 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-x-3 bottom-3 z-20"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between rounded-md border bg-background/95 px-3 py-2 text-xs shadow-md backdrop-blur hover:bg-background"
                  onClick={() => {
                    setNewMessages(0);
                    scrollToBottom();
                  }}
                >
                  <span className="text-muted-foreground">
                    {newMessages} new message{newMessages === 1 ? '' : 's'}
                  </span>
                  <span className="font-medium">Jump to latest</span>
                </button>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {replyTo ? (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <CornerUpLeft className="h-4 w-4" />
              Replying to <span className="font-medium text-foreground">{replyTo.username}</span>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setReplyTo(null)}>
              Cancel
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
          <Input
              ref={inputRef}
            placeholder={serverChatEnabled === false ? 'Chat disabled on this server' : 'Message'}
            value={draft}
              onChange={(e) => {
                const next = e.target.value;
                setDraft(next);

                const cursor = e.target.selectionStart ?? next.length;
                const before = next.slice(0, cursor);
                const match = before.match(/(^|\s)@([^\s@]{0,14})$/);
                if (!match) {
                  setMentionOpen(false);
                  setMentionQuery('');
                  setMentionReplace(null);
                  return;
                }
                const query = match[2] ?? '';
                const atPos = before.lastIndexOf('@');
                if (atPos < 0) return;
                setMentionOpen(true);
                setMentionQuery(query);
                setMentionReplace({ start: atPos, end: cursor });
              }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              handleSend();
            }}
            disabled={serverChatEnabled === false}
          />
            {mentionOpen && mentionSuggestions.length > 0 ? (
              <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-30 overflow-hidden rounded-md border bg-background shadow-md">
                <div className="p-1">
                  {mentionSuggestions.map((u) => (
                    <button
                      key={u}
                      type="button"
                      className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        if (!mentionReplace) return;
                        const token = mentionToken(u);
                        setDraft((prev) => {
                          const start = mentionReplace.start;
                          const end = mentionReplace.end;
                          return `${prev.slice(0, start)}${token}${prev.slice(end)}`;
                        });
                        setMentionOpen(false);
                        setMentionQuery('');
                        setMentionReplace(null);
                        window.requestAnimationFrame(() => {
                          const el = inputRef.current;
                          if (!el) return;
                          const nextPos = mentionReplace.start + token.length;
                          el.setSelectionRange(nextPos, nextPos);
                          el.focus();
                        });
                      }}
                    >
                      <span className="font-medium">{u}</span>
                      <span className="text-xs text-muted-foreground">@</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2 sm:justify-end">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="sm:hidden"
              aria-label="Paste frequency token"
              onClick={pasteFrequency}
              disabled={shareToken == null}
            >
              <Reply className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="hidden gap-2 sm:inline-flex"
              onClick={pasteFrequency}
              disabled={shareToken == null}
            >
              <Reply className="h-4 w-4" />
              Paste freq
            </Button>

            <Button type="button" className="w-full gap-2 sm:w-auto" onClick={handleSend} disabled={!canSend}>
              <Send className="h-4 w-4" />
              Send
            </Button>
          </div>
        </div>
      </CardContent>

      {chat.pingToast ? (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2">
          <div className="animate-in slide-in-from-bottom-2 fade-in rounded-md border bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
            <div className="text-xs text-muted-foreground">
              Mention from <span className="font-medium text-foreground">{chat.pingToast.from}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-sm text-foreground">{chat.pingToast.text}</div>
          </div>
          </div>
        ) : null}
    </Card>
  );
}

function ChatMessageRow({
  msg,
  replyPreview,
  isPinged,
  onReply,
  onTune,
}: {
  msg: ChatMessage;
  replyPreview: string | null;
  isPinged: boolean;
  onReply: () => void;
  onTune: (hz: number, mode: ReceiverMode, receiverId?: string) => void;
}) {
  const parts = useMemo(() => splitMessageParts(msg.message), [msg.message]);

  return (
    <div className={isPinged ? 'rounded-md border border-yellow-500/40 bg-yellow-500/5 px-3 py-2' : 'rounded-md border bg-background px-3 py-2'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs text-muted-foreground">{msg.timestamp}</span>
            <span className="text-xs font-medium">{msg.username}</span>
          </div>
          {msg.reply_to_username ? (
            <div className="mt-1 text-xs text-muted-foreground">
              Replying to <span className="font-medium text-foreground">{msg.reply_to_username}</span>
              {replyPreview ? (
                <span className="ml-2 text-muted-foreground">&quot;{truncateReplyPreview(replyPreview)}&quot;</span>
              ) : null}
            </div>
          ) : null}
          <div className="mt-1 text-sm">
            {parts.map((p, idx) => {
              if (p.kind === 'text') return <span key={idx}>{p.text}</span>;
              if (p.kind === 'link') {
                return (
                  <a key={idx} href={p.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    {p.text}
                  </a>
                );
              }
              if (p.kind === 'mention') {
                return (
                  <span
                    key={idx}
                    className="mx-0.5 inline-flex items-center rounded-md bg-amber-500/10 px-1.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300"
                  >
                    {p.text}
                  </span>
                );
              }
              return (
                <button
                  key={idx}
                  type="button"
                  className="mx-1 inline-flex items-center rounded-md border bg-muted/20 px-2 py-0.5 text-xs font-medium hover:bg-muted/30"
                  onClick={() => onTune(p.hz, p.mode, p.receiverId)}
                >
                  {formatFreqLabel(p.hz)} / {p.mode}
                </button>
              );
            })}
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label="Reply" onClick={onReply}>
          <CornerUpLeft className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function messageMentionsUser(message: string, username: string): boolean {
  const u = username.trim();
  if (!u) return false;
  const escaped = u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bracketed = new RegExp(`(^|\\s)@\\[${escaped}\\](\\s|$)`, 'i');
  if (bracketed.test(message)) return true;
  const plain = new RegExp(`(^|\\s)@${escaped}(\\b|$)`, 'i');
  return plain.test(message);
}

function truncateReplyPreview(text: string): string {
  const normalized = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= 80) return normalized;
  return `${normalized.slice(0, 77)}â€¦`;
}

type MsgPart =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'freq'; hz: number; mode: ReceiverMode; receiverId?: string }
  | { kind: 'mention'; text: string; username: string };

function splitMessageParts(raw: string): MsgPart[] {
  const out: MsgPart[] = [];
  const tokenRe = /\[FREQ:(\d+):([\w-]+)(?::([\w-]+))?\]/g;

  let last = 0;
  for (;;) {
    const m = tokenRe.exec(raw);
    if (!m) break;
    if (m.index > last) out.push(...splitLinks(raw.slice(last, m.index)));
    const hz = Number.parseInt(m[1] ?? '', 10);
    const mode = normalizeReceiverMode(m[2] ?? '');
    const rx = (m[3] ?? '').trim();
    if (Number.isFinite(hz) && hz > 0) out.push({ kind: 'freq', hz, mode, receiverId: rx || undefined });
    last = m.index + m[0].length;
  }
  if (last < raw.length) out.push(...splitLinks(raw.slice(last)));
  return out;
}

function splitLinks(text: string): MsgPart[] {
  const urlRe = /(https?:\/\/[^\s]+)/g;
  const parts: MsgPart[] = [];
  let last = 0;
  for (;;) {
    const m = urlRe.exec(text);
    if (!m) break;
    if (m.index > last) parts.push(...splitMentions(text.slice(last, m.index)));
    const url = m[0] ?? '';
    parts.push({ kind: 'link', text: url, url });
    last = m.index + url.length;
  }
  if (last < text.length) parts.push(...splitMentions(text.slice(last)));
  return parts;
}

function splitMentions(text: string): MsgPart[] {
  const out: MsgPart[] = [];
  const re = /(^|\s)@(?:\[([^\]\r\n]{1,64})\]|([^\s@]{1,14}))/g;
  let last = 0;
  for (;;) {
    const m = re.exec(text);
    if (!m) break;
    const full = m[0] ?? '';
    const prefix = m[1] ?? '';
    const username = (m[2] ?? m[3] ?? '').trim();
    const start = m.index + prefix.length;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    out.push({ kind: 'mention', text: `@${username}`, username });
    last = m.index + full.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
