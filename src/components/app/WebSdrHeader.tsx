import { ChevronDown, Github, Keyboard, Moon, Settings, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { ReceiverSummary } from '../../lib/receivers';
import { fetchServerInfo, type ServerInfo } from '../../lib/serverInfo';
import { applyTheme, getStoredTheme, resolveTheme, setStoredTheme, type ThemePreference } from '../../lib/theme';
import type { AudioDebugStats, AudioUiSettings } from '../audio/types';
import { AnimatedDialog } from '../ui/animated-dialog';
import { Button } from '../ui/button';
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
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-12 w-full max-w-[1320px] items-center gap-2 px-3 sm:px-4">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold tracking-tight leading-4">{title}</div>
          {subtitle ? <div className="truncate text-[11px] text-muted-foreground">{subtitle}</div> : null}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {receiverOptions.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild disabled={receiverSelectDisabled}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 w-[120px] justify-between gap-2 overflow-hidden rounded-md border-border/60 bg-muted/10 px-3 shadow-sm transition-colors hover:bg-muted/20 sm:w-[280px]"
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
            className="h-8 w-8"
          >
            {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
            className="h-8 w-8"
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
