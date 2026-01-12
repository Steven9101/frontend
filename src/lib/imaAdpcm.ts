const INDEX_TABLE: Int8Array = new Int8Array([
  -1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
]);

const STEP_TABLE: Int16Array = new Int16Array([
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107,
  118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060,
  1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132,
  7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);

function clampI16(value: number): number {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return value | 0;
}

function clampIndex(value: number): number {
  if (value < 0) return 0;
  if (value > 88) return 88;
  return value | 0;
}

export function decodeImaAdpcmMono(payload: Uint8Array): Float32Array {
  if (payload.length < 6) return new Float32Array(0);

  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  let predictor = view.getInt16(0, true);
  let index = clampIndex(payload[2] ?? 0);
  const sampleCount = view.getUint16(4, true);
  if (sampleCount === 0) return new Float32Array(0);

  const out = new Float32Array(sampleCount);
  out[0] = predictor / 32768.0;

  let outIdx = 1;
  let byteIdx = 6;
  let useHighNibble = false;

  while (outIdx < sampleCount && byteIdx < payload.length) {
    const byte = payload[byteIdx] ?? 0;
    const code = useHighNibble ? (byte >> 4) & 0x0f : byte & 0x0f;
    if (useHighNibble) byteIdx += 1;
    useHighNibble = !useHighNibble;

    const step = STEP_TABLE[index] ?? 7;
    let diff = step >> 3;
    if (code & 4) diff += step;
    if (code & 2) diff += step >> 1;
    if (code & 1) diff += step >> 2;

    predictor = clampI16((code & 8) !== 0 ? predictor - diff : predictor + diff);
    index = clampIndex(index + (INDEX_TABLE[code] ?? 0));

    out[outIdx] = predictor / 32768.0;
    outIdx += 1;
  }

  return out;
}

