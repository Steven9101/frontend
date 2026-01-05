import type { ColormapName } from './colormaps';

export type WaterfallDisplaySettings = {
  minDb: number;
  maxDb: number;
  colormap: ColormapName;
  autoAdjust: boolean;
  spectrumOverlay: boolean;
  biggerWaterfall: boolean;
  manualMinDb?: number;
  manualMaxDb?: number;
};

