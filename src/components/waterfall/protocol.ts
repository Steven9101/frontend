export type WaterfallSettings = {
  receiver_id?: string;
  receiver_name?: string;
  sps: number;
  fft_size: number;
  fft_result_size: number;
  waterfall_size: number;
  basefreq: number;
  total_bandwidth: number;
  waterfall_compression: string;
  markers?: string;
  bands?: string;
  defaults: {
    frequency: number;
    modulation: string;
    l: number;
    m: number;
    r: number;
    ssb_lowcut_hz?: number;
    ssb_highcut_hz?: number;
    squelch_enabled?: boolean;
    squelch?: boolean;
    colormap?: string;
  };
};

export type WaterfallPacket = {
  frame_num: number;
  l: number;
  r: number;
  data: Int8Array;
};
