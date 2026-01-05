import { Circle, Download, Info, MicOff, Radio, Square, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import type { AudioDebugStats, AudioUiSettings } from '../../audio/types';
import { useAudioClient } from '../../audio/useAudioClient';
import { AnimatedBottomSheet } from '../../ui/animated-bottom-sheet';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Label } from '../../ui/label';
import { Slider } from '../../ui/slider';
import { Switch } from '../../ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/tooltip';
import type { ReceiverMode } from '../../../lib/receiverMode';

type Props = {
  receiverId: string | null;
  receiverSessionNonce: number;
  mode: ReceiverMode;
  centerHz: number | null;
  audioWindow?: { l: number; m: number; r: number } | null;
  settings: AudioUiSettings;
  onChange: React.Dispatch<React.SetStateAction<AudioUiSettings>>;
  onDebugStatsChange: React.Dispatch<React.SetStateAction<AudioDebugStats | null>>;
  onGridLocatorChange?: (grid: string | null) => void;
  onAudioMaxSpsChange?: (sps: number | null) => void;
  onPcm?: (pcm: Float32Array, sampleRate: number) => void;
};

export function AudioPanel({
  receiverId,
  receiverSessionNonce,
  mode,
  centerHz,
  audioWindow,
  settings,
  onChange,
  onDebugStatsChange,
  onGridLocatorChange,
  onAudioMaxSpsChange,
  onPcm,
}: Props) {
  const audio = useAudioClient({ receiverId, receiverSessionNonce, mode, centerHz, settings, audioWindow, onPcm });

  useEffect(() => {
    onDebugStatsChange(audio.debugStats);
  }, [audio.debugStats, onDebugStatsChange]);

  useEffect(() => {
    onGridLocatorChange?.(audio.gridLocator);
  }, [audio.gridLocator, onGridLocatorChange]);

  useEffect(() => {
    onAudioMaxSpsChange?.(audio.audioMaxSps);
  }, [audio.audioMaxSps, onAudioMaxSpsChange]);

  return (
    <Card className="flex h-full min-h-0 flex-col shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Audio</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="relative flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4 pt-0">
        <div className="space-y-2">
          <Label>Volume</Label>
          <Slider
            value={[settings.volume]}
            min={0}
            max={100}
            step={1}
            onValueChange={([v]) => onChange((prev) => ({ ...prev, volume: v }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ToggleRow
            icon={<MicOff className="h-4 w-4 shrink-0" />}
            label="Mute"
            help="Mutes audio output."
            checked={settings.mute}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, mute: checked }))}
          />
          <ToggleRow
            icon={<Radio className="h-4 w-4 shrink-0" />}
            label="Squelch"
            help="Silences audio when signal level is low."
            checked={settings.squelch}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, squelch: checked }))}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <ToggleSmall
            label="NR"
            help="Noise reduction suppresses broadband noise."
            checked={settings.nr}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, nr: checked }))}
          />
          <ToggleSmall
            label="NB"
            help="Noise blanker reduces short impulse noise (clicks/pops)."
            checked={settings.nb}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, nb: checked }))}
          />
          <ToggleSmall
            label="AN"
            help="Auto notch reduces steady tones. On FM it can also reduce CTCSS tones."
            checked={settings.an}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, an: checked }))}
          />
        </div>

        <div className="space-y-2">
          <Label>Recording</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={audio.isRecording ? 'default' : 'secondary'}
              className="gap-2"
              onClick={() => {
                if (audio.isRecording) audio.stopRecording();
                else audio.startRecording();
              }}
            >
              {audio.isRecording ? (
                <Square className="h-4 w-4" />
              ) : (
                <Circle className="h-4 w-4 fill-red-500 text-red-500" />
              )}
              {audio.isRecording ? 'Stop' : 'Record'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="gap-2"
              disabled={!audio.canDownload}
              onClick={audio.downloadRecording}
            >
              <Download className="h-4 w-4" />
              Download
            </Button>
          </div>
        </div>

        <div className="rounded-md border bg-muted/10 px-3 py-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>S-meter</span>
            <span>{audio.pwrDb == null ? '—' : `${audio.pwrDb.toFixed(1)} dB`}</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary"
              style={{ width: `${audio.pwrDb == null ? 0 : Math.round(clamp01((audio.pwrDb + 120) / 120) * 100)}%` }}
            />
          </div>
        </div>

      </CardContent>
    </Card>
  );
}

function ToggleRow({
  icon,
  label,
  help,
  checked,
  onCheckedChange,
}: {
  icon: React.ReactNode;
  label: string;
  help: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={checked}
      className="flex cursor-pointer select-none items-center justify-between rounded-md border bg-background px-3 py-2"
      onClick={(e) => {
        if (e.defaultPrevented) return;
        onCheckedChange(!checked);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onCheckedChange(!checked);
      }}
    >
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{icon}</span>
        <span className="font-medium">{label}</span>
        <HelpTip title={label} text={help} />
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function ToggleSmall({
  label,
  help,
  checked,
  onCheckedChange,
}: {
  label: ReactNode;
  help: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={checked}
      className="flex cursor-pointer select-none items-center justify-between rounded-md border bg-background px-3 py-2"
      onClick={(e) => {
        if (e.defaultPrevented) return;
        onCheckedChange(!checked);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onCheckedChange(!checked);
      }}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        {typeof label === 'string' ? label : label}
        <HelpTip title={typeof label === 'string' ? label : 'Help'} text={help} />
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function HelpTip({ title, text }: { title: string; text: string }) {
  const [open, setOpen] = useState(false);
  const canHover = useMemo(() => {
    if (typeof window === 'undefined') return true;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  }, []);

  if (!canHover) {
    return (
      <>
        <button
          type="button"
          className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border/60 bg-background/60 text-muted-foreground/80 hover:bg-background hover:text-muted-foreground"
          aria-label="Help"
          onPointerDownCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerUpCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <Info className="h-3 w-3" />
        </button>

        <AnimatedBottomSheet
          open={open}
          onOpenChange={setOpen}
          title={title}
          description={text}
          contentClassName="max-w-none"
        >
          <div />
        </AnimatedBottomSheet>
      </>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label="Help"
          className="inline-flex h-[18px] w-[18px] items-center justify-center rounded-full border border-border/60 bg-background/60 text-muted-foreground/80 hover:bg-background hover:text-muted-foreground"
          onPointerDownCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onPointerUpCapture={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
          }}
        >
          <Info className="h-3 w-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
