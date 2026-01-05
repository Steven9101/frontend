import { Bookmark as BookmarkIcon, Layers, Search, VolumeX, MoreHorizontal } from 'lucide-react';

import { Button } from '../ui/button';
import { Slider } from '../ui/slider';

export type BandGroup = { ham: Array<{ name: string; startHz: number; endHz: number }>; broadcast: Array<{ name: string; startHz: number; endHz: number }>; other: Array<{ name: string; startHz: number; endHz: number }> };

type Props = {
  onOpenBands: () => void;

  onOpenBookmarks: () => void;
  onOpenMore: () => void;

  zoomOpen: boolean;
  onToggleZoom: () => void;
  zoomValue: number;
  zoomDisabled: boolean;
  onZoomChange: (v: number) => void;

  mute: boolean;
  onToggleMute: () => void;
};

export function MobileWaterfallBar({
  onOpenBands,
  onOpenBookmarks,
  onOpenMore,
  zoomOpen,
  onToggleZoom,
  zoomValue,
  zoomDisabled,
  onZoomChange,
  mute,
  onToggleMute,
}: Props) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/92 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      {zoomOpen ? (
        <div className="border-b bg-muted/15 px-3 py-2">
          <div className="flex items-center gap-3">
            <div className="text-xs font-medium text-muted-foreground">Zoom</div>
            <div className="min-w-0 flex-1">
              <Slider value={[zoomValue]} min={0} max={100} step={1} disabled={zoomDisabled} onValueChange={([v]) => onZoomChange(v)} />
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-8 px-2" onClick={onToggleZoom}>
              Done
            </Button>
          </div>
        </div>
      ) : null}
      <div className="mx-auto w-full max-w-[460px] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5">
        <div className="flex items-center justify-between gap-2 rounded-2xl border bg-muted/10 px-2 py-2 shadow-sm">
          <Button
            type="button"
            variant={zoomOpen ? 'secondary' : 'ghost'}
            size="icon"
            className={zoomOpen ? 'h-10 w-10 rounded-xl' : 'h-10 w-10 rounded-xl bg-transparent'}
            onClick={onToggleZoom}
            aria-label="Zoom"
          >
            <Search className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-xl bg-transparent"
            aria-label="Bands"
            onClick={onOpenBands}
          >
            <Layers className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-xl bg-transparent"
            onClick={onOpenBookmarks}
            aria-label="Bookmarks"
          >
            <BookmarkIcon className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant={mute ? 'secondary' : 'ghost'}
            size="icon"
            className={mute ? 'h-10 w-10 rounded-xl' : 'h-10 w-10 rounded-xl bg-transparent'}
            onClick={onToggleMute}
            aria-label="Mute"
          >
            <VolumeX className="h-4 w-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-10 w-10 rounded-xl bg-transparent"
            aria-label="More"
            onClick={onOpenMore}
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

