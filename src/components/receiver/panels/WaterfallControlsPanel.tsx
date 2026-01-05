import { ChevronDown, Droplets, Palette, Waves } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '../../ui/dropdown-menu';
import { Label } from '../../ui/label';
import { Slider } from '../../ui/slider';
import { Switch } from '../../ui/switch';
import type { WaterfallDisplaySettings } from '../../waterfall/viewSettings';

type Props = {
  settings: WaterfallDisplaySettings;
  onChange: React.Dispatch<React.SetStateAction<WaterfallDisplaySettings>>;
};

export function WaterfallControlsPanel({ settings, onChange }: Props) {
  const displayMinDb = settings.autoAdjust ? settings.minDb : (settings.manualMinDb ?? settings.minDb);
  const displayMaxDb = settings.autoAdjust ? settings.maxDb : (settings.manualMaxDb ?? settings.maxDb);

  return (
    <Card className="flex h-full min-h-0 flex-col shadow-none">
      <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-3">
        <div className="flex items-center gap-2">
          <Waves className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Waterfall</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4 pt-0">
        <div className="space-y-2">
          <Label>Brightness</Label>
          <div className="space-y-2">
            <Row label="Min" value={`${Math.round(displayMinDb)} dB`}>
              <Slider
                value={[displayMinDb]}
                min={-100}
                max={255}
                step={1}
                disabled={settings.autoAdjust}
                onValueChange={([v]) =>
                  onChange((prev) => {
                    if (prev.autoAdjust) return prev;
                    return {
                    ...prev,
                    minDb: v,
                      manualMinDb: v,
                      maxDb: Math.min(255, Math.max(prev.manualMaxDb ?? prev.maxDb, v + 1)),
                      manualMaxDb: Math.min(255, Math.max(prev.manualMaxDb ?? prev.maxDb, v + 1)),
                    };
                  })
                }
              />
            </Row>
            <Row label="Max" value={`${Math.round(displayMaxDb)} dB`}>
              <Slider
                value={[displayMaxDb]}
                min={0}
                max={255}
                step={1}
                disabled={settings.autoAdjust}
                onValueChange={([v]) =>
                  onChange((prev) => {
                    if (prev.autoAdjust) return prev;
                    return {
                    ...prev,
                    maxDb: v,
                      manualMaxDb: v,
                      minDb: Math.max(-100, Math.min(prev.manualMinDb ?? prev.minDb, v - 1)),
                      manualMinDb: Math.max(-100, Math.min(prev.manualMinDb ?? prev.minDb, v - 1)),
                    };
                  })
                }
              />
            </Row>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Colormap</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <span>{settings.colormap}</span>
                <ChevronDown className="h-4 w-4 opacity-50" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[--radix-dropdown-menu-trigger-width]">
              <DropdownMenuCheckboxItem
                checked={settings.colormap === 'gqrx'}
                onCheckedChange={(checked) => {
                  if (checked) onChange((prev) => ({ ...prev, colormap: 'gqrx' }));
                }}
              >
                gqrx
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={settings.colormap === 'rainbow'}
                onCheckedChange={(checked) => {
                  if (checked) onChange((prev) => ({ ...prev, colormap: 'rainbow' }));
                }}
              >
                rainbow
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={settings.colormap === 'viridis'}
                onCheckedChange={(checked) => {
                  if (checked) onChange((prev) => ({ ...prev, colormap: 'viridis' }));
                }}
              >
                viridis
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={settings.colormap === 'twentev2'}
                onCheckedChange={(checked) => {
                  if (checked) onChange((prev) => ({ ...prev, colormap: 'twentev2' }));
                }}
              >
                twentev2
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid gap-2">
          <ToggleRow
            icon={<Droplets className="h-4 w-4" />}
            label="Auto Adjust"
            checked={settings.autoAdjust}
            onCheckedChange={(checked) => 
              onChange((prev) => {
                if (!checked) {
                  // Turning off: restore manual values
                  return {
                    ...prev,
                    autoAdjust: false,
                    minDb: prev.manualMinDb ?? prev.minDb,
                    maxDb: prev.manualMaxDb ?? prev.maxDb,
                  };
                }
                // Turning on: save current manual values
                return {
                  ...prev,
                  autoAdjust: true,
                  manualMinDb: prev.manualMinDb ?? prev.minDb,
                  manualMaxDb: prev.manualMaxDb ?? prev.maxDb,
                };
              })
            }
          />
          <ToggleRow
            icon={<Palette className="h-4 w-4" />}
            label="Spectrum"
            checked={settings.spectrumOverlay}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, spectrumOverlay: checked }))}
          />
          <ToggleRow
            icon={<Waves className="h-4 w-4" />}
            label="Bigger Waterfall"
            checked={settings.biggerWaterfall}
            onCheckedChange={(checked) => onChange((prev) => ({ ...prev, biggerWaterfall: checked }))}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[52px_1fr_48px] items-center gap-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {children}
      <div className="text-right text-xs text-muted-foreground">{value}</div>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onCheckedChange,
}: {
  icon: React.ReactNode;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">{icon}</span>
        <span className="font-medium">{label}</span>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
