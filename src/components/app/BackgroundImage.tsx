import { useEffect, useState } from 'react';

type Supported = 'jpg' | 'png';

async function tryLoad(url: string): Promise<boolean> {
  try {
    // Use fetch + content-type so we don't get tricked by SPA fallbacks that return index.html (200)
    // for missing assets (which can make <img> onload fire even though it's not an image).
    const resp = await fetch(url, { method: 'GET', cache: 'no-store' });
    if (!resp.ok) return false;
    const ct = resp.headers.get('content-type') ?? '';
    if (!ct.toLowerCase().startsWith('image/')) return false;
    return true;
  } catch {
    return false;
  }
}

async function detectBackgroundUrl(): Promise<{ url: string; kind: Supported } | null> {
  const jpg = '/background.jpg';
  if (await tryLoad(jpg)) return { url: jpg, kind: 'jpg' };

  const png = '/background.png';
  if (await tryLoad(png)) return { url: png, kind: 'png' };

  return null;
}

export function BackgroundImage() {
  const [bgUrl, setBgUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = await detectBackgroundUrl();
      if (cancelled) return;
      setBgUrl(found?.url ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!bgUrl) return null;

  return (
    <>
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${bgUrl})` }}
        aria-hidden="true"
      />
      <div className="pointer-events-none fixed inset-0 z-10 bg-background/85 backdrop-blur-sm" aria-hidden="true" />
    </>
  );
}

