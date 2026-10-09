import Path from "node:path";
import { app, BrowserWindow, ipcMain, session } from "electron";
import Paths from "./Paths";
import type { HubApp } from "../shared/types";

/**
 * Keys a controller can send to a web app, mapped by the web-app preload.
 */
const ALLOWED_KEYS = new Set(["Up", "Down", "Left", "Right", "Enter", "Escape", "Backspace", "MediaPlayPause"]);

/**
 * Runs MediaHub in web-app mode (`mediahub --webapp=<config>`): one fullscreen window showing a web app, in its own
 * process and systemd scope so gamescope treats it as a separate app.
 */
export class WebAppWindow {
  private constructor() { }

  /**
   * Parse the `--webapp=` argument, or `null` when not running as a web app.
   */
  public static parseArgs(argv: string[]): HubApp | null {
    const arg = argv.find(a => a.startsWith("--webapp="));
    if (!arg) return null;
    try {
      return JSON.parse(Buffer.from(arg.slice("--webapp=".length), "base64url").toString("utf8"));
    } catch {
      console.error("Invalid --webapp argument.");
      app.exit(2);
      return null;
    }
  }

  /**
   * Start the web-app runner. Must be called before `app.whenReady()`, since it changes the profile folder.
   */
  public static run(hubApp: HubApp) {
    // Each web app keeps its own logins. Temporary links share one throwaway profile.
    const profile = hubApp.temporary ? Path.join(Paths.PROFILES, "temporary") : Paths.profileFor(hubApp.appId);
    app.setPath("userData", profile);
    app.setName(hubApp.name);

    app.whenReady().then(() => {
      if (hubApp.userAgent) session.defaultSession.setUserAgent(hubApp.userAgent);

      const window = new BrowserWindow({
        title: hubApp.name,
        fullscreen: true,
        frame: false,
        autoHideMenuBar: true,
        backgroundColor: "#000000",
        webPreferences: {
          preload: Path.join(__dirname, "webappPreload.js"),
          contextIsolation: true,
          sandbox: false,
        },
      });

      // Keep everything in this one fullscreen window instead of opening popups
      window.webContents.setWindowOpenHandler(({ url }) => {
        window.loadURL(url);
        return { action: "deny" };
      });

      ipcMain.on("webapp:key", (event, keyCode: string) => {
        if (hubApp.gamepadKeys === false || !ALLOWED_KEYS.has(keyCode)) return;
        // sendInputEvent produces trusted key events, which TV-style web UIs require
        window.webContents.sendInputEvent({ type: "keyDown", keyCode });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode });
      });

      window.loadURL(hubApp.url!);
      window.on("closed", () => app.quit());
    });
    app.on("window-all-closed", () => app.quit());
  }
}

export default WebAppWindow;
