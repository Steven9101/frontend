/* eslint-disable @typescript-eslint/no-explicit-any */
// WebWorker: FT8 decoder pipeline (JS resample -> accumulate -> decode on 15s boundaries)

// @ts-expect-error emscripten module (no types)
import decodeFT8Module from './emscripten/decode_ft8.js';

import decodeFt8WasmUrl from './emscripten/decode_ft8.wasm?url';

type InitMsg = { type: 'init'; inputSampleRate: number };
type PcmMsg = { type: 'pcm'; pcm: Float32Array };
type StopMsg = { type: 'stop' };
type Msg = InitMsg | PcmMsg | StopMsg;

type WorkerOut =
  | { type: 'ready' }
  | { type: 'log'; text: string }
  | { type: 'error'; message: string };

const TARGET_FS = 12_000;
const FRAME_SEC = 15;
const FRAME_SAMPLES = TARGET_FS * FRAME_SEC;
const CARRYOVER_SAMPLES = 120; // keep up to 120 samples (~10ms) after each decode

let decodeFT8: any | null = null;
let inputFs = 48_000;

let signalPtr = 0;
let signalArr: Float32Array | null = null;
let writePos = 0;

let stopped = false;
let scheduled = false;

// Streaming resampler state (linear interpolation)
let prevSample = 0;
let posIn = 0; // fractional position in "extended input" (prev + current chunk)
let stepIn = 1; // input samples per output sample (inputFs / TARGET_FS)

function post(out: WorkerOut) {
  (self as any).postMessage(out);
}

function log(text: string) {
  post({ type: 'log', text });
}

function scheduleDecodeLoop() {
  if (scheduled || stopped) return;
  scheduled = true;

  const tick = () => {
    if (stopped) return;
    try {
      // decode_ft8 writes results via print/printErr -> forwarded to main thread
      decodeFT8?._decode_ft8(0, 0, signalPtr, 1);
    } catch (e: any) {
      post({ type: 'error', message: e?.message ?? String(e) });
    }

    // Decode on each 15s boundary, then keep only a tiny carryover.
    const extra = writePos - FRAME_SAMPLES;
    if (extra > 0 && signalArr) {
      signalArr.set(signalArr.slice(FRAME_SAMPLES, writePos), 0);
      writePos = Math.min(extra, CARRYOVER_SAMPLES);
    } else {
      writePos = Math.min(writePos, FRAME_SAMPLES);
    }

    const now = Date.now();
    const delay = FRAME_SEC * 1000 - (now % (FRAME_SEC * 1000));
    setTimeout(tick, delay);
  };

  const now = Date.now();
  const delay = FRAME_SEC * 1000 - (now % (FRAME_SEC * 1000));
  setTimeout(tick, delay);
}

async function init(inputSampleRate: number) {
  stopped = false;
  scheduled = false;
  writePos = 0;
  inputFs = inputSampleRate;
  prevSample = 0;
  posIn = 0;
  stepIn = inputFs / TARGET_FS;

  const decode = await decodeFT8Module({
    print: (t: string) => log(t),
    printErr: (t: string) => log(t),
    locateFile: (path: string) => (path.endsWith('.wasm') ? decodeFt8WasmUrl : path),
  });

  decodeFT8 = decode;

  // Allocate a little extra headroom.
  const cap = FRAME_SAMPLES * 2;
  signalPtr = decodeFT8._malloc(cap * 4);
  signalArr = new Float32Array(decodeFT8.HEAPU8.buffer, signalPtr, cap);
  signalArr.fill(0);

  post({ type: 'ready' });
  scheduleDecodeLoop();
}

function pushPcm(pcm: Float32Array) {
  if (!signalArr) return;
  if (!Number.isFinite(stepIn) || stepIn <= 0) return;

  // We treat input as: [prevSample, ...pcm]
  const extLen = pcm.length + 1;
  // Produce outputs while we can interpolate ext[i]..ext[i+1]
  while (posIn + 1 < extLen) {
    const i = Math.floor(posIn);
    const frac = posIn - i;
    const s0 = i === 0 ? prevSample : pcm[i - 1];
    const s1 = i === 0 ? pcm[0] : pcm[i];
    const y = s0 + (s1 - s0) * frac;

    if (writePos < signalArr.length) {
      signalArr[writePos++] = y;
    } else {
      // If we still overflow, drop newest samples.
      break;
    }

    posIn += stepIn;
  }

  // Advance pos into next chunk's extended space
  posIn -= pcm.length;
  if (posIn < 0) posIn = 0;
  prevSample = pcm.length > 0 ? pcm[pcm.length - 1] : prevSample;
}

self.onmessage = (ev: MessageEvent<Msg>) => {
  const msg = ev.data;
  if (msg.type === 'stop') {
    stopped = true;
    return;
  }
  if (msg.type === 'init') {
    init(msg.inputSampleRate).catch((e: any) => {
      post({ type: 'error', message: e?.message ?? String(e) });
    });
    return;
  }
  if (msg.type === 'pcm') {
    pushPcm(msg.pcm);
  }
};


