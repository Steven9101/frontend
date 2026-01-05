import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark as BookmarkIcon, Copy, Cpu, Download, Layers, Link2, Radio, Trash2, Upload } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Bookmark } from '../../lib/bookmarks';
import { createBookmarkId, exportBookmarks, importBookmarks, loadBookmarks, saveBookmarks } from '../../lib/bookmarks';
import { copyTextToClipboard } from '../../lib/clipboard';
import type { DecodersController } from '../../lib/useDecoders';
import { AnimatedDialog } from '../ui/animated-dialog';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { ScrollArea } from '../ui/scroll-area';
import { DEFAULT_BANDS } from './bands';
import type { WaterfallSettings } from './protocol';
import { WaterfallView, type BandModeOverlay, type BandOverlay } from './WaterfallView';
import { MobileWaterfallBar } from './MobileWaterfallBar';
import type { WaterfallDisplaySettings } from './viewSettings';
import { AnimatedBottomSheet } from '../ui/animated-bottom-sheet';
import type { ReceiverMode } from '../../lib/receiverMode';

type Props = {
  receiverId: string | null;
  mode: ReceiverMode;
  centerHz: number | null;
  onSetMode?: (mode: Props['mode']) => void;
  frequencyAdjust: { nonce: number; deltaHz: number } | null;
  frequencySet: { nonce: number; centerHz: number } | null;
  bandwidthAdjust: { nonce: number; deltaHz: number } | null;
  resetTune: { nonce: number; vfo: 'A' | 'B' } | null;
  display: WaterfallDisplaySettings;
  onDisplayChange: Dispatch<SetStateAction<WaterfallDisplaySettings>>;
  tuningStepHz: number;
  decoders: DecodersController;
  currentVfo: 'A' | 'B';
  onToggleVfo: () => void;
  gridLocator: string | null;
  passbandSet?: { nonce: number; l: number; m: number; r: number } | null;
  viewportSet?: { nonce: number; l: number; r: number } | null;
  viewport?: { l: number; r: number } | null;
  passbandCenterIdx?: number | null;
  onViewportSet?: (vp: { l: number; r: number }) => void;
  audioMute?: boolean;
  onToggleAudioMute?: () => void;
  onViewportChange?: (vp: { l: number; r: number }) => void;
  onTuningChange: (t: { centerHz: number; bandwidthHz: number }) => void;
  onSetFrequencyHz?: (hz: number) => void;
  onPassbandChange?: (p: { l: number; m: number; r: number }) => void;
  onServerDefaults?: (d: WaterfallSettings['defaults']) => void;
  onServerSettings?: (s: WaterfallSettings) => void;
  onBandsChange?: (bands: BandOverlay[]) => void;
};

function parseBands(raw: unknown): BandOverlay[] | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }

  const arr = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as { bands?: unknown }).bands)
      ? (parsed as { bands: unknown[] }).bands
      : null;
  if (!arr) return null;

  const out: BandOverlay[] = [];
  for (const b of arr) {
    if (typeof b !== 'object' || b == null) continue;
    const obj = b as {
      name?: unknown;
      startHz?: unknown;
      startFreq?: unknown;
      endHz?: unknown;
      endFreq?: unknown;
      color?: unknown;
      modes?: unknown;
    };
    if (typeof obj.name !== 'string' || !obj.name.trim()) continue;
    const startRaw = obj.startHz ?? obj.startFreq;
    const endRaw = obj.endHz ?? obj.endFreq;
    if (typeof startRaw !== 'number' || !Number.isFinite(startRaw)) continue;
    if (typeof endRaw !== 'number' || !Number.isFinite(endRaw)) continue;
    const startHz = Math.round(startRaw);
    const endHz = Math.round(endRaw);
    if (startHz <= 0 || endHz <= startHz) continue;

    let modes: BandModeOverlay[] | undefined;
    if (Array.isArray(obj.modes)) {
      const parsedModes: BandModeOverlay[] = [];
      for (const m of obj.modes) {
        if (typeof m !== 'object' || m == null) continue;
        const mo = m as { mode?: unknown; startHz?: unknown; startFreq?: unknown; endHz?: unknown; endFreq?: unknown };
        if (typeof mo.mode !== 'string') continue;
        const upper = mo.mode.trim().toUpperCase();
        if (upper !== 'USB' && upper !== 'LSB' && upper !== 'CW' && upper !== 'AM' && upper !== 'SAM' && upper !== 'FM' && upper !== 'FMC' && upper !== 'WBFM') {
          continue;
        }
        const mStartRaw = mo.startHz ?? mo.startFreq;
        const mEndRaw = mo.endHz ?? mo.endFreq;
        if (typeof mStartRaw !== 'number' || !Number.isFinite(mStartRaw)) continue;
        if (typeof mEndRaw !== 'number' || !Number.isFinite(mEndRaw)) continue;
        const mStartHz = Math.round(mStartRaw);
        const mEndHz = Math.round(mEndRaw);
        if (mStartHz <= 0 || mEndHz < mStartHz) continue;
        parsedModes.push({ mode: upper as ReceiverMode, startHz: mStartHz, endHz: mEndHz });
      }
      if (parsedModes.length > 0) modes = parsedModes;
    }

    out.push({
      name: obj.name,
      startHz,
      endHz,
      color: typeof obj.color === 'string' ? obj.color : undefined,
      modes,
    });
  }
  return out.length > 0 ? out : null;
}

