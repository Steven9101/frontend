/* tslint:disable */
/* eslint-disable */

export class Audio {
  free(): void;
  [Symbol.dispose](): void;
  constructor(codec: AudioCodec, _codec_rate: number, input_rate: number, output_rate: number);
  decode(input: Uint8Array): Float32Array;
  decode_to_pcm_f32(input: Uint8Array): Float32Array;
  process_pcm_f32(input: Float32Array): Float32Array;
  set_nr(nr: boolean): void;
  set_nb(nb: boolean): void;
  set_an(an: boolean): void;
  set_decoded_callback(f?: Function | null): void;
}

export enum AudioCodec {
  Flac = 0,
  Opus = 1,
}

export class ZstdStreamDecoder {
  free(): void;
  [Symbol.dispose](): void;
  constructor();
  clear(): void;
  decode(input: Uint8Array): Uint8Array[];
}

export function firdes_kaiser_lowpass(cutoff: number, transition_bw: number, max_ripple: number): Float32Array;

export function greet(): void;

export function main(): void;
