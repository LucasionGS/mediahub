import { useEffect, useState } from "react";
import { assetUrl } from "./assets";
import type { HubApp } from "../../shared/types";

const DEFAULT_ACCENT = "#3b6cff";
const cache = new Map<string, string>();

/**
 * The app's accent colour: its own `accentColor`, or the dominant saturated colour of its icon.
 */
export function useAccentColor(app: HubApp | null | undefined): string {
  const iconPath = app?.icon ?? null;
  const [derived, setDerived] = useState(() => iconPath ? cache.get(iconPath) ?? null : null);

  useEffect(() => {
    if (!iconPath || app?.accentColor) return;
    const cached = cache.get(iconPath);
    if (cached) return setDerived(cached);
    let cancelled = false;
    extractColor(iconPath).then(color => {
      cache.set(iconPath, color);
      if (!cancelled) setDerived(color);
    });
    return () => {
      cancelled = true;
    };
  }, [iconPath, app?.accentColor]);

  return app?.accentColor ?? (iconPath ? derived : null) ?? DEFAULT_ACCENT;
}

function extractColor(path: string): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0, g = 0, b = 0, weight = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [pr, pg, pb, pa] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
          if (pa < 128) continue;
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          // Weight by saturation so grey outlines and white backgrounds don't win
          const saturation = max === 0 ? 0 : (max - min) / max;
          const w = saturation * saturation + 0.02;
          r += pr * w;
          g += pg * w;
          b += pb * w;
          weight += w;
        }
        if (weight === 0) return resolve(DEFAULT_ACCENT);
        resolve(`rgb(${Math.round(r / weight)}, ${Math.round(g / weight)}, ${Math.round(b / weight)})`);
      } catch {
        resolve(DEFAULT_ACCENT);
      }
    };
    img.onerror = () => resolve(DEFAULT_ACCENT);
    img.src = assetUrl(path)!;
  });
}