export function WaterfallCard({
  receiverId,
  mode,
  centerHz,
  onSetMode,
  frequencyAdjust,
  frequencySet,
  bandwidthAdjust,
  resetTune,
  display,
  onDisplayChange,
  tuningStepHz,
  decoders,
  currentVfo,
  onToggleVfo,
  gridLocator,
  passbandSet,
  viewportSet,
  viewport,
  passbandCenterIdx,
  onViewportSet,
  audioMute,
  onToggleAudioMute,
  onViewportChange,
  onTuningChange,
  onSetFrequencyHz,
  onPassbandChange,
  onServerDefaults,
  onServerSettings,
  onBandsChange,
}: Props) {
  const [status, setStatus] = useState<'connecting' | 'ready' | 'error'>('connecting');
  const [settings, setSettings] = useState<WaterfallSettings | null>(null);
  const [bands, setBands] = useState<BandOverlay[]>(DEFAULT_BANDS);
  const [error, setError] = useState<string | null>(null);
  const [bandsOpen, setBandsOpen] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [decodersOpen, setDecodersOpen] = useState(false);
  const [decodesOpen, setDecodesOpen] = useState(false);
  const [mobileZoomOpen, setMobileZoomOpen] = useState(false);
  const [mobileBandsOpen, setMobileBandsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [mobileDecodersOpen, setMobileDecodersOpen] = useState(false);
  const [mobileBookmarksOpen, setMobileBookmarksOpen] = useState(false);
  const [mobileShareOpen, setMobileShareOpen] = useState(false);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => {
    try {
      return loadBookmarks();
    } catch {
      return [];
    }
  });
  const [bookmarkName, setBookmarkName] = useState('');
  const [bookmarkNotes, setBookmarkNotes] = useState('');
  const [copiedShare, setCopiedShare] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const onServerDefaultsRef = useRef<Props['onServerDefaults']>(onServerDefaults);
  useEffect(() => {
    onServerDefaultsRef.current = onServerDefaults;
  }, [onServerDefaults]);

  const onServerSettingsRef = useRef<Props['onServerSettings']>(onServerSettings);
  useEffect(() => {
    onServerSettingsRef.current = onServerSettings;
  }, [onServerSettings]);

  const onBandsChangeRef = useRef<Props['onBandsChange']>(onBandsChange);
  useEffect(() => {
    onBandsChangeRef.current = onBandsChange;
  }, [onBandsChange]);

  const handleConnected = useCallback(
    (s: WaterfallSettings) => {
    setSettings(s);
    setStatus('ready');
    setError(null);
      onServerDefaultsRef.current?.(s.defaults);
      const parsedBands = parseBands(s.bands);
      const nextBands = parsedBands ?? DEFAULT_BANDS;
      setBands(nextBands);
      onBandsChangeRef.current?.(nextBands);
      onServerSettingsRef.current?.(s);
    },
    [],
  );

  const handleError = useCallback((msg: string) => {
    setStatus('error');
    setError(msg);
  }, []);

  const handleConnecting = useCallback(() => {
    setStatus('connecting');
    setError(null);
  }, []);

  const connectionText = useMemo(() => {
    if (status === 'connecting') return 'Connecting…';
    if (status === 'error') return `Disconnected: ${error ?? 'unknown error'}`;
    return null;
  }, [error, status]);

  const displayConnectionText = status === 'connecting' ? 'Connecting…' : connectionText;

  const ituRegion = useMemo(() => {
    const grid = (gridLocator ?? '').trim();
    if (!/^[A-R]{2}[0-9]{2}([A-X]{2})?$/i.test(grid)) return 1 as const;
    const coords = maidenheadToCoords(grid);
    if (!coords) return 1 as const;
    return getItuRegion(coords.lat, coords.lon);
  }, [gridLocator]);

  const bandGroups = useMemo(() => {
    const ham = hamBandsForItuRegion(ituRegion);
    const broadcast: BandOverlay[] = [];
    const other: BandOverlay[] = [];
    for (const b of bands) {
      if (/\bHAM\b/i.test(b.name)) continue;
      if (/\bAM\b/i.test(b.name)) broadcast.push(b);
      else other.push(b);
    }
    return { ham, broadcast, other };
  }, [bands, ituRegion]);

  const jumpToBand = useCallback(
    (startHz: number, endHz: number) => {
      const centerHz = Math.round((startHz + endHz) / 2);
      const s = settings;
      if (s && onViewportSet) {
        const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
        const hzToIdx = (hz: number) => {
          const t = clamp((hz - s.basefreq) / s.total_bandwidth, 0, 1);
          return Math.round(t * s.fft_result_size);
        };
        const l = hzToIdx(startHz);
        const r = hzToIdx(endHz);
        if (r > l) onViewportSet({ l, r });
      }
      onSetFrequencyHz?.(centerHz);
    },
    [onSetFrequencyHz, onViewportSet, settings],
  );

  const saveBookmark = useCallback(() => {
    if (centerHz == null) return;
    const name = bookmarkName.trim();
    if (!name) return;
    const next: Bookmark = {
      id: createBookmarkId(),
      name,
      frequencyHz: Math.round(centerHz),
      mode,
      notes: bookmarkNotes.trim() || undefined,
      createdAtMs: Date.now(),
    };
    setBookmarks((prev) => {
      const updated = [...prev, next];
      saveBookmarks(updated);
      return updated;
    });
    setBookmarkName('');
    setBookmarkNotes('');
  }, [bookmarkName, bookmarkNotes, centerHz, mode]);

  const deleteBookmark = useCallback((id: string) => {
    setBookmarks((prev) => {
      const updated = prev.filter((b) => b.id !== id);
      saveBookmarks(updated);
      return updated;
    });
  }, []);

  const tuneToBookmark = useCallback(
    (b: Bookmark) => {
      onSetMode?.(b.mode);
      onSetFrequencyHz?.(b.frequencyHz);
      setBookmarkOpen(false);
    },
    [onSetFrequencyHz, onSetMode],
  );

  const handleExport = useCallback(() => {
    const data = exportBookmarks(bookmarks);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bookmarks.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [bookmarks]);

  const triggerImport = useCallback(() => {
    importInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      if (!text) return;
      let imported: Bookmark[];
      try {
        imported = importBookmarks(text);
      } catch {
        return;
      }
      if (imported.length === 0) return;
      setBookmarks((prev) => {
        const seen = new Set<string>();
        const keyOf = (b: Bookmark) => `${b.name.trim().toLowerCase()}|${b.frequencyHz}|${b.mode}`;
        for (const b of prev) seen.add(keyOf(b));
        const merged = [...prev];
        for (const b of imported) {
          const k = keyOf(b);
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(b);
        }
        saveBookmarks(merged);
        return merged;
      });
    };
    reader.readAsText(file);
  }, []);

  const bookmarkLink = useCallback((b: Bookmark): string => {
    const url = new URL(window.location.href);
    url.searchParams.set('frequency', String(Math.round(b.frequencyHz)));
    url.searchParams.set('modulation', b.mode);
    if (receiverId) url.searchParams.set('rx', receiverId);
    return url.toString();
  }, [receiverId]);

  const shareLink = useMemo(() => {
    if (centerHz == null) return null;
    const url = new URL(window.location.href);
    url.searchParams.set('frequency', String(Math.round(centerHz)));
    url.searchParams.set('modulation', mode);
    if (receiverId) url.searchParams.set('rx', receiverId);
    return url.toString();
  }, [centerHz, mode, receiverId]);

  const copyShareLink = useCallback(async () => {
    if (!shareLink) return;
    const ok = await copyTextToClipboard(shareLink);
    setCopiedShare(ok);
    if (ok) window.setTimeout(() => setCopiedShare(false), 1200);
  }, [shareLink]);

  const mobileZoomValue = useMemo(() => {
    if (!viewport) return 0;
    const FULL_VIEWPORT_SPAN = settings?.fft_result_size ?? 524_288;
    const MIN_VIEWPORT_SPAN = 256;
    const span = Math.max(1, viewport.r - viewport.l);
    const t = Math.log(span / FULL_VIEWPORT_SPAN) / Math.log(MIN_VIEWPORT_SPAN / FULL_VIEWPORT_SPAN);
    return clamp(Math.round(t * 100), 0, 100);
  }, [settings?.fft_result_size, viewport]);

  const setViewportFromMobileZoom = useCallback(
    (zoomValue: number) => {
      const FULL_VIEWPORT_SPAN = settings?.fft_result_size ?? 524_288;
      const MIN_VIEWPORT_SPAN = 256;
      if (!viewport || !onViewportSet) return;
      const rawAnchor = passbandCenterIdx ?? (viewport.l + viewport.r) / 2;
      const anchor = clamp(rawAnchor, 0, FULL_VIEWPORT_SPAN);
      const ratio = MIN_VIEWPORT_SPAN / FULL_VIEWPORT_SPAN;
      const span = FULL_VIEWPORT_SPAN * Math.pow(ratio, zoomValue / 100);
      const clampedSpan = clamp(span, MIN_VIEWPORT_SPAN, FULL_VIEWPORT_SPAN);
      const half = clampedSpan / 2;
      let l = Math.round(anchor - half);
      let r = Math.round(anchor + half);
      if (l < 0) {
        r -= l;
        l = 0;
      }
      if (r > FULL_VIEWPORT_SPAN) {
        l -= r - FULL_VIEWPORT_SPAN;
        r = FULL_VIEWPORT_SPAN;
      }
      onViewportSet({ l: clampInt(l, 0, FULL_VIEWPORT_SPAN), r: clampInt(r, 0, FULL_VIEWPORT_SPAN) });
    },
    [onViewportSet, passbandCenterIdx, settings?.fft_result_size, viewport],
  );

  const ft8Unread = decoders.unread.ft8 ?? 0;
  const ft8Enabled = !!decoders.enabled.ft8;
  const ft8Error = decoders.errors?.ft8 ?? null;
  const ft8Lines = useMemo(() => decoders.lines.filter((l) => l.decoder === 'ft8'), [decoders.lines]);
  const serverGrid = (gridLocator ?? '').trim().toUpperCase();
  const hasValidServerGrid = isValidGrid(serverGrid);
  const ft8BaseLatLon = useMemo(() => {
    if (!hasValidServerGrid) return null;
    return gridSquareToLatLong(serverGrid);
  }, [hasValidServerGrid, serverGrid]);

  const farthestKm = useMemo(() => {
    if (!ft8BaseLatLon) return null;
    let max = 0;
    for (const l of ft8Lines) {
      const locs = extractGridLocators(l.text);
      if (locs.length === 0) continue;
      const target = gridSquareToLatLong(locs[0]);
      const km = calculateDistanceKm(ft8BaseLatLon[0], ft8BaseLatLon[1], target[0], target[1]);
      if (Number.isFinite(km) && km > max) max = km;
    }
    return max > 0 ? max : 0;
  }, [ft8BaseLatLon, ft8Lines]);

  return (
    <Card className="shadow-none">
      <CardHeader className="space-y-1 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Waterfall</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <button
                type="button"
                onClick={onToggleVfo}
                className="rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted/30"
                title="Click to switch VFO (or press V)"
              >
                VFO {currentVfo}
              </button>
              {displayConnectionText ? <span className="text-xs text-muted-foreground">{displayConnectionText}</span> : null}
            </CardDescription>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <DropdownMenuPrimitive.Root open={bandsOpen} onOpenChange={setBandsOpen} modal={false}>
              <DropdownMenuPrimitive.Trigger asChild>
                <Button type="button" variant="secondary" className="gap-2">
                  <Layers className="h-4 w-4" />
                  Bands
                </Button>
              </DropdownMenuPrimitive.Trigger>
              <DropdownMenuPrimitive.Portal>
                <AnimatePresence>
                  {bandsOpen ? (
                    <DropdownMenuPrimitive.Content asChild sideOffset={8} align="end" forceMount>
                      <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        className="z-50 min-w-[12rem] overflow-hidden rounded-md border bg-background p-1 text-foreground shadow-md"
                      >
                        <DropdownMenuItem disabled>
                          <Radio className="mr-2 h-4 w-4" />
                          Jump to band (ITU Region {ituRegion})
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Amateur (HAM)</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {bandGroups.ham.map((b) => (
                              <DropdownMenuItem
                                key={b.name}
                                onSelect={() => {
                                  jumpToBand(b.startHz, b.endHz);
                                }}
                              >
                                {b.name.toLowerCase()}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>Broadcast (AM)</DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {bandGroups.broadcast.map((b) => (
                              <DropdownMenuItem
                                key={b.name}
                                onSelect={() => {
                                  jumpToBand(b.startHz, b.endHz);
                                }}
                              >
                                {b.name.toLowerCase()}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        {bandGroups.other.length > 0 ? (
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Other</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {bandGroups.other.map((b) => (
                                <DropdownMenuItem
                                  key={b.name}
                                  onSelect={() => {
                                    jumpToBand(b.startHz, b.endHz);
                                  }}
                                >
                                  {b.name.toLowerCase()}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        ) : null}
                      </motion.div>
                    </DropdownMenuPrimitive.Content>
                  ) : null}
                </AnimatePresence>
              </DropdownMenuPrimitive.Portal>
            </DropdownMenuPrimitive.Root>

            <DropdownMenuPrimitive.Root open={decodersOpen} onOpenChange={setDecodersOpen} modal={false}>
              <DropdownMenuPrimitive.Trigger asChild>
                <Button type="button" variant="secondary" className="gap-2">
                  <Cpu className="h-4 w-4" />
                  Decoders
                  {ft8Unread > 0 ? (
                    <span className="ml-1 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                      {ft8Unread > 99 ? '99+' : ft8Unread}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuPrimitive.Trigger>
              <DropdownMenuPrimitive.Portal>
                <AnimatePresence>
                  {decodersOpen ? (
                    <DropdownMenuPrimitive.Content asChild sideOffset={8} align="end" forceMount>
                      <motion.div
                        initial={{ opacity: 0, y: -6, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -6, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                        className="z-50 min-w-[12rem] overflow-hidden rounded-md border bg-background p-1 text-foreground shadow-md"
                      >
                        <DropdownMenuItem disabled>
                          <Cpu className="mr-2 h-4 w-4" />
                          Background decoders
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />

                        <DropdownMenuCheckboxItem
                          checked={ft8Enabled}
                          onCheckedChange={(checked) => {
                            decoders.toggle('ft8', !!checked);
                          }}
                        >
                          FT8
                        </DropdownMenuCheckboxItem>

                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={!ft8Enabled}
                          onSelect={(e) => {
                            // Avoid the same click that closes the dropdown also immediately closing the dialog.
                            e.preventDefault();
                            setDecodersOpen(false);
                            window.setTimeout(() => setDecodesOpen(true), 0);
                          }}
                        >
                          Show decodes
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={ft8Lines.length === 0}
                          onSelect={() => {
                            decoders.clear('ft8');
                          }}
                        >
                          Clear FT8
                        </DropdownMenuItem>
                      </motion.div>
                    </DropdownMenuPrimitive.Content>
                  ) : null}
                </AnimatePresence>
              </DropdownMenuPrimitive.Portal>
            </DropdownMenuPrimitive.Root>

            <AnimatedDialog
              open={decodesOpen}
              onOpenChange={(open) => {
                setDecodesOpen(open);
                if (open) decoders.markRead('ft8');
              }}
              title="FT8 Decodes"
              description="Decoding runs in the background; this list updates automatically."
              contentClassName="max-w-xl"
              footer={
                <>
                  <Button type="button" variant="secondary" onClick={() => setDecodesOpen(false)}>
                    Close
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      decoders.clear('ft8');
                    }}
                    disabled={ft8Lines.length === 0}
                  >
                    Clear
                  </Button>
                </>
              }
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/10 px-3 py-2">
                  <div className="text-xs text-muted-foreground">
                    {hasValidServerGrid ? (
                      ft8BaseLatLon && farthestKm != null ? (
                        <span className="font-mono">Grid {serverGrid} · Farthest: {farthestKm.toFixed(0)} km</span>
                      ) : (
                        <span className="font-mono">Grid {serverGrid}</span>
                      )
                    ) : (
                      <span className="text-destructive">
                        Server grid locator is invalid or missing; distances can’t be calculated.
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-md border bg-muted/10">
                  <ScrollArea className="h-[260px]">
                    <div className="space-y-2 p-3">
                      {ft8Lines.length === 0 ? (
                        <div className="text-sm text-muted-foreground">
                          {ft8Error
                            ? `FT8 decoder error: ${ft8Error}`
                            : ft8Enabled
                              ? 'Waiting for decodes…'
                              : 'Enable FT8 in the Decoders menu to start.'}
                        </div>
                      ) : (
                        ft8Lines.map((l) => {
                          const locs = extractGridLocators(l.text);
                          const first = locs[0];
                          const km =
                            ft8BaseLatLon && first
                              ? calculateDistanceKm(
                                  ft8BaseLatLon[0],
                                  ft8BaseLatLon[1],
                                  gridSquareToLatLong(first)[0],
                                  gridSquareToLatLong(first)[1],
                                )
                              : null;

                          return (
                            <div key={l.id} className="flex items-start justify-between gap-3 text-xs">
                              <span className="shrink-0 font-mono text-muted-foreground">
                                {new Date(l.ts).toLocaleTimeString()}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="whitespace-pre-wrap font-mono">{l.text}</div>
                                {locs.length > 0 ? (
                                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <div className="flex flex-wrap items-center gap-1 font-mono">
                                      {locs.map((loc, idx) => (
                                        <span key={loc}>
                                          {idx > 0 ? <span className="text-muted-foreground">, </span> : null}
                                          <a
                                            href={`https://www.levinecentral.com/ham/grid_square.php?&Grid=${loc}&Zoom=13&sm=y`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-yellow-300 hover:underline"
                                          >
                                            {loc.toUpperCase()}
                                          </a>
                                        </span>
                                      ))}
                                    </div>
                                    {km != null && Number.isFinite(km) ? (
                                      <span className="font-mono text-muted-foreground">{km.toFixed(0)} km</span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </AnimatedDialog>

            <AnimatedDialog
              open={bookmarkOpen}
              onOpenChange={setBookmarkOpen}
              title="Bookmarks"
              description="Save and quickly return to your favorite frequencies."
              trigger={
                <Button type="button" variant="secondary" className="gap-2">
                  <BookmarkIcon className="h-4 w-4" />
                  Bookmarks
                </Button>
              }
              contentClassName="max-w-xl"
              footer={
                <>
                  <Button type="button" variant="secondary" onClick={() => setBookmarkOpen(false)}>
                    Close
                  </Button>
                  <Button type="button" onClick={saveBookmark} disabled={centerHz == null || !bookmarkName.trim()}>
                    Save bookmark
                  </Button>
                </>
              }
            >
              <div className="space-y-3.5">
                <div className="space-y-2.5">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Name</Label>
                    <Input value={bookmarkName} onChange={(e) => setBookmarkName(e.target.value)} className="h-9 text-sm" placeholder="e.g., BBC World Service" />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Frequency</Label>
                      <Input
                        value={centerHz == null ? '—' : `${(centerHz / 1_000_000).toFixed(3)} MHz`}
                        readOnly
                        className="h-8 bg-muted/40 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Mode</Label>
                      <Input
                        value={mode}
                        readOnly
                        className="h-8 bg-muted/40 text-xs font-medium"
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Notes</Label>
                    <Textarea value={bookmarkNotes} onChange={(e) => setBookmarkNotes(e.target.value)} className="min-h-[56px] resize-none text-sm" placeholder="Optional description or schedule info…" />
                  </div>
                </div>

                <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2">
                  <div className="flex items-center gap-1.5">
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImportFile(file);
                      e.currentTarget.value = '';
                    }}
                  />
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={triggerImport}>
                      <Upload className="h-3.5 w-3.5" />
                    Import
                  </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleExport} disabled={bookmarks.length === 0}>
                      <Download className="h-3.5 w-3.5" />
                    Export
                  </Button>
                  </div>
                  <div className="text-xs font-medium text-muted-foreground">{bookmarks.length} {bookmarks.length === 1 ? 'bookmark' : 'bookmarks'}</div>
                </div>

                <div className="space-y-1.5">
                  <ScrollArea className="h-[200px] rounded-lg border bg-muted/10">
                    {bookmarks.length === 0 ? (
                      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                        No bookmarks saved yet
                      </div>
                    ) : (
                      <div className="space-y-1 p-1.5">
                        {bookmarks.map((b) => (
                          <div key={b.id} className="group relative flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 shadow-sm transition-all hover:border-border hover:shadow">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <div className="truncate text-sm font-semibold leading-none">{b.name}</div>
                              </div>
                              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                                <span className="font-mono font-medium">{(b.frequencyHz / 1_000_000).toFixed(3)} MHz</span>
                                <span>·</span>
                                <span className="font-medium">{b.mode}</span>
                              </div>
                              {b.notes ? <div className="mt-1.5 line-clamp-1 text-xs text-muted-foreground/80">{b.notes}</div> : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              <Button
                                type="button"
                                variant="default"
                                size="sm"
                                className="h-7 px-2.5 text-xs"
                                onClick={() => tuneToBookmark(b)}
                              >
                                Tune
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label="Copy link"
                                onClick={async () => {
                                  await copyTextToClipboard(bookmarkLink(b));
                                }}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                                aria-label="Delete"
                                onClick={() => deleteBookmark(b.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </div>
            </AnimatedDialog>

            <AnimatedDialog
              open={shareOpen}
              onOpenChange={setShareOpen}
              title="Share link"
              description="Copy a URL that opens NovaSDR tuned to the current frequency."
              trigger={
                <Button type="button" variant="secondary" className="gap-2">
                  <Link2 className="h-4 w-4" />
                  Share
                </Button>
              }
              contentClassName="max-w-md"
              footer={
                <>
                  <Button type="button" variant="secondary" onClick={() => setShareOpen(false)}>
                    Close
                  </Button>
                  <Button type="button" className="gap-2" onClick={() => void copyShareLink()} disabled={shareLink == null}>
                    <Copy className="h-4 w-4" />
                    {copiedShare ? 'Copied' : 'Copy'}
                  </Button>
                </>
              }
            >
              <div className="space-y-2">
                <Label className="text-sm">URL</Label>
                <Input value={shareLink ?? window.location.href} readOnly className="h-9 font-mono text-xs" />
              </div>
            </AnimatedDialog>

          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-0">
        <div className="overflow-hidden rounded-md border bg-muted/20">
          <WaterfallView
            receiverId={receiverId}
            bands={bands}
            onConnected={handleConnected}
            onError={handleError}
            onConnecting={handleConnecting}
            onSetFrequencyHz={onSetFrequencyHz}
            onSetMode={onSetMode}
            activeVfo={currentVfo}
            mode={mode}
            frequencyAdjust={frequencyAdjust}
            frequencySet={frequencySet}
            bandwidthAdjust={bandwidthAdjust}
            resetTune={resetTune}
            display={display}
            onDisplayChange={onDisplayChange}
            tuningStepHz={tuningStepHz}
            onPassbandChange={onPassbandChange}
            onViewportChange={onViewportChange}
            passbandSet={passbandSet}
            viewportSet={viewportSet}
            onTuningChange={onTuningChange}
          />
        </div>
      </CardContent>

      <div className="sm:hidden">
        <MobileWaterfallBar
          onOpenBands={() => setMobileBandsOpen(true)}
          onOpenBookmarks={() => setMobileBookmarksOpen(true)}
          onOpenMore={() => setMobileMoreOpen(true)}
          zoomOpen={mobileZoomOpen}
          onToggleZoom={() => setMobileZoomOpen((v) => !v)}
          zoomValue={mobileZoomValue}
          zoomDisabled={!viewport || !onViewportSet}
          onZoomChange={setViewportFromMobileZoom}
          mute={!!audioMute}
          onToggleMute={() => onToggleAudioMute?.()}
        />
      </div>

      <div className="sm:hidden">
        <AnimatedBottomSheet
          open={mobileMoreOpen}
          onOpenChange={setMobileMoreOpen}
          title="Menu"
          description="Tools and actions."
          contentClassName="max-h-[55vh] overflow-hidden"
        >
          <div className="grid gap-2">
            <Button
              type="button"
              variant="secondary"
              className="h-12 justify-start"
              onClick={() => {
                setMobileMoreOpen(false);
                window.setTimeout(() => setMobileDecodersOpen(true), 0);
              }}
            >
              Decoders
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="h-12 justify-start"
              onClick={() => {
                setMobileMoreOpen(false);
                window.setTimeout(() => setMobileShareOpen(true), 0);
              }}
            >
              Share link
            </Button>
          </div>
        </AnimatedBottomSheet>

        <AnimatedBottomSheet
          open={mobileBandsOpen}
          onOpenChange={setMobileBandsOpen}
          title="Bands"
          description="Jump to a band."
          contentClassName="max-h-[75vh] overflow-hidden"
        >
          <ScrollArea className="h-[60vh] pr-2">
            <div className="space-y-4">
              <BandSection
                title="Amateur (HAM)"
                bands={bandGroups.ham}
                onSelect={(b) => {
                  jumpToBand(b.startHz, b.endHz);
                  setMobileBandsOpen(false);
                }}
              />
              <BandSection
                title="Broadcast (AM)"
                bands={bandGroups.broadcast}
                onSelect={(b) => {
                  jumpToBand(b.startHz, b.endHz);
                  setMobileBandsOpen(false);
                }}
              />
              {bandGroups.other.length > 0 ? (
                <BandSection
                  title="Other"
                  bands={bandGroups.other}
                  onSelect={(b) => {
                    jumpToBand(b.startHz, b.endHz);
                    setMobileBandsOpen(false);
                  }}
                />
              ) : null}
            </div>
          </ScrollArea>
        </AnimatedBottomSheet>

        <AnimatedBottomSheet
          open={mobileDecodersOpen}
          onOpenChange={setMobileDecodersOpen}
          title="Decoders"
          description="Background decoders."
          contentClassName="max-h-[70vh] overflow-hidden"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border bg-muted/10 px-3 py-2">
              <div className="text-sm font-medium">FT8</div>
              <Button
                type="button"
                variant={ft8Enabled ? 'default' : 'secondary'}
                size="sm"
                className="h-8"
                onClick={() => decoders.toggle('ft8', !ft8Enabled)}
              >
                {ft8Enabled ? 'On' : 'Off'}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-10"
                disabled={!ft8Enabled}
                onClick={() => {
                  setMobileDecodersOpen(false);
                  window.setTimeout(() => setDecodesOpen(true), 0);
                }}
              >
                Show decodes
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-10"
                disabled={ft8Lines.length === 0}
                onClick={() => decoders.clear('ft8')}
              >
                Clear
              </Button>
            </div>
          </div>
        </AnimatedBottomSheet>

        <AnimatedBottomSheet
          open={mobileShareOpen}
          onOpenChange={setMobileShareOpen}
          title="Share link"
          description="Copy a URL that opens NovaSDR tuned to the current frequency."
          contentClassName="max-h-[55vh] overflow-hidden"
          footer={
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setMobileShareOpen(false)}>
                Close
              </Button>
              <Button type="button" className="flex-1" onClick={() => void copyShareLink()} disabled={shareLink == null}>
                {copiedShare ? 'Copied' : 'Copy'}
              </Button>
            </div>
          }
        >
          <div className="space-y-2">
            <Label className="text-sm">URL</Label>
            <Input value={shareLink ?? window.location.href} readOnly className="h-9 font-mono text-xs" />
          </div>
        </AnimatedBottomSheet>

        <AnimatedBottomSheet
          open={mobileBookmarksOpen}
          onOpenChange={setMobileBookmarksOpen}
          title="Bookmarks"
          description="Save and quickly return to your favorite frequencies."
          contentClassName="flex max-h-[85vh] flex-col overflow-hidden"
          footer={
            <div className="flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={() => setMobileBookmarksOpen(false)}>
                Close
              </Button>
              <Button type="button" className="flex-1" onClick={saveBookmark} disabled={centerHz == null || !bookmarkName.trim()}>
                Save
              </Button>
            </div>
          }
        >
          <div className="min-h-0 flex-1">
            <ScrollArea className="h-full pr-2">
              <div className="space-y-3.5">
              <div className="space-y-2.5">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Name</Label>
                  <Input value={bookmarkName} onChange={(e) => setBookmarkName(e.target.value)} className="h-9 text-sm" placeholder="e.g., BBC World Service" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Frequency</Label>
                    <Input value={centerHz == null ? '—' : `${(centerHz / 1_000_000).toFixed(3)} MHz`} readOnly className="h-8 bg-muted/40 font-mono text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Mode</Label>
                    <Input value={mode} readOnly className="h-8 bg-muted/40 text-xs font-medium" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Notes</Label>
                  <Textarea value={bookmarkNotes} onChange={(e) => setBookmarkNotes(e.target.value)} className="min-h-[56px] resize-none text-sm" placeholder="Optional description or schedule info…" />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="rounded-lg border bg-muted/10 p-1.5">
                  {bookmarks.length === 0 ? (
                    <div className="flex items-center justify-center p-6 text-center text-sm text-muted-foreground">No bookmarks saved yet</div>
                  ) : (
                    <div className="space-y-1">
                      {bookmarks.map((b) => (
                        <div key={b.id} className="flex items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 shadow-sm">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold leading-none">{b.name}</div>
                            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-mono font-medium">{(b.frequencyHz / 1_000_000).toFixed(3)} MHz</span>
                              <span>·</span>
                              <span className="font-medium">{b.mode}</span>
                            </div>
                            {b.notes ? <div className="mt-1.5 line-clamp-1 text-xs text-muted-foreground/80">{b.notes}</div> : null}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button type="button" size="sm" className="h-8 px-3 text-xs" onClick={() => tuneToBookmark(b)}>
                              Tune
                            </Button>
                            <Button type="button" variant="ghost" size="sm" className="h-8 px-3 text-xs text-destructive hover:bg-destructive/10" onClick={() => deleteBookmark(b.id)}>
                              Delete
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              </div>
            </ScrollArea>
          </div>
        </AnimatedBottomSheet>
      </div>
    </Card>
  );
}

function BandSection({
  title,
  bands,
  onSelect,
}: {
  title: string;
  bands: Array<{ name: string; startHz: number; endHz: number }>;
  onSelect: (b: { name: string; startHz: number; endHz: number }) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold text-muted-foreground">{title}</div>
      <div className="grid gap-1">
        {bands.map((b) => (
          <Button key={b.name} type="button" variant="secondary" className="h-10 justify-start" onClick={() => onSelect(b)}>
            {b.name.toLowerCase()}
          </Button>
        ))}
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Math.trunc(v)));
}

function extractGridLocators(message: string): string[] {
  // Keep the locator extraction regex compatible with the previous UI.
  const regex = /[A-R]{2}[0-9]{2}([A-X]{2})?/gi;
  const matches = message.match(regex);
  return matches ? Array.from(new Set(matches.map((m) => m.toUpperCase()))) : [];
}

function isValidGrid(grid: string): boolean {
  return /^[A-R]{2}[0-9]{2}([A-X]{2})?$/i.test(grid);
}

function gridSquareToLatLong(gridSquare: string): [number, number] {
  // Ported from the previous frontend implementation.
  const l = gridSquare.toUpperCase();
  let lon = (l.charCodeAt(0) - 'A'.charCodeAt(0)) * 20 - 180;
  let lat = (l.charCodeAt(1) - 'A'.charCodeAt(0)) * 10 - 90;

  if (l.length >= 4) {
    lon += (l.charCodeAt(2) - '0'.charCodeAt(0)) * 2;
    lat += l.charCodeAt(3) - '0'.charCodeAt(0);
  }

  if (l.length === 6) {
    lon += (l.charCodeAt(4) - 'A'.charCodeAt(0)) * (5 / 60);
    lat += (l.charCodeAt(5) - 'A'.charCodeAt(0)) * (2.5 / 60);
    lon += 5 / 120;
    lat += 1.25 / 120;
  } else if (l.length === 4) {
    lon += 1;
    lat += 0.5;
  }

  return [lat, lon];
}

function calculateDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  // Haversine, ported from the previous frontend implementation.
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function maidenheadToCoords(locator: string): { lat: number; lon: number } | null {
  const l = locator.toUpperCase();
  if (l.length < 2) return null;
  const chars = l.split('');
  let lon = (chars[0].charCodeAt(0) - 65) * 20 - 180;
  let lat = (chars[1].charCodeAt(0) - 65) * 10 - 90;

  if (l.length >= 4) {
    lon += (Number.parseInt(chars[2] ?? '0', 10) || 0) * 2;
    lat += Number.parseInt(chars[3] ?? '0', 10) || 0;
  }
  return { lat, lon };
}

function getItuRegion(lat: number, lon: number): 1 | 2 | 3 {
  // Ported from the previous frontend implementation.
  // ITU Region 2: Americas
  if (lon >= -170 && lon <= -30) return 2;

  // ITU Region 3: Asia-Pacific (simplified)
  if (lon >= 60 && lon <= 170) {
    // Special cases for Region 1 countries in Asia (Middle East)
    if (lat > 30 && lon < 75) return 1;
    return 3;
  }

  // ITU Region 1: Europe, Africa, Middle East
  return 1;
}

function hamBandsForItuRegion(region: 1 | 2 | 3): typeof DEFAULT_BANDS {
  const hamColor = 'rgba(50, 168, 72, 0.6)';
  if (region === 2) {
    return [
      { name: '2200M HAM', startHz: 135_700, endHz: 137_800, color: hamColor },
      { name: '630M HAM', startHz: 472_000, endHz: 479_000, color: hamColor },
      { name: '160M HAM', startHz: 1_800_000, endHz: 2_000_000, color: hamColor },
      { name: '80M HAM', startHz: 3_500_000, endHz: 4_000_000, color: hamColor },
      { name: '60M HAM', startHz: 5_330_500, endHz: 5_406_400, color: hamColor },
      { name: '40M HAM', startHz: 7_000_000, endHz: 7_300_000, color: hamColor },
      { name: '30M HAM', startHz: 10_100_000, endHz: 10_150_000, color: hamColor },
      { name: '20M HAM', startHz: 14_000_000, endHz: 14_350_000, color: hamColor },
      { name: '17M HAM', startHz: 18_068_000, endHz: 18_168_000, color: hamColor },
      { name: '15M HAM', startHz: 21_000_000, endHz: 21_450_000, color: hamColor },
      { name: '12M HAM', startHz: 24_890_000, endHz: 24_990_000, color: hamColor },
      { name: '10M HAM', startHz: 28_000_000, endHz: 29_700_000, color: hamColor },
      { name: '6M HAM', startHz: 50_000_000, endHz: 54_000_000, color: hamColor },
      { name: '2M HAM', startHz: 144_000_000, endHz: 148_000_000, color: hamColor },
      { name: '1.25M HAM', startHz: 222_000_000, endHz: 225_000_000, color: hamColor },
      { name: '70CM HAM', startHz: 420_000_000, endHz: 450_000_000, color: hamColor },
    ];
  }
  if (region === 3) {
    return [
      { name: '2200M HAM', startHz: 135_700, endHz: 137_800, color: hamColor },
      { name: '630M HAM', startHz: 472_000, endHz: 479_000, color: hamColor },
      { name: '160M HAM', startHz: 1_800_000, endHz: 2_000_000, color: hamColor },
      { name: '80M HAM', startHz: 3_500_000, endHz: 3_900_000, color: hamColor },
      { name: '60M HAM', startHz: 5_351_500, endHz: 5_366_500, color: hamColor },
      { name: '40M HAM', startHz: 7_000_000, endHz: 7_200_000, color: hamColor },
      { name: '30M HAM', startHz: 10_100_000, endHz: 10_150_000, color: hamColor },
      { name: '20M HAM', startHz: 14_000_000, endHz: 14_350_000, color: hamColor },
      { name: '17M HAM', startHz: 18_068_000, endHz: 18_168_000, color: hamColor },
      { name: '15M HAM', startHz: 21_000_000, endHz: 21_450_000, color: hamColor },
      { name: '12M HAM', startHz: 24_890_000, endHz: 24_990_000, color: hamColor },
      { name: '10M HAM', startHz: 28_000_000, endHz: 29_700_000, color: hamColor },
      { name: '6M HAM', startHz: 50_000_000, endHz: 54_000_000, color: hamColor },
      { name: '2M HAM', startHz: 144_000_000, endHz: 146_000_000, color: hamColor },
      { name: '70CM HAM', startHz: 430_000_000, endHz: 440_000_000, color: hamColor },
    ];
  }

  // Region 1 default
  return [
    { name: '2200M HAM', startHz: 135_700, endHz: 137_800, color: hamColor },
    { name: '630M HAM', startHz: 472_000, endHz: 479_000, color: hamColor },
    { name: '160M HAM', startHz: 1_810_000, endHz: 2_000_000, color: hamColor },
    { name: '80M HAM', startHz: 3_500_000, endHz: 3_800_000, color: hamColor },
    { name: '60M HAM', startHz: 5_351_500, endHz: 5_366_500, color: hamColor },
    { name: '40M HAM', startHz: 7_000_000, endHz: 7_200_000, color: hamColor },
    { name: '30M HAM', startHz: 10_100_000, endHz: 10_150_000, color: hamColor },
    { name: '20M HAM', startHz: 14_000_000, endHz: 14_350_000, color: hamColor },
    { name: '17M HAM', startHz: 18_068_000, endHz: 18_168_000, color: hamColor },
    { name: '15M HAM', startHz: 21_000_000, endHz: 21_450_000, color: hamColor },
    { name: '12M HAM', startHz: 24_890_000, endHz: 24_990_000, color: hamColor },
    { name: '10M HAM', startHz: 28_000_000, endHz: 29_700_000, color: hamColor },
    { name: '6M HAM', startHz: 50_000_000, endHz: 54_000_000, color: hamColor },
    { name: '4M HAM', startHz: 70_000_000, endHz: 70_500_000, color: hamColor },
    { name: '2M HAM', startHz: 144_000_000, endHz: 146_000_000, color: hamColor },
    { name: '70CM HAM', startHz: 430_000_000, endHz: 440_000_000, color: hamColor },
  ];
}
