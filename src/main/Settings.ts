import fs from "node:fs";
import EventEmitter from "node:events";
import Paths from "./Paths";
import type { HubSettings } from "../shared/types";

export interface ISettings extends HubSettings {
  companionTokens: string[]; // Tokens handed out to paired phones
}

const DEFAULT_SETTINGS: ISettings = {
  uiSounds: true,
  clock24h: true,
  externalBrowser: null,
  companionPort: 8420,
  updateBranch: "master",
  uiScale: 1,
  companionTokens: [],
};

/**
 * App-wide settings, stored in `settings.json`.
 */
export class Settings {
  private constructor() { }

  public static data: ISettings = { ...DEFAULT_SETTINGS };
  public static readonly events = new EventEmitter();

  /**
   * Load settings from disk, falling back to defaults for anything missing.
   */
  public static load() {
    try {
      const stored = JSON.parse(fs.readFileSync(Paths.SETTINGS_FILE, "utf8"));
      Settings.data = { ...DEFAULT_SETTINGS, ...stored };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error("Failed to read settings.json, using defaults.", error);
      }
      Settings.data = { ...DEFAULT_SETTINGS };
    }
    const envPort = parseInt(process.env.MEDIAHUB_COMPANION_PORT ?? "");
    if (!isNaN(envPort)) Settings.data.companionPort = envPort;
  }

  public static get<K extends keyof ISettings>(key: K): ISettings[K] {
    return Settings.data[key];
  }

  public static set<K extends keyof ISettings>(key: K, value: ISettings[K]) {
    Settings.data[key] = value;
    Settings.save();
  }

  /**
   * Merge `patch` into the settings and save.
   */
  public static update(patch: Partial<ISettings>) {
    Object.assign(Settings.data, patch);
    Settings.save();
  }

  /**
   * The settings that are safe to show in the UI (no tokens).
   */
  public static toPublic(): HubSettings {
    const { uiSounds, clock24h, externalBrowser, companionPort, updateBranch, uiScale } = Settings.data;
    return { uiSounds, clock24h, externalBrowser, companionPort, updateBranch, uiScale };
  }

  private static save() {
    fs.writeFileSync(Paths.SETTINGS_FILE, JSON.stringify(Settings.data, null, 2));
    Settings.events.emit("change");
  }
}

export default Settings;
