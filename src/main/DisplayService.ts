import fs from "node:fs";
import fsp from "node:fs/promises";
import EventEmitter from "node:events";
import Edid from "./Edid";
import type { DisplayConfig, DisplayInfo, DisplayMode, DisplayOutput } from "../shared/types";

const DRM_DIR = "/sys/class/drm";
const TRIAL_MS = 20000;

/**
 * The TV's output, resolution, refresh rate, VRR and HDR. Gamescope can't change these while it runs, so they're
 * written to the session config and the session starts gamescope again with them.
 *
 * New settings are tried out first: the session marks them as on trial when it starts gamescope with them, and unless
 * the hub confirms them within `TRIAL_MS` (someone pressed Keep, so the picture works), the hub or the session puts
 * the previous ones back.
 */
export class DisplayService {
  private constructor() { }

  public static readonly events = new EventEmitter(); // "change" when a trial ends, "revert" when the hub has to restart

  /**
   * The session config, set by the session script. Unset when the hub runs outside it, or under an older session
   * script that only reads the config at boot.
   */
  public static readonly SESSION_CONF = process.env.MEDIAHUB_SESSION_CONF || null;

  private static _trialDeadline: number | null = null;
  private static _trialTimer: NodeJS.Timeout | null = null;

  /**
   * Start the countdown when this start is trying out new display settings. Call once at startup.
   */
  public static init() {
    if (DisplayService.readTrial() !== "trying") return;
    DisplayService._trialDeadline = Date.now() + TRIAL_MS;
    DisplayService._trialTimer = setTimeout(() => DisplayService.keep(false), TRIAL_MS);
  }

  /**
   * When display settings on trial switch back unless kept (epoch ms), or `null`.
   */
  public static get trialDeadline() {
    return DisplayService._trialDeadline;
  }

  /**
   * Connected displays and what they support, and the current settings.
   */
  public static async getInfo(): Promise<DisplayInfo> {
    const conf = DisplayService.SESSION_CONF;
    const values = conf ? parseConf(await fsp.readFile(conf, "utf8").catch(() => "")) : {};
    const int = (value: string | undefined) => {
      const number = parseInt(value ?? "");
      return isNaN(number) ? null : number;
    };
    const width = int(values.MEDIAHUB_WIDTH);
    const height = int(values.MEDIAHUB_HEIGHT);
    return {
      supported: conf !== null,
      message: conf ? null : (process.env.STEAM_GAME_DISPLAY_0
        ? "Restart the TV box once to change the display settings here."
        : "Display settings apply to the TV session, which isn't running."),
      outputs: await DisplayService.listOutputs(),
      config: {
        output: values.MEDIAHUB_OUTPUT || null,
        width: width && height ? width : null,
        height: width && height ? height : null,
        refresh: int(values.MEDIAHUB_REFRESH),
        vrr: values.MEDIAHUB_VRR === "yes",
        hdr: values.MEDIAHUB_HDR === "yes",
      },
    };
  }

  /**
   * Save new display settings and put them on trial. The hub has to restart for them to take effect.
   * @throws When the settings can't be applied, or aren't valid.
   */
  public static async apply(config: DisplayConfig) {
    const conf = DisplayService.SESSION_CONF;
    if (!conf) throw new Error((await DisplayService.getInfo()).message ?? "Display settings can't be changed here.");
    if (DisplayService._trialDeadline) throw new Error("Keep or undo the last display change first.");
    validate(config);

    const current = await fsp.readFile(conf, "utf8").catch(() => "");
    await fsp.writeFile(`${conf}.previous`, current);
    const next = setConfValues(current, {
      MEDIAHUB_OUTPUT: config.output ?? "",
      MEDIAHUB_WIDTH: config.width && config.height ? String(config.width) : "",
      MEDIAHUB_HEIGHT: config.width && config.height ? String(config.height) : "",
      MEDIAHUB_REFRESH: config.refresh ? String(config.refresh) : "",
      MEDIAHUB_VRR: config.vrr ? "yes" : "no",
      MEDIAHUB_HDR: config.hdr ? "yes" : "no",
    });
    await fsp.writeFile(`${conf}.partial`, next);
    await fsp.rename(`${conf}.partial`, conf);
    // The session switches this to "trying" when it starts gamescope with the new settings
    await fsp.writeFile(`${conf}.trial`, "pending\n");
  }

