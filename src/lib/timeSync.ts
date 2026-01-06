const LS_LAST_CHECK_DATE = 'novasdr.time_sync.last_check_date';
const LS_OFFSET_MS = 'novasdr.time_sync.offset_ms';

function todayLocalKey(): string {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function readTimeOffsetMs(): number {
  try {
    const raw = window.localStorage.getItem(LS_OFFSET_MS);
    if (raw == null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

export function shouldRunDailyTimeSync(): boolean {
  try {
    const last = window.localStorage.getItem(LS_LAST_CHECK_DATE);
    return last !== todayLocalKey();
  } catch {
    return true;
  }
}

export function persistDailyTimeSyncResult(offsetMs: number): void {
  try {
    window.localStorage.setItem(LS_LAST_CHECK_DATE, todayLocalKey());
    window.localStorage.setItem(LS_OFFSET_MS, String(Math.round(offsetMs)));
  } catch {
    // ignore
  }
}

