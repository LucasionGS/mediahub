import { execFile } from "node:child_process";
import EventEmitter from "node:events";
import x11 from "x11";
import { HUB_APP_ID } from "../shared/types";

const CARDINAL = 6;
const PROPERTY_CHANGE_MASK = 0x00400000;
const PROPERTY_NOTIFY = 28;
const MAX_OPACITY = 0xffffffff;

const ATOM_NAMES = [
  "GAMESCOPE_XWAYLAND_SERVER_ID",
  "GAMESCOPECTRL_BASELAYER_APPID",
  "GAMESCOPECTRL_BASELAYER_WINDOW",
  "GAMESCOPE_FOCUSABLE_WINDOWS",
  "GAMESCOPE_FOCUSED_APP",
  "GAMESCOPE_FOCUSED_APP_GFX",
  "STEAM_GAME",
  "STEAM_OVERLAY",
  "STEAM_INPUT_FOCUS",
  "_NET_WM_WINDOW_OPACITY",
] as const;
type AtomName = typeof ATOM_NAMES[number];

/**
 * Talks to gamescope through the X11 properties it watches on its primary Xwayland (`:0`).  
 * The hub sets `GAMESCOPECTRL_BASELAYER_APPID` to choose which app is shown, and watches
 * `GAMESCOPE_FOCUSABLE_WINDOWS` / `GAMESCOPE_FOCUSED_APP_GFX` to follow what gamescope is doing.
 *
 * Outside gamescope (development on a normal desktop) every call is a no-op and `isAvailable()` is false.
 */
export class Gamescope extends EventEmitter {
  private _client: x11.XClient | null = null;
  private _root = 0;
  private _atoms = {} as Record<AtomName, number>;
  private _focusableWindows: Gamescope.FocusableWindow[] = [];
  private _focusedApp: number | null = null;

  /**
   * Connect to gamescope. Resolves to `false` when not running inside gamescope.
   */
  public async init(): Promise<boolean> {
    if (process.env.MEDIAHUB_STANDALONE === "1") return false;
    const display = process.env.DISPLAY;
    if (!display) return false;

    try {
      const { client, root } = await Gamescope.connect(display);
      // Only gamescope's Xwayland servers have this atom
      const serverIdAtom = await Gamescope.internAtom(client, "GAMESCOPE_XWAYLAND_SERVER_ID", true);
      if (!serverIdAtom) {
        client.terminate();
        return false;
      }
      this._client = client;
      this._root = root;
      for (const name of ATOM_NAMES) {
        this._atoms[name] = await Gamescope.internAtom(client, name, false);
      }
    } catch (error) {
      console.warn(`Not running inside gamescope (${(error as Error).message}). Starting in standalone mode.`);
      return false;
    }

    this._client!.on("error", error => console.error("X11 error on gamescope display:", error));
    this._client!.ChangeWindowAttributes(this._root, { eventMask: PROPERTY_CHANGE_MASK });
    this._client!.on("event", event => {
      if (event.type !== PROPERTY_NOTIFY || event.wid !== this._root) return;
      if (event.atom === this._atoms.GAMESCOPE_FOCUSABLE_WINDOWS) this.refreshFocusableWindows();
      else if (event.atom === this._atoms.GAMESCOPE_FOCUSED_APP_GFX) this.refreshFocusedApp();
    });

    // Gamescope 3.16.3+ needs the control atoms set from the start. 769 last, always, or gamescope shows black.
    this.setFocusOrder([]);
    await this.refreshFocusableWindows();
    await this.refreshFocusedApp();
    return true;
  }

  /**
   * Whether the hub is running inside gamescope.
   */
  public isAvailable() {
    return this._client !== null;
  }

  /**
   * The display launched apps should use. Gamescope exposes its second Xwayland as `STEAM_GAME_DISPLAY_0`.
   */
  public static getAppDisplay(): string | undefined {
    return process.env.STEAM_GAME_DISPLAY_0 || process.env.DISPLAY;
  }

  /**
   * Windows gamescope can focus, across all its Xwayland servers.
   */
  public get focusableWindows() {
    return this._focusableWindows;
  }

  /**
   * Appid of the app gamescope is showing, or `null` when unknown.
   */
  public get focusedApp() {
    return this._focusedApp;
  }

  /**
   * Tell gamescope which apps to show, in priority order. The hub (769) is always appended last, so
   * gamescope falls back to it rather than a black screen.
   * @param appIds Appids, most wanted first. An empty list shows the hub.
   */
  public setFocusOrder(appIds: number[]) {
    if (!this._client) return;
    const list = [...appIds.filter(id => id !== HUB_APP_ID), HUB_APP_ID];
    this._client.ChangeProperty(0, this._root, this._atoms.GAMESCOPECTRL_BASELAYER_APPID, CARDINAL, 32, list);
  }

