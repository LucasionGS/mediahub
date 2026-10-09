import Library from "./Library";
import type { HubApp } from "../shared/types";

const FETCH_TIMEOUT_MS = 8000;
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const EXTS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/gif": "gif",
};

interface Candidate {
  url: string;
  size: number; // Largest side in px, 0 = unknown
}

/**
 * Finds and downloads an icon for a web app: the largest icon from its web manifest or `apple-touch-icon`,
 * falling back to `/favicon.ico`.
 */
export class WebIcons {
  private constructor() { }

  /**
   * Fetch an icon for `app` and save it as its icon artwork. Failures are logged, never thrown.
   */
  public static async fetchFor(app: HubApp) {
    if (app.type !== "web" || !app.url || app.icon) return;
    try {
      const candidates = await WebIcons.findCandidates(new URL(app.url));
      for (const candidate of candidates) {
        const icon = await WebIcons.download(candidate.url);
        if (!icon) continue;
        // The app may have been removed or given an icon while we were downloading
        const current = Library.get(app.appId);
        if (!current || current.icon) return;
        await Library.saveArtwork(app.appId, "icon", icon.data, icon.ext);
        return;
      }
    } catch (error) {
      console.warn(`Could not fetch an icon for ${app.url}:`, (error as Error).message);
    }
  }

  private static async findCandidates(pageUrl: URL): Promise<Candidate[]> {
    const candidates: Candidate[] = [];
    const html = await fetchText(pageUrl.origin + "/").catch(() => "");

    for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
      const rel = attr(tag, "rel")?.toLowerCase() ?? "";
      const href = attr(tag, "href");
      if (!href) continue;
      const url = new URL(href, pageUrl.origin).toString();
      if (rel.includes("manifest")) {
        candidates.push(...await WebIcons.fromManifest(url));
      }
      else if (rel.includes("apple-touch-icon")) {
        candidates.push({ url, size: parseSize(attr(tag, "sizes")) || 180 });
      }
      else if (rel.split(/\s+/).includes("icon")) {
        candidates.push({ url, size: parseSize(attr(tag, "sizes")) || (url.endsWith(".svg") ? 512 : 32) });
      }
    }
    candidates.sort((a, b) => b.size - a.size);
    candidates.push({ url: `${pageUrl.origin}/favicon.ico`, size: 16 });
    return candidates;
  }

  private static async fromManifest(manifestUrl: string): Promise<Candidate[]> {
    try {
      const manifest = JSON.parse(await fetchText(manifestUrl));
      const icons: { src: string; sizes?: string; purpose?: string }[] = manifest.icons ?? [];
      return icons
        .filter(icon => icon.src && !icon.purpose?.includes("monochrome"))
        .map(icon => ({ url: new URL(icon.src, manifestUrl).toString(), size: parseSize(icon.sizes) }));
    } catch {
      return [];
    }
  }

  private static async download(url: string): Promise<{ data: Buffer; ext: string } | null> {
    try {
      const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) return null;
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      const ext = EXTS[type];
      if (!ext) return null;
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length === 0 || data.length > MAX_ICON_BYTES) return null;
      return { data, ext };
    } catch {
      return null;
    }
  }
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4]) : null;
}

/**
 * Largest side from a `sizes` value like "192x192 512x512", or 0. "any" (SVG) counts as large.
 */
function parseSize(sizes: string | null | undefined): number {
  if (!sizes) return 0;
  if (sizes.includes("any")) return 1024;
  return Math.max(0, ...sizes.split(/\s+/).map(s => parseInt(s.split("x")[0]) || 0));
}

export default WebIcons;
