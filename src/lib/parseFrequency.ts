type ReceiverRange = { id: string; min_hz?: number; max_hz?: number };

export function parseFrequencyHzFromQueryParam(raw: string): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) {
    const hz = Number.parseInt(s, 10);
    if (!Number.isFinite(hz) || hz <= 0) return null;
    return hz;
  }

  const parsed = Number.parseFloat(s);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  // Convenience parsing:
  // - values < 1,000 are treated as MHz (e.g. 7.074)
  // - values < 1,000,000 are treated as kHz (e.g. 7074.0)
  // - otherwise treated as Hz
  const hz = parsed < 1_000 ? parsed * 1_000_000 : parsed < 1_000_000 ? parsed * 1_000 : parsed;
  const rounded = Math.round(hz);
  if (!Number.isFinite(rounded) || rounded <= 0) return null;
  return rounded;
}

function receiverSpanHz(r: ReceiverRange): number | null {
  const min = r.min_hz;
  const max = r.max_hz;
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;
  return max - min;
}

function receiverContainsHz(r: ReceiverRange, hz: number): boolean {
  const min = r.min_hz;
  const max = r.max_hz;
  if (typeof min !== 'number' || typeof max !== 'number') return false;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return false;
  return hz >= min && hz <= max;
}

function bestSpanForHz(receivers: ReceiverRange[], hz: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const r of receivers) {
    if (!receiverContainsHz(r, hz)) continue;
    const span = receiverSpanHz(r);
    if (span == null) continue;
    best = Math.min(best, span);
  }
  return best;
}

export function resolveFrequencyHzFromQueryParam(
  raw: string,
  opts?: { receivers?: ReceiverRange[] | null; rxId?: string | null },
): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;

  if (!/^\d+$/.test(s)) return parseFrequencyHzFromQueryParam(s);

  const v = Number.parseInt(s, 10);
  if (!Number.isFinite(v) || v <= 0) return null;

  const candidates: number[] = [];
  const push = (hz: number) => {
    if (!Number.isFinite(hz) || hz <= 0) return;
    const rounded = Math.round(hz);
    if (!Number.isFinite(rounded) || rounded <= 0) return;
    if (candidates.includes(rounded)) return;
    candidates.push(rounded);
  };

  push(v);
  if (v <= Number.MAX_SAFE_INTEGER / 1_000) push(v * 1_000);
  if (v <= Number.MAX_SAFE_INTEGER / 1_000_000) push(v * 1_000_000);

  const receivers = opts?.receivers ?? null;
  const rxId = opts?.rxId ?? null;
  if (!receivers || receivers.length === 0) return candidates[0] ?? null;

  if (rxId) {
    const rx = receivers.find((r) => r.id === rxId) ?? null;
    if (rx) {
      const match = candidates.find((c) => receiverContainsHz(rx, c)) ?? null;
      if (match != null) return match;
    }
  }

  let bestCandidate = candidates[0] ?? null;
  let bestSpan = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const span = bestSpanForHz(receivers, c);
    if (span < bestSpan) {
      bestSpan = span;
      bestCandidate = c;
    }
  }

  return bestCandidate;
}
