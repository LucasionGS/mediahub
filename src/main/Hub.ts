import EventEmitter from "node:events";
import { app, BrowserWindow } from "electron";
import AppLauncher from "./AppLauncher";
import BluetoothService from "./BluetoothService";
import DisplayService from "./DisplayService";
import Gamescope from "./Gamescope";
import InputService from "./InputService";
import Library, { TV_USER_AGENT } from "./Library";
import Settings from "./Settings";
import SystemService from "./SystemService";
import Updater from "./Updater";
import WebIcons from "./WebIcons";
import type CompanionServer from "./CompanionServer";
import { FIRST_TEMP_APP_ID, HUB_APP_ID, type HubApp, type HubAppInput, type HubState, type PowerAction, type VolumeInfo } from "../shared/types";

const VOLUME_POLL_MS = 3000;

/**
 * The hub's main-process core: owns the services and windows, holds the state the UIs render from, and
 * implements every action (launch, switch, quick menu, power…) so IPC, the companion and the controller all share it.
 */
export class Hub {
  private constructor() { }

  public static readonly events = new EventEmitter();
  public static readonly gamescope = new Gamescope();
  public static readonly launcher = new AppLauncher(Hub.gamescope);
  public static readonly input = new InputService();
  public static companion: CompanionServer | null = null;

  public static homeWindow: BrowserWindow | null = null;
  public static overlayWindow: BrowserWindow | null = null;

  private static _quickMenuOpen = false;
  private static _volume: VolumeInfo = { volume: 0, muted: false };
  private static _nextTempAppId = FIRST_TEMP_APP_ID;
  private static _broadcastQueued = false;

  /**
   * Wire up services. Call once after the windows exist.
   */
  public static async init() {
    Library.events.on("change", () => Hub.broadcast());
    // Catch up on web apps that never got an icon (offline when added, or added by editing apps.json)
    for (const app of Library.list()) WebIcons.fetchFor(app);
    Settings.events.on("change", () => Hub.broadcast());
    Updater.events.on("change", () => Hub.broadcast());
    Updater.events.on("installed", (message: string) => Hub.toast(message));
    Updater.init();
    BluetoothService.events.on("change", () => Hub.broadcast());
    DisplayService.events.on("change", () => Hub.broadcast());
    DisplayService.events.on("revert", () => Hub.power("restart-hub"));
    DisplayService.init();
    DisplayService.watchHotplug(Hub.gamescope);
    Hub.launcher.on("change", () => Hub.broadcast());
    Hub.gamescope.on("focus", () => Hub.broadcast());
    Hub.input.on("change", () => Hub.broadcast());
    Hub.input.on("guide-tap", () => Hub.toggleQuickMenu());
    Hub.input.on("guide-hold", () => Hub.goHome());
    Hub.launcher.on("exit", (_app, error) => {
      if (error) Hub.toast(error, "error");
    });

    Hub.homeWindow?.on("focus", () => Hub.broadcast());
    Hub.homeWindow?.on("blur", () => Hub.broadcast());

    Hub.input.start();
    await Hub.refreshVolume();
    setInterval(() => Hub.refreshVolume(), VOLUME_POLL_MS);
  }

  /**
   * Whether the hub's home screen is what's on the TV.
   */
  public static isHubFocused() {
    if (Hub.gamescope.isAvailable()) {
      const focused = Hub.gamescope.focusedApp;
      return focused === HUB_APP_ID || !focused;
    }
    return Hub.homeWindow?.isFocused() ?? false;
  }

  public static getState(): HubState {
    const focused = Hub.gamescope.isAvailable() ? Hub.gamescope.focusedApp : (Hub.isHubFocused() ? HUB_APP_ID : null);
    return {
      apps: Library.list(),
      running: Hub.launcher.list(),
      focusedAppId: focused,
      hubFocused: Hub.isHubFocused(),
      quickMenuOpen: Hub._quickMenuOpen,
      gamescope: Hub.gamescope.isAvailable(),
      volume: Hub._volume,
      companion: Hub.companion?.getInfo() ?? { url: null, pairingCode: "", pairedDevices: 0 },
      settings: Settings.toPublic(),
      input: { helper: Hub.input.helper, remote: Hub.input.remote, controllers: Hub.input.controllers },
      version: app.getVersion(),
      update: Updater.getState(),
      bluetoothPairing: BluetoothService.pairing,
      displayTrial: DisplayService.trialDeadline,
    };
  }

  /**
   * Push the current state to every window and phone. Batched, so many changes in one tick send once.
   */
  public static broadcast() {
    if (Hub._broadcastQueued) return;
    Hub._broadcastQueued = true;
    setImmediate(() => {
      Hub._broadcastQueued = false;
      const state = Hub.getState();
      for (const window of [Hub.homeWindow, Hub.overlayWindow]) {
        if (window && !window.isDestroyed()) window.webContents.send("state", state);
      }
      Hub.events.emit("state", state);
    });
  }

  /**
   * Show a notification on the TV, in the hub and the overlay.
   */
  public static toast(message: string, type: "info" | "error" = "info") {
    for (const window of [Hub.homeWindow, Hub.overlayWindow]) {
      if (window && !window.isDestroyed()) window.webContents.send("toast", { message, type });
    }
  }

