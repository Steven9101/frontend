import type { ReceiverMode } from './receiverMode';

export type Bookmark = {
  id: string;
  name: string;
  frequencyHz: number;
  mode: ReceiverMode;
  notes?: string;
  createdAtMs: number;
};

const STORAGE_KEY = 'novasdr.bookmarks.v1';

function isBookmark(v: unknown): v is Bookmark {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.frequencyHz === 'number' &&
    typeof obj.mode === 'string' &&
    typeof obj.createdAtMs === 'number'
  );
}

export function loadBookmarks(): Bookmark[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBookmark);
  } catch {
    return [];
  }
}

export function saveBookmarks(items: Bookmark[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function exportBookmarks(items: Bookmark[]): string {
  return JSON.stringify(items, null, 2);
}

export function importBookmarks(raw: string): Bookmark[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isBookmark);
}

export function createBookmarkId(): string {
  return `bm_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}


