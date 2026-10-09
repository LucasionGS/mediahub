import fsp from "node:fs/promises";
import Path from "node:path";
import os from "node:os";
import type { DesktopEntry } from "../shared/types";

const ICON_SIZES = ["scalable", "512x512", "256x256", "192x192", "128x128", "96x96", "64x64", "48x48"];
const ICON_THEMES = ["hicolor", "Papirus", "breeze", "Adwaita"];
const ICON_EXTS = [".svg", ".png"];

/**
 * Finds installed applications from `.desktop` files (system, user and Flatpak), with their icons.
 */
export class DesktopEntries {
  private constructor() { }

  private static _cache: { at: number; entries: DesktopEntry[] } | null = null;
  private static _iconCache = new Map<string, string | null>();

  /**
   * Installed apps that should show up in a launcher, sorted by name. Cached for a minute.
   */
  public static async list(): Promise<DesktopEntry[]> {
    if (DesktopEntries._cache && Date.now() - DesktopEntries._cache.at < 60_000) return DesktopEntries._cache.entries;

    const seen = new Set<string>();
    const entries: DesktopEntry[] = [];
    // Earlier folders take precedence, so a user's override hides the system file
    for (const dir of DesktopEntries.applicationDirs()) {
      const files = await fsp.readdir(dir).catch(() => [] as string[]);
      for (const file of files) {
        if (!file.endsWith(".desktop") || seen.has(file)) continue;
        seen.add(file);
        const entry = await DesktopEntries.parse(Path.join(dir, file), file).catch(() => null);
        if (entry) entries.push(entry);
      }
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    DesktopEntries._cache = { at: Date.now(), entries };
    return entries;
  }

  /**
   * Strip the field codes (`%U`, `%f`…) from a `.desktop` Exec line.
   */
  public static cleanExec(exec: string): string {
    return exec
      .replace(/\s*%[fFuUdDnNickvm]/g, "")
      .replace(/%%/g, "%")
      .trim();
  }

  /**
   * Resolve an icon name from a `.desktop` file to an image path.
   */
  public static async resolveIcon(icon: string | undefined): Promise<string | null> {
    if (!icon) return null;
    if (Path.isAbsolute(icon)) return await exists(icon) ? icon : null;
    if (DesktopEntries._iconCache.has(icon)) return DesktopEntries._iconCache.get(icon)!;

    let found: string | null = null;
    search: for (const base of DesktopEntries.iconDirs()) {
      for (const theme of ICON_THEMES) {
        for (const size of ICON_SIZES) {
          for (const ext of ICON_EXTS) {
            const path = Path.join(base, theme, size, "apps", icon + ext);
            if (await exists(path)) {
              found = path;
              break search;
            }
          }
        }
      }
    }
    if (!found) {
      for (const ext of ICON_EXTS) {
        const path = Path.join("/usr/share/pixmaps", icon + ext);
        if (await exists(path)) {
          found = path;
          break;
        }
      }
    }
    DesktopEntries._iconCache.set(icon, found);
    return found;
  }

  private static async parse(path: string, id: string): Promise<DesktopEntry | null> {
    const content = await fsp.readFile(path, "utf8");
    const fields: Record<string, string> = {};
    let inMain = false;
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (line.startsWith("[")) {
        inMain = line === "[Desktop Entry]";
        continue;
      }
      if (!inMain || !line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      // Keep unlocalised keys only
      if (key.includes("[")) continue;
      fields[key] = line.slice(eq + 1).trim();
    }
    if (fields.Type !== "Application" || !fields.Exec || !fields.Name) return null;
    if (fields.NoDisplay === "true" || fields.Hidden === "true" || fields.Terminal === "true") return null;

    return {
      id,
      path,
      name: fields.Name,
      command: DesktopEntries.cleanExec(fields.Exec),
      icon: await DesktopEntries.resolveIcon(fields.Icon),
      comment: fields.Comment ?? null,
    };
  }

  private static dataDirs(): string[] {
    const home = os.homedir();
    const dataHome = process.env.XDG_DATA_HOME || Path.join(home, ".local/share");
    const dataDirs = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
    return [
      dataHome,
      Path.join(home, ".local/share/flatpak/exports/share"),
      "/var/lib/flatpak/exports/share",
      ...dataDirs,
    ];
  }

  private static applicationDirs() {
    return [...new Set(DesktopEntries.dataDirs().map(dir => Path.join(dir, "applications")))];
  }

  private static iconDirs() {
    return [Path.join(os.homedir(), ".icons"), ...new Set(DesktopEntries.dataDirs().map(dir => Path.join(dir, "icons")))];
  }
}

function exists(path: string) {
  return fsp.stat(path).then(() => true).catch(() => false);
}

export default DesktopEntries;
