import { ChevronDown, ExternalLink, Github, Keyboard, Moon, Search, Settings, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';

import type { ReceiverSummary } from '../../lib/receivers';
import { fetchServerInfo, type ServerInfo } from '../../lib/serverInfo';
import { applyTheme, getStoredTheme, resolveTheme, setStoredTheme, type ThemePreference } from '../../lib/theme';
import type { AudioDebugStats, AudioUiSettings } from '../audio/types';
import { AnimatedDialog } from '../ui/animated-dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { SettingsDialog } from './SettingsDialog';

type ServerInfoState = { kind: 'loading' } | { kind: 'ready'; value: ServerInfo } | { kind: 'error' };

function formatRangeHz(minHz?: number, maxHz?: number): string | null {
  if (typeof minHz !== 'number' || typeof maxHz !== 'number') return null;
  if (!Number.isFinite(minHz) || !Number.isFinite(maxHz) || maxHz <= minHz) return null;
  const minMhz = minHz / 1_000_000;
  const maxMhz = maxHz / 1_000_000;
  return `${minMhz.toFixed(3)}–${maxMhz.toFixed(3)} MHz`;
}

type Props = {
  receivers: ReceiverSummary[] | null;
  receiverId: string | null;
  tunedHz: number | null;
  onReceiverChange: React.Dispatch<React.SetStateAction<string | null>>;
  audioSettings: AudioUiSettings;
  onAudioSettingsChange: React.Dispatch<React.SetStateAction<AudioUiSettings>>;
  tuningStepHz: number;
  onTuningStepChange: React.Dispatch<React.SetStateAction<number>>;
  debugStats: AudioDebugStats | null;
  autoBandMode: boolean;
  onAutoBandModeChange: React.Dispatch<React.SetStateAction<boolean>>;
  persistSettings: boolean;
  onPersistSettingsChange: React.Dispatch<React.SetStateAction<boolean>>;
};

export function WebSdrHeader({
  receivers,
  receiverId,
  tunedHz,
  onReceiverChange,
  audioSettings,
  onAudioSettingsChange,
  tuningStepHz,
  onTuningStepChange,
  debugStats,
  autoBandMode,
  onAutoBandModeChange,
  persistSettings,
  onPersistSettingsChange,
}: Props) {
  const [info, setInfo] = useState<ServerInfoState>({ kind: 'loading' });
  const [theme, setTheme] = useState<ThemePreference>(() => getStoredTheme() ?? 'system');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keybindsOpen, setKeybindsOpen] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(false);
  const [callsignQuery, setCallsignQuery] = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    fetchServerInfo(ctrl.signal)
      .then((value) => setInfo({ kind: 'ready', value }))
      .catch(() => {
        if (ctrl.signal.aborted) return;
        setInfo({ kind: 'error' });
      });
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    applyTheme(theme);
    setStoredTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyTheme('system');
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [theme]);

  const title = useMemo(() => {
    if (info.kind === 'ready' && info.value.serverName) return info.value.serverName;
    return 'NovaSDR';
  }, [info]);

  const subtitle = useMemo(() => {
    if (info.kind !== 'ready') return null;
    const operator = info.value.operators[0]?.name ?? null;
    const version = info.value.version ? `v${info.value.version}` : null;
    const parts = [info.value.location, operator, version].filter(Boolean);
    return parts.length ? parts.join(' / ') : null;
  }, [info]);

  const headerPanel = useMemo(() => {
    if (info.kind !== 'ready') return null;
    const panel = info.value.headerPanel;
    if (!panel || !panel.enabled) return null;
    return panel;
  }, [info]);

  const blitzortungSrc = useMemo(() => {
    if (info.kind !== 'ready') return null;
    if (!headerPanel?.widgets.blitzortung) return null;

    const grid = (info.value.location ?? '').trim().toUpperCase();
    const coords = maidenheadToCoords(grid);
    const lat = coords?.lat ?? 51.2;
    const lon = coords?.lon ?? 10.0;
    const zoom = 5;

    return `https://map.blitzortung.org/index.php?interactive=1&NavigationControl=0&FullScreenControl=0&Cookies=0&InfoDiv=0&MenuButtonDiv=1&ScaleControl=1&LinksCheckboxChecked=1&LinksRangeValue=10&MapStyle=0&MapStyleRangeValue=0&Advertisment=0#${zoom}/${lat.toFixed(3)}/${lon.toFixed(3)}`;
  }, [headerPanel, info]);

  useEffect(() => {
    if (!headerPanel) setHeaderExpanded(false);
  }, [headerPanel]);

  const receiverOptions = receivers ?? [];
  const receiverSelectDisabled = receiverOptions.length <= 1 || receiverId == null;
  const activeReceiver = useMemo(() => {
    if (!receiverId) return null;
    return receiverOptions.find((r) => r.id === receiverId) ?? null;
  }, [receiverId, receiverOptions]);
  const activeRange = useMemo(
    () => formatRangeHz(activeReceiver?.min_hz, activeReceiver?.max_hz),
    [activeReceiver?.max_hz, activeReceiver?.min_hz],
  );

  const resolvedTheme = useMemo(() => resolveTheme(theme), [theme]);

  return (
    <header className="z-20 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-10 w-full max-w-[1320px] items-center gap-2 px-3 sm:px-4">
        {headerPanel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={headerExpanded ? 'Collapse receiver info' : 'Expand receiver info'}
            aria-expanded={headerExpanded}
            onClick={() => setHeaderExpanded((v) => !v)}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${headerExpanded ? 'rotate-180' : ''}`} />
          </Button>
        ) : null}

        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold tracking-tight leading-4">{title}</div>
          {subtitle ? <div className="hidden truncate text-[11px] text-muted-foreground sm:block">{subtitle}</div> : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {receiverOptions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={receiverSelectDisabled}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 w-[120px] justify-between gap-2 overflow-hidden rounded-md border-border/60 bg-muted/10 px-3 shadow-sm transition-colors hover:bg-muted/20 sm:w-[260px]"
                  aria-label="Switch device"
                >
                  <span className="flex min-w-0 flex-1 flex-col items-start text-left">
                    <span className="w-full truncate text-[13px] font-medium leading-4">
                      {activeReceiver?.name || activeReceiver?.id || 'Device'}
                    </span>
                    <span className="hidden w-full truncate text-[11px] text-muted-foreground sm:block">
                      {activeReceiver ? `${activeReceiver.driver}${activeRange ? ` · ${activeRange}` : ''}` : 'Select device'}
                    </span>
                  </span>
                  <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-[420px] w-[min(340px,calc(100vw-1rem))] overflow-y-auto">
                {receiverOptions.map((r) => {
                  const range = formatRangeHz(r.min_hz, r.max_hz);
                  return (
                    <DropdownMenuCheckboxItem
                      key={r.id}
                      checked={r.id === receiverId}
                      onCheckedChange={() => onReceiverChange(r.id)}
                      className="py-2"
                    >
                      <div className="flex min-w-0 flex-col">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-medium">{r.name || r.id}</div>
                          <div className="ml-auto shrink-0 rounded-sm bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                            {r.id}
                          </div>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {r.driver}
                          {range ? ` · ${range}` : ''}
                        </div>
                      </div>
                    </DropdownMenuCheckboxItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="h-7 w-7"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
            className="h-7 w-7"
          >
            <Settings className="h-4 w-4" />
          </Button>

          <AnimatedDialog
            open={keybindsOpen}
            onOpenChange={setKeybindsOpen}
            title="Keybinds"
            description="Keyboard shortcuts available in the app."
            trigger={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Keybinds"
                className="hidden h-8 w-8 sm:inline-flex"
              >
                <Keyboard className="h-4 w-4" />
              </Button>
            }
            contentClassName="max-w-md"
            footer={
              <Button type="button" onClick={() => setKeybindsOpen(false)}>
                Close
              </Button>
            }
          >
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between rounded-md border bg-muted/10 px-3 py-2">
                <span className="text-muted-foreground">Toggle VFO A/B</span>
                <span className="font-mono font-semibold">V</span>
              </div>
            </div>
          </AnimatedDialog>

          <a href="https://github.com/Steven9101/novasdr-develop" target="_blank" rel="noreferrer">
            <Button type="button" variant="secondary" size="icon" className="h-8 w-8 sm:hidden" aria-label="GitHub">
              <Github className="h-4 w-4" />
            </Button>
          </a>
          <a href="https://github.com/Steven9101/novasdr-develop" target="_blank" rel="noreferrer" className="hidden sm:inline-flex">
            <Button type="button" variant="secondary" size="sm" className="gap-2">
              <Github className="h-4 w-4" />
              GitHub
            </Button>
          </a>
        </div>
      </div>


      <AnimatePresence initial={false}>
        {headerPanel && headerExpanded ? (
          <motion.div
            key="header-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="overflow-hidden border-t bg-background/80"
          >
            <div className="mx-auto w-full max-w-[1320px] space-y-3 px-3 py-3 sm:px-4">
              <div className="grid gap-3 lg:grid-cols-12">
                <div className="space-y-3 lg:col-span-5">
                  <div className="rounded-lg border bg-muted/10 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold tracking-tight">
                          {headerPanel.title || 'Receiver'}
                        </div>
                        {headerPanel.about ? (
                          <div className="mt-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
                            {headerPanel.about}
                          </div>
                        ) : null}
                      </div>
                      {headerPanel.donationEnabled && headerPanel.donationUrl ? (
                        <a href={headerPanel.donationUrl} target="_blank" rel="noreferrer" className="shrink-0">
                          <Button type="button" variant="secondary" size="sm" className="h-8 px-3">
                            {headerPanel.donationLabel || 'Donate'}
                          </Button>
                        </a>
                      ) : null}
                    </div>
                  </div>

                  {headerPanel.items.some((i) => (i.label ?? '').trim() && (i.value ?? '').trim()) ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {headerPanel.items
                        .filter((i) => (i.label ?? '').trim() && (i.value ?? '').trim())
                        .slice(0, 10)
                        .map((i) => (
                          <div key={`${i.label}:${i.value}`} className="rounded-lg border bg-muted/10 px-3 py-2">
                            <div className="text-[11px] font-medium text-muted-foreground">{i.label}</div>
                            <div className="mt-0.5 break-words text-xs">{i.value}</div>
                          </div>
                        ))}
                    </div>
                  ) : null}

                  {headerPanel.images.length ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {headerPanel.images.slice(0, 3).map((src) => (
                        <img
                          key={src}
                          src={src}
                          alt=""
                          loading="lazy"
                          className="h-28 w-full rounded-lg border bg-muted/10 object-cover"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3 lg:col-span-7">
                  {(headerPanel.lookups.callsign || headerPanel.lookups.mwlist || headerPanel.lookups.shortwaveInfo) ? (
                    <div className="rounded-lg border bg-muted/10 px-3 py-2.5">
                      <div className="text-[11px] font-medium text-muted-foreground">Lookups</div>
                      <div className="mt-2 space-y-2">
                        {headerPanel.lookups.callsign ? (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-xs">Callsign</div>
                            <div className="flex min-w-0 items-center gap-2 sm:w-[min(360px,60vw)]">
                              <Input
                                value={callsignQuery}
                                onChange={(e) => setCallsignQuery(e.target.value)}
                                placeholder="e.g. DL1ABC"
                                className="h-8 min-w-0 text-xs"
                                onKeyDown={(e) => {
                                  if (e.key !== 'Enter') return;
                                  const raw = callsignQuery.trim();
                                  if (!raw) return;
                                  const callsign = raw.replace(/[^A-Za-z0-9/]/g, '').toUpperCase();
                                  if (!callsign) return;
                                  window.open(`https://www.qrz.com/db/${callsign}`, '_blank', 'noreferrer');
                                }}
                              />
                              <Button
                                type="button"
                                variant="secondary"
                                size="icon"
                                className="h-8 w-8"
                                aria-label="Look up callsign"
                                onClick={() => {
                                  const raw = callsignQuery.trim();
                                  if (!raw) return;
                                  const callsign = raw.replace(/[^A-Za-z0-9/]/g, '').toUpperCase();
                                  if (!callsign) return;
                                  window.open(`https://www.qrz.com/db/${callsign}`, '_blank', 'noreferrer');
                                }}
                              >
                                <Search className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        ) : null}

                        {headerPanel.lookups.mwlist || headerPanel.lookups.shortwaveInfo ? (
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-xs">Frequency</div>
                            <div className="flex flex-wrap gap-2 sm:justify-end">
                              {headerPanel.lookups.mwlist ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={tunedHz == null}
                                  onClick={() => {
                                    if (tunedHz == null) return;
                                    const khz = Math.round(tunedHz / 1_000);
                                    const url = `https://www.mwlist.org/mwlist_quick_and_easy.php?area=1&kHz=${khz}`;
                                    window.open(url, '_blank', 'noreferrer');
                                  }}
                                  className="h-8 gap-2"
                                >
                                  MWList
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                              {headerPanel.lookups.shortwaveInfo ? (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={tunedHz == null}
                                  onClick={() => {
                                    if (tunedHz == null) return;
                                    const khz = Math.round(tunedHz / 1_000);
                                    const url = `https://www.short-wave.info/index.php?timbus=NOW&ip=179&porm=4&freq=${khz}`;
                                    window.open(url, '_blank', 'noreferrer');
                                  }}
                                  className="h-8 gap-2"
                                >
                                  short-wave.info
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  {headerPanel.widgets.blitzortung && blitzortungSrc ? (
                    <div className="overflow-hidden rounded-lg border bg-muted/10">
                      <div className="px-3 py-2.5">
                        <div className="text-[11px] font-medium text-muted-foreground">Blitzortung</div>
                      </div>
                      <iframe
                        title="Blitzortung lightning map"
                        src={blitzortungSrc}
                        className="h-[240px] w-full sm:h-[280px]"
                        loading="lazy"
                      />
                    </div>
                  ) : null}

                  {headerPanel.widgets.hamqsl ? (
                    <div className="overflow-hidden rounded-lg border bg-muted/10">
                      <div className="px-3 py-2.5">
                        <div className="text-[11px] font-medium text-muted-foreground">Solar-terrestrial</div>
                      </div>
                      <a href="https://www.hamqsl.com/solar.html" target="_blank" rel="noreferrer" className="block px-3 pb-3">
                        <img
                          src="https://www.hamqsl.com/solar101vhf.php"
                          alt="Solar-terrestrial data (HAMQSL)"
                          loading="lazy"
                          className="block w-full max-h-[110px] object-contain"
                        />
                      </a>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>


      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        audioSettings={audioSettings}
        onAudioSettingsChange={onAudioSettingsChange}
        tuningStepHz={tuningStepHz}
        onTuningStepChange={onTuningStepChange}
        debugStats={debugStats}
        autoBandMode={autoBandMode}
        onAutoBandModeChange={onAutoBandModeChange}
        persistSettings={persistSettings}
        onPersistSettingsChange={onPersistSettingsChange}
      />
    </header>
  );
}

function maidenheadToCoords(locator: string): { lat: number; lon: number } | null {
  const chars = locator.trim().toUpperCase();
  if (chars.length < 4) return null;

  const a = chars.charCodeAt(0) - 65;
  const b = chars.charCodeAt(1) - 65;
  const c = Number.parseInt(chars[2] ?? '0', 10);
  const d = Number.parseInt(chars[3] ?? '0', 10);
  if (a < 0 || a > 17 || b < 0 || b > 17 || !Number.isFinite(c) || !Number.isFinite(d)) return null;

  let lon = a * 20 - 180;
  let lat = b * 10 - 90;
  lon += c * 2;
  lat += d;

  // Center of the 2x1 degree square.
  lon += 1;
  lat += 0.5;

  // Support 6-char locators (subsquares) for better centering.
  if (chars.length >= 6) {
    const e = chars.charCodeAt(4) - 65;
    const f = chars.charCodeAt(5) - 65;
    if (e >= 0 && e <= 23 && f >= 0 && f <= 23) {
      lon += e * (5 / 60) + 2.5 / 60;
      lat += f * (2.5 / 60) + 1.25 / 60;
    }
  }

  return { lat, lon };
}

