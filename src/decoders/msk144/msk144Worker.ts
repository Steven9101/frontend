//
// WebWorker: MSK144 decoder 
//

import init, { Msk144WasmDecoder, main } from './pkg/msk144_decoder.js';


type InitMsg = { type: 'init'; inputSampleRate: number; timeOffsetMs?: number };
type PcmMsg = { type: 'pcm'; pcm: Float32Array };
type TimeOffsetMsg = { type: 'timeOffset'; offsetMs: number };
type StopMsg = { type: 'stop' };
type Msg = InitMsg | PcmMsg | TimeOffsetMsg | StopMsg;

type WorkerOut =
  | { type: 'ready' }
  | { type: 'log'; text: string }
  | { type: 'error'; message: string };


function post(out: WorkerOut) {
  (self as any).postMessage(out);
}

function log(text: string) {
  post({ type: 'log', text });
}

// msk144 accepts chunks of ~0.3 second.
const WORKING_LOOP_DELAY_IN_MILLISECONDS = 300;

// 100k samples for 48ksps means ~2 seconds buffer. More than enough.
const BIG_BUFFER_SIZE_IN_ELEMENTS = 100_000;

const big_array = new Float32Array(BIG_BUFFER_SIZE_IN_ELEMENTS);
let tail_pos = 0;

let decoder_msk144: Msk144WasmDecoder | null = null;
let need_stop = false;
let scheduled = false;

function scheduleDecodeLoop() {
  if (scheduled || need_stop) return;
  scheduled = true;

  const tick = () => {
    if (need_stop) return;

    // feed data to process
    for (;;) {
      let taken = 0;
      try {
        const slice = big_array.subarray(0, tail_pos);
        taken = decoder_msk144!.process(slice);
      } catch (e: any) {
        post({ type: 'error', message: e?.message ?? String(e) });
      }
      if (taken == 0) break;
      big_array.copyWithin(0, taken, tail_pos);
      tail_pos -= taken;
      if (tail_pos == 0) break;
    }

    // gather results
    for (;;) {
      try {
        const res = decoder_msk144!.take_next_result();
        if (!res) break;
        log(res);
      } catch (e: any) {
        post({ type: 'error', message: e?.message ?? String(e) });
      }
    }

    setTimeout(tick, WORKING_LOOP_DELAY_IN_MILLISECONDS);
  };

  setTimeout(tick, WORKING_LOOP_DELAY_IN_MILLISECONDS);
}

async function worker_init(inputSampleRate: number, _offset: number) {
  await init();
  main();
  let silence_threshold = 0.001; // this means it always works
  let ntol = 250.0; // 1500Hz +-?Hz
  decoder_msk144 = new Msk144WasmDecoder(inputSampleRate, silence_threshold, ntol);
  console.log("created Msk144WasmDecoder for ", inputSampleRate, silence_threshold, ntol);

  scheduleDecodeLoop();
  post({ type: 'ready' });
}

function pushPcm(pcm: Float32Array) {
  if (tail_pos + pcm.length > BIG_BUFFER_SIZE_IN_ELEMENTS) {
    // overrun - drop audio samples
    console.log("overrun");
    return;
  }
  big_array.set(pcm, tail_pos);
  tail_pos += pcm.length;
}

self.onmessage = (ev: MessageEvent<Msg>) => {
  const msg = ev.data;
  if (msg.type === 'stop') {
    need_stop = true;
    return;
  }
  if (msg.type === 'timeOffset') {
    // msk144 doesn't have timeOffset
    return;
  }
  if (msg.type === 'init') {
    worker_init(msg.inputSampleRate, msg.timeOffsetMs ?? 0).catch((e: any) => {
      post({ type: 'error', message: e?.message ?? String(e) });
    });
    return;
  }
  if (msg.type === 'pcm') {
    pushPcm(msg.pcm);
  }
};
