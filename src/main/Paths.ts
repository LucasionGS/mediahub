import os from "node:os";
import Path from "node:path";
import fs from "node:fs";

/**
 * Data folders used by the hub. Everything lives under `MEDIAHUB_DATA`, or `~/.mediahub` when unset.
 */
export class Paths {
  private constructor() { }

  /**
   * Root data folder.
   */
  public static readonly DATA = process.env.MEDIAHUB_DATA || Path.join(os.homedir(), ".mediahub");
  public static readonly APPS_FILE = Path.join(Paths.DATA, "apps.json");
  public static readonly SETTINGS_FILE = Path.join(Paths.DATA, "settings.json");
  public static readonly ARTWORK = Path.join(Paths.DATA, "artwork");
  public static readonly PROFILES = Path.join(Paths.DATA, "profiles");
  public static readonly HUB_PROFILE = Path.join(Paths.DATA, "hub-profile");
  public static readonly LOGS = Path.join(Paths.DATA, "logs");

  /**
   * Create every data folder that doesn't exist yet. Called once at startup.
   */
  public static init() {
    for (const dir of [Paths.DATA, Paths.ARTWORK, Paths.PROFILES, Paths.HUB_PROFILE, Paths.LOGS]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Artwork folder for one app.
   */
  public static artworkFor(appId: number) {
    return Path.join(Paths.ARTWORK, String(appId));
  }

  /**
   * Browser profile folder for one web app, so each keeps its own logins.
   */
  public static profileFor(appId: number) {
    return Path.join(Paths.PROFILES, String(appId));
  }

  /**
   * Folders the hub and companion are allowed to serve images from.
   */
  public static assetRoots(): string[] {
    const home = os.homedir();
    const dataDirs = (process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":").filter(Boolean);
    return [
      Paths.ARTWORK,
      Path.join(home, ".local/share/icons"),
      Path.join(home, ".icons"),
      Path.join(home, ".local/share/flatpak/exports/share/icons"),
      "/var/lib/flatpak/exports/share/icons",
      "/usr/share/pixmaps",
      ...dataDirs.map(dir => Path.join(dir, "icons")),
    ];
  }

  /**
   * Check whether `path` is inside one of the asset roots.
   */
  public static isAllowedAsset(path: string) {
    const resolved = Path.resolve(path);
    return Paths.assetRoots().some(root => resolved.startsWith(Path.resolve(root) + Path.sep));
  }
}

export default Paths;