  //#region Apps

  /**
   * Add an app to the library. Web apps get their icon fetched in the background.
   */
  public static addApp(input: HubAppInput): HubApp {
    const app = Library.add(input);
    WebIcons.fetchFor(app);
    return app;
  }

  /**
   * Remove an app from the library, closing it first when it's running.
   */
  public static async removeApp(appId: number) {
    await Hub.close(appId);
    await Library.remove(appId);
  }

  public static async launch(appId: number) {
    const hubApp = Library.get(appId) ?? Hub.launcher.list().find(r => r.appId === appId)?.app;
    if (!hubApp) throw new Error(`App ${appId} not found.`);
    Hub.setQuickMenu(false);
    await Hub.launcher.launch(hubApp);
  }

  public static focus(appId: number) {
    Hub.setQuickMenu(false);
    Hub.launcher.focus(appId);
  }

  public static async close(appId: number) {
    await Hub.launcher.close(appId);
  }

  /**
   * Show the home screen. Running apps keep running.
   */
  public static goHome() {
    Hub.setQuickMenu(false);
    Hub.launcher.goHome();
    if (!Hub.gamescope.isAvailable()) {
      Hub.homeWindow?.show();
      Hub.homeWindow?.focus();
    }
    Hub.broadcast();
  }

  /**
   * Open a link from the phone in a temporary web app. YouTube links open in the YouTube TV interface.
   * @throws When `url` isn't an http(s) address.
   */
  public static async openUrl(rawUrl: string) {
    let url: URL;
    try {
      url = new URL(rawUrl.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      throw new Error(`"${rawUrl}" is not a valid web address. It must start with http:// or https://.`);
    }

    let userAgent: string | null = null;
    let name = url.hostname.replace(/^www\./, "");
    const youtubeId = getYouTubeId(url);
    if (youtubeId) {
      url = new URL(`https://www.youtube.com/tv#/watch?v=${youtubeId}`);
      userAgent = TV_USER_AGENT;
      name = "YouTube";
    }

    const tempApp: HubApp = {
      appId: Hub._nextTempAppId++,
      type: "web",
      name,
      url: url.toString(),
      userAgent,
      browser: "builtin",
      gamepadKeys: true,
      order: -1,
      temporary: true,
    };
    Hub.setQuickMenu(false);
    await Hub.launcher.launch(tempApp);
  }

  //#endregion

  //#region Quick menu

  public static isQuickMenuOpen() {
    return Hub._quickMenuOpen;
  }

  /**
   * Show or hide the quick menu overlay above whatever is on screen.
   */
  public static setQuickMenu(open: boolean) {
    if (open === Hub._quickMenuOpen) return;
    Hub._quickMenuOpen = open;
    const overlay = Hub.overlayWindow;
    if (overlay && !overlay.isDestroyed()) {
      if (Hub.gamescope.isAvailable()) {
        Hub.gamescope.setOverlayVisible(getWindowId(overlay), open);
        if (open) overlay.focus();
      }
      else if (open) {
        overlay.show();
        overlay.focus();
      }
      else {
        overlay.hide();
      }
    }
    Hub.broadcast();
  }

  public static toggleQuickMenu() {
    Hub.setQuickMenu(!Hub._quickMenuOpen);
  }

  //#endregion

  //#region System

  public static get volume() {
    return Hub._volume;
  }

  public static async setVolume(volume: number) {
    await SystemService.setVolume(volume);
    await Hub.refreshVolume();
  }

  public static async changeVolume(delta: number) {
    await SystemService.changeVolume(delta);
    await Hub.refreshVolume();
  }

  public static async toggleMute() {
    await SystemService.toggleMute();
    await Hub.refreshVolume();
  }

  /**
   * Power off, restart, suspend, or restart the hub itself.
   * Restarting the hub quits it; the session script then starts gamescope and the hub again.
   */
  public static async power(action: PowerAction) {
    Hub.setQuickMenu(false);
    if (action === "restart-hub") {
      await Hub.launcher.closeAll();
      if (!Hub.gamescope.isAvailable()) app.relaunch();
      app.exit(0);
      return;
    }
    if (action !== "suspend") await Hub.launcher.closeAll();
    await SystemService.power(action);
  }

  private static async refreshVolume() {
    const volume = await SystemService.getVolume();
    if (volume.volume !== Hub._volume.volume || volume.muted !== Hub._volume.muted) {
      Hub._volume = volume;
      Hub.broadcast();
    }
  }

  //#endregion
}

/**
 * The X11 window id of a BrowserWindow.
 */
export function getWindowId(window: BrowserWindow): number {
  return window.getNativeWindowHandle().readUInt32LE(0);
}

/**
 * The video id of a YouTube watch, share or shorts link, or `null`.
 */
function getYouTubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m)\./, "");
  if (host === "youtu.be") return url.pathname.slice(1) || null;
  if (host !== "youtube.com" && host !== "music.youtube.com") return null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const match = /^\/(shorts|live|embed)\/([\w-]+)/.exec(url.pathname);
  return match?.[2] ?? null;
}

export default Hub;
