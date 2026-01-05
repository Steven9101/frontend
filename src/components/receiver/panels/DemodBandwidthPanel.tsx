import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Minus, Plus, Radio } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import type { ReceiverMode } from '../../../lib/receiverMode';

type Props = {
  mode: ReceiverMode;
  canWbfm: boolean;
  centerHz: number | null;
  bandwidthHz: number | null;
  onModeChange: (mode: ReceiverMode) => void;
  onSetFrequencyKhz: (khz: number) => void;
  onFrequencyAdjustKhz: (khz: number) => void;
  onBandwidthAdjustHz: (deltaHz: number) => void;
};

const BANDWIDTH_STEPS_HZ = [-1000, -100, 100, 1000] as const;
const FREQ_STEPS_KHZ = [-10, -1, -0.1, 0, 0.1, 1, 10] as const;

export function DemodBandwidthPanel({
  mode,
  canWbfm,
  centerHz,
  bandwidthHz,
  onModeChange,
  onSetFrequencyKhz,
  onFrequencyAdjustKhz,
  onBandwidthAdjustHz,
}: Props) {
  const displayKhz = useMemo(() => {
    if (centerHz === null) return null;
    return centerHz / 1_000;
  }, [centerHz]);

  const [freqText, setFreqText] = useState('');
  const [freqEditing, setFreqEditing] = useState(false);
  const zeroIsNoop = useMemo(() => {
    if (centerHz == null) return false;
    return Math.round(centerHz / 1_000) * 1_000 === centerHz;
  }, [centerHz]);

  const applyFrequencyText = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const normalized = trimmed.replace(/\s+/g, '').replace(',', '.');
    const valueKhz = Number(normalized);
    if (!Number.isFinite(valueKhz) || valueKhz <= 0) return;

    const targetHz = Math.round(valueKhz * 1_000);
    if (centerHz != null && targetHz === Math.round(centerHz)) return;

    onSetFrequencyKhz(valueKhz);
  };

  return (
    <Card className="flex h-full min-h-0 flex-col shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Demodulation</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4 pt-0">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="freq-khz">Frequency (kHz)</Label>
            <Input
              id="freq-khz"
              value={freqEditing ? freqText : displayKhz === null ? '' : displayKhz.toFixed(3)}
              inputMode="decimal"
              placeholder={displayKhz === null ? '—' : displayKhz.toFixed(3)}
              onFocus={() => {
                setFreqText(displayKhz === null ? '' : displayKhz.toFixed(3));
                setFreqEditing(true);
              }}
              onBlur={(e) => {
                applyFrequencyText(e.currentTarget.value);
                setFreqEditing(false);
                setFreqText('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFreqEditing(false);
                  setFreqText('');
                  (e.currentTarget as HTMLInputElement).blur();
                  return;
                }
                if (e.key !== 'Enter') return;
                applyFrequencyText(e.currentTarget.value);
                setFreqEditing(false);
                setFreqText('');
                (e.currentTarget as HTMLInputElement).blur();
              }}
              onChange={(e) => {
                if (!freqEditing) setFreqEditing(true);
                setFreqText(e.target.value);
              }}
              className="h-9"
            />
          </div>

          <div className="space-y-2">
            <Label>Mode</Label>
            <DropdownMenuPrimitive.Root modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" className="h-9 w-full justify-between">
                  <span className="font-medium">{mode}</span>
                  <ChevronDown className="h-4 w-4 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(['USB', 'LSB', 'CW', 'AM', 'SAM', 'FM', 'FMC'] as const).map((m) => (
                  <DropdownMenuItem key={m} onSelect={() => onModeChange(m)}>
                    {m}
                  </DropdownMenuItem>
                ))}
                {canWbfm ? (
                  <DropdownMenuItem key="WBFM" onSelect={() => onModeChange('WBFM')}>
                    WBFM
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenuPrimitive.Root>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Bandwidth adjust (Hz)</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {BANDWIDTH_STEPS_HZ.map((step) => (
              <Button
                key={step}
                type="button"
                variant="secondary"
                className="h-9 gap-1.5 whitespace-nowrap"
                onClick={() => onBandwidthAdjustHz(step)}
              >
                {step < 0 ? <Minus className="h-4 w-4 shrink-0" /> : <Plus className="h-4 w-4 shrink-0" />}
                <span className="tabular-nums">{Math.abs(step).toLocaleString()}</span>
              </Button>
            ))}
          </div>
          {bandwidthHz !== null ? (
            <div className="text-xs text-muted-foreground">Current: {(bandwidthHz / 1000).toFixed(2)} kHz</div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>Frequency adjust (kHz)</Label>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {FREQ_STEPS_KHZ.map((stepKhz) => (
              <Button
                key={stepKhz}
                type="button"
                variant="secondary"
                className={
                  stepKhz === 0 && zeroIsNoop ? 'h-9 bg-muted/40 text-muted-foreground hover:bg-muted/50' : 'h-9'
                }
                onClick={() => onFrequencyAdjustKhz(stepKhz)}
              >
                {stepKhz === 0 ? '0' : stepKhz > 0 ? `+${stepKhz}` : `${stepKhz}`}
              </Button>
            ))}
          </div>
        </div>

      </CardContent>
    </Card>
  );
}