  /**
   * Mark one of the hub's own windows (on `:0`) with an appid.
   * @param windowId X11 window id, from `BrowserWindow.getNativeWindowHandle()`.
   */
  public setHubWindowAppId(windowId: number, appId = HUB_APP_ID) {
    if (!this._client) return;
    this._client.ChangeProperty(0, windowId, this._atoms.STEAM_GAME, CARDINAL, 32, [appId]);
  }

  /**
   * Turn a hub window into gamescope's overlay layer, drawn above the focused app.
   */
  public makeOverlay(windowId: number) {
    if (!this._client) return;
    this._client.ChangeProperty(0, windowId, this._atoms.STEAM_OVERLAY, CARDINAL, 32, [1]);
    this.setOverlayVisible(windowId, false);
  }

  /**
   * Show or hide the overlay window. While visible it gets keyboard and mouse input.
   */
  public setOverlayVisible(windowId: number, visible: boolean) {
    if (!this._client) return;
    this._client.ChangeProperty(0, windowId, this._atoms.STEAM_INPUT_FOCUS, CARDINAL, 32, [visible ? 1 : 0]);
    this._client.ChangeProperty(0, windowId, this._atoms._NET_WM_WINDOW_OPACITY, CARDINAL, 32, [visible ? MAX_OPACITY : 0]);
  }

  /**
   * Run a `gamescopectl` command against this gamescope, like `ctl("drm_sleep_external_screen", "1")`. Does nothing
   * outside gamescope.
   * @throws When `gamescopectl` is missing or fails.
   */
  public ctl(...args: string[]): Promise<void> {
    if (!this._client) return Promise.resolve();
    return new Promise((resolve, reject) => {
      execFile("gamescopectl", args, { timeout: 5000 }, error => error ? reject(error) : resolve());
    });
  }

  private async refreshFocusableWindows() {
    const data = await this.getCardinals(this._atoms.GAMESCOPE_FOCUSABLE_WINDOWS);
    // Example: [window, appid, pid, window, appid, pid, ...]
    const windows: Gamescope.FocusableWindow[] = [];
    for (let i = 0; i + 2 < data.length; i += 3) {
      windows.push({ windowId: data[i], appId: data[i + 1], pid: data[i + 2] });
    }
    this._focusableWindows = windows;
    this.emit("windows", windows);
  }

  private async refreshFocusedApp() {
    const [appId] = await this.getCardinals(this._atoms.GAMESCOPE_FOCUSED_APP_GFX);
    this._focusedApp = appId ?? null;
    this.emit("focus", this._focusedApp);
  }

  private getCardinals(atom: number): Promise<number[]> {
    return new Promise(resolve => {
      if (!this._client) return resolve([]);
      this._client.GetProperty(0, this._root, atom, CARDINAL, 0, 4096, (error, prop) => {
        if (error || !prop?.data) return resolve([]);
        const values: number[] = [];
        for (let i = 0; i + 3 < prop.data.length; i += 4) values.push(prop.data.readUInt32LE(i));
        resolve(values);
      });
    });
  }

  private static connect(display: string): Promise<{ client: x11.XClient; root: number }> {
    return new Promise((resolve, reject) => {
      const client = x11.createClient({ display }, (error, xDisplay) => {
        if (error) return reject(error);
        resolve({ client: xDisplay.client, root: xDisplay.screen[0].root });
      });
      client.on("error", reject);
    });
  }

  private static internAtom(client: x11.XClient, name: string, onlyIfExists: boolean): Promise<number> {
    return new Promise((resolve, reject) => {
      client.InternAtom(onlyIfExists, name, (error, atom) => error ? reject(error) : resolve(atom));
    });
  }
}

export namespace Gamescope {
  export interface FocusableWindow {
    windowId: number;
    appId: number;
    pid: number;
  }
}

export interface Gamescope {
  // Focusable windows changed
  emit(event: "windows", windows: Gamescope.FocusableWindow[]): boolean;
  on(event: "windows", listener: (windows: Gamescope.FocusableWindow[]) => void): this;
  once(event: "windows", listener: (windows: Gamescope.FocusableWindow[]) => void): this;
  off(event: "windows", listener: (windows: Gamescope.FocusableWindow[]) => void): this;

  // Shown app changed
  emit(event: "focus", appId: number | null): boolean;
  on(event: "focus", listener: (appId: number | null) => void): this;
  once(event: "focus", listener: (appId: number | null) => void): this;
  off(event: "focus", listener: (appId: number | null) => void): this;
}

export default Gamescope;
