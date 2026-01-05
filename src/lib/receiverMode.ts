export const RECEIVER_MODES = ['USB', 'LSB', 'CW', 'AM', 'SAM', 'FM', 'FMC', 'WBFM'] as const;

export type ReceiverMode = (typeof RECEIVER_MODES)[number];

export function isReceiverMode(v: string): v is ReceiverMode {
  return (RECEIVER_MODES as readonly string[]).includes(v);
}

export function normalizeReceiverMode(raw: string, fallback: ReceiverMode = 'USB'): ReceiverMode {
  const up = raw.toUpperCase();
  return isReceiverMode(up) ? up : fallback;
}


