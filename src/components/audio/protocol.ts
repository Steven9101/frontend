export type BasicInfo = {
  receiver_id?: string;
  receiver_name?: string;
  sps: number;
  audio_max_sps: number;
  audio_max_fft: number;
  audio_compression: string;
  fft_result_size: number;
  basefreq: number;
  total_bandwidth: number;
  smeter_offset: number;
  grid_locator: string;
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
  };
};

export type AudioPacket = {
  frame_num: number;
  l: number;
  m: number;
  r: number;
  pwr: number;
  data: Uint8Array;
};