  /**
   * Keep the display settings on trial, or put the previous ones back. Going back emits `revert`, after which the
   * hub has to restart.
   */
  public static async keep(keep: boolean) {
    const conf = DisplayService.SESSION_CONF;
    if (DisplayService._trialTimer) clearTimeout(DisplayService._trialTimer);
    DisplayService._trialTimer = null;
    DisplayService._trialDeadline = null;
    DisplayService.events.emit("change");
    if (!conf) return;

    if (!keep) {
      await fsp.rename(`${conf}.previous`, conf).catch(() => undefined);
    }
    await fsp.rm(`${conf}.trial`, { force: true });
    await fsp.rm(`${conf}.previous`, { force: true });
    if (!keep) DisplayService.events.emit("revert");
  }

  /**
   * Connected displays, with the modes their EDID lists.
   */
  private static async listOutputs(): Promise<DisplayOutput[]> {
    const entries = await fsp.readdir(DRM_DIR).catch(() => [] as string[]);
    const outputs: DisplayOutput[] = [];
    for (const entry of entries) {
      // Example: card1-HDMI-A-1
      const match = /^card\d+-(.+)$/.exec(entry);
      if (!match) continue;
      const dir = `${DRM_DIR}/${entry}`;
      const status = await fsp.readFile(`${dir}/status`, "utf8").catch(() => "");
      if (status.trim() !== "connected") continue;

      const edid = Edid.parse(await fsp.readFile(`${dir}/edid`).catch(() => Buffer.alloc(0)));
      // The kernel's list, with the preferred mode first. Example: 3840x2160
      const names = (await fsp.readFile(`${dir}/modes`, "utf8").catch(() => "")).split("\n").filter(name => /^\d+x\d+$/.test(name));
      const modes: DisplayMode[] = [];
      for (const name of new Set(names)) {
        const [width, height] = name.split("x").map(Number);
        const rates = new Set((edid?.modes ?? []).filter(mode => mode.width === width && mode.height === height).map(mode => mode.refresh));
        modes.push({ width, height, refreshRates: [...rates].sort((a, b) => b - a) });
      }
      outputs.push({ name: match[1], label: edid?.name ?? null, modes, hdr: edid ? edid.hdr : null });
    }
    return outputs.sort((a, b) => a.name.localeCompare(b.name));
  }

  private static readTrial() {
    const conf = DisplayService.SESSION_CONF;
    if (!conf) return null;
    try {
      return fs.readFileSync(`${conf}.trial`, "utf8").trim();
    } catch {
      return null;
    }
  }
}

/**
 * Check display settings before they end up in a shell script.
 * @throws When a value is out of range or could break the config file.
 */
function validate(config: DisplayConfig) {
  if (config.output !== null && !/^[A-Za-z0-9-]{1,32}$/.test(config.output)) throw new Error(`"${config.output}" isn't a display output.`);
  const size = (value: number | null) => value === null || (Number.isInteger(value) && value >= 320 && value <= 15360);
  if (!size(config.width) || !size(config.height) || (config.width === null) !== (config.height === null)) {
    throw new Error(`${config.width}x${config.height} isn't a resolution.`);
  }
  if (config.refresh !== null && !(Number.isInteger(config.refresh) && config.refresh >= 20 && config.refresh <= 600)) {
    throw new Error(`${config.refresh} Hz isn't a refresh rate.`);
  }
  if (typeof config.vrr !== "boolean" || typeof config.hdr !== "boolean") throw new Error("VRR and HDR must be on or off.");
}

/**
 * The `KEY="value"` lines of the session config.
 */
function parseConf(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    // Example:
    // MEDIAHUB_OUTPUT="HDMI-A-1" # Connector like HDMI-A-1, empty = let gamescope pick
    const match = /^\s*([A-Z_][A-Z0-9_]*)="([^"]*)"/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

/**
 * Replace values in the session config, keeping its comments and everything else. Missing keys are added at the end.
 */
function setConfValues(text: string, values: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(values)) {
    const line = new RegExp(`^(\\s*${key}=)"[^"]*"`, "m");
    if (line.test(result)) result = result.replace(line, `$1"${value}"`);
    else result += `${result === "" || result.endsWith("\n") ? "" : "\n"}${key}="${value}"\n`;
  }
  return result;
}

export default DisplayService;
