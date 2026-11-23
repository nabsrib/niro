import { useEffect, useState } from 'react';
import { assetUrl, cachedAssetUrl } from '../assets';

/**
 * URL to show a picture file (assets.ts). A picture someone else just added may
 * not be on the server yet, so a missing one is retried a few times, waiting
 * longer each time.
 */
export function useAssetUrl(id: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => cachedAssetUrl(id) ?? null);
  useEffect(() => {
    if (!id) return;
    const known = cachedAssetUrl(id);
    if (known) {
      setUrl(known);
      return;
    }
    let live = true;
    let tries = 0;
    let timer: number | undefined;
    const load = () =>
      void assetUrl(id).then((u) => {
        if (!live) return;
        if (u) setUrl(u);
        else if (++tries < 8) timer = window.setTimeout(load, Math.min(1000 * 2 ** tries, 15_000));
      });
    load();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [id]);
  return url;
}
