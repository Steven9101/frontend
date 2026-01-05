import { Activity, ChevronDown, Radio, Settings2, Zap } from 'lucide-react';
import { useState } from 'react';

import type { AgcSpeed, AudioDebugStats, AudioUiSettings, BufferMode } from '../audio/types';
import { AnimatedDialog } from '../ui/animated-dialog';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Switch } from '../ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function SettingsDialog({
  open,
  onOpenChange,
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
  const [tab, setTab] = useState('general');

  return (
    <AnimatedDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Configure audio, tuning, processing, and view debug information."
      contentClassName="max-w-lg"
      footer={
        <Button type="button" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid h-11 w-full grid-cols-4 items-center">
          <TabsTrigger className="py-2 text-xs sm:text-sm" value="general">
            General
          </TabsTrigger>
          <TabsTrigger className="py-2 text-xs sm:text-sm" value="tuning">
            Tuning
          </TabsTrigger>
          <TabsTrigger className="py-2 text-xs sm:text-sm" value="agc">
            AGC
          </TabsTrigger>
          <TabsTrigger className="py-2 text-xs sm:text-sm" value="debug">
            Debug
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4 pt-4 pb-8 min-h-[320px]">
          {/* Audio Buffer */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Audio Buffer Mode</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Controls frontend audio buffering. Lower latency may cause dropouts on slower systems.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(['low', 'medium', 'high'] as BufferMode[]).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant={audioSettings.bufferMode === mode ? 'default' : 'secondary'}
                  onClick={() => onAudioSettingsChange((prev) => ({ ...prev, bufferMode: mode }))}
                  className="flex flex-col h-auto py-2"
                >
                  <span className="capitalize font-medium">{mode}</span>
                  <span className="text-xs opacity-70">
                    {mode === 'low' && '~60ms'}
                    {mode === 'medium' && '~110ms'}
                    {mode === 'high' && '~200ms'}
                  </span>
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Auto Mode by Band</div>
                <div className="text-xs text-muted-foreground">Automatically switch demodulation when tuning into a band.</div>
              </div>
              <Switch checked={autoBandMode} onCheckedChange={onAutoBandModeChange} />
            </div>

            <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/10 px-3 py-2">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Persist Settings</div>
                <div className="text-xs text-muted-foreground">Save settings to localStorage so they survive reloads.</div>
              </div>
              <Switch checked={persistSettings} onCheckedChange={onPersistSettingsChange} />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tuning" className="space-y-4 pt-4 pb-8 min-h-[320px]">
          {/* Tuning Step */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Tuning Step</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Frequency change per scroll wheel step on the passband.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={tuningStepHz}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1 && val <= 100000) {
                    onTuningStepChange(val);
                  }
                }}
                min={1}
                max={100000}
                step={10}
                className="h-8 text-xs font-mono"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">Hz</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {[10, 50, 100, 500, 1000, 5000].map((preset) => (
                <Button
                  key={preset}
                  type="button"
                  variant={tuningStepHz === preset ? 'default' : 'secondary'}
                  size="sm"
                  onClick={() => onTuningStepChange(preset)}
                  className="h-7 px-2 text-xs"
                >
                  {preset >= 1000 ? `${preset / 1000}kHz` : `${preset}Hz`}
                </Button>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="agc" className="space-y-4 pt-4 pb-8 min-h-[320px]">
          {/* AGC */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">AGC (Automatic Gain Control)</Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Controls how quickly the audio level adjusts to signal strength changes.
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <span className="capitalize">{audioSettings.agcSpeed}</span>
                  <ChevronDown className="h-4 w-4 opacity-50" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
                {(['off', 'fast', 'medium', 'slow'] as AgcSpeed[]).map((speed) => (
                  <DropdownMenuCheckboxItem
                    key={speed}
                    checked={audioSettings.agcSpeed === speed}
                    onCheckedChange={(checked) => {
                      if (checked) onAudioSettingsChange((prev) => ({ ...prev, agcSpeed: speed }));
                    }}
                  >
                    <div className="flex w-full flex-col">
                      <span className="capitalize font-medium">{speed}</span>
                      <span className="text-xs text-muted-foreground">
                        {speed === 'off' && 'No automatic gain control'}
                        {speed === 'fast' && 'Quick response, 1ms / 50ms'}
                        {speed === 'medium' && 'Balanced, 10ms / 150ms (default)'}
                        {speed === 'slow' && 'Smooth, 50ms / 500ms'}
                      </span>
                    </div>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TabsContent>

        <TabsContent value="debug" className="space-y-4 pt-4 pb-8 min-h-[320px]">
          {/* Debug Stats */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm font-medium">Audio Stream Statistics</Label>
            </div>
            {debugStats ? (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3 font-mono text-xs">
                <DebugRow label="Packets Received" value={debugStats.packetsReceived.toLocaleString()} />
                <DebugRow
                  label="Packets Dropped"
                  value={debugStats.packetsDropped.toLocaleString()}
                  highlight={debugStats.packetsDropped > 0}
                />
                <DebugRow label="Current Latency" value={`${debugStats.currentLatencyMs}ms`} />
                <DebugRow label="Target Latency" value={`${debugStats.targetLatencyMs}ms`} />
                <DebugRow label="Queued Samples" value={debugStats.queuedSamples.toLocaleString()} />
                <DebugRow
                  label="Buffer Health"
                  value={`${Math.round(debugStats.bufferHealth * 100)}%`}
                  highlight={debugStats.bufferHealth < 0.5}
                />
                <DebugRow
                  label="Codec Rate"
                  value={debugStats.codecRate > 0 ? `${(debugStats.codecRate / 1000).toFixed(1)}kHz` : 'N/A'}
                />
                <DebugRow
                  label="Output Rate"
                  value={debugStats.outputRate > 0 ? `${(debugStats.outputRate / 1000).toFixed(1)}kHz` : 'N/A'}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No audio stream active</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </AnimatedDialog>
  );
}

function DebugRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className={highlight ? 'text-destructive font-semibold' : ''}>{value}</span>
    </div>
  );
}
