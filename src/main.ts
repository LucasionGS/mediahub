import Path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, net, protocol, screen } from "electron";
import Paths from "./main/Paths";
import WebAppWindow from "./main/WebAppWindow";
import Hub, { getWindowId } from "./main/Hub";
import Library from "./main/Library";
import Settings from "./main/Settings";
import CompanionServer from "./main/CompanionServer";
import { registerIpc } from "./main/ipc";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const webApp = WebAppWindow.parseArgs(process.argv);
Paths.init();

if (webApp) {
  WebAppWindow.run(webApp);
}
else {
  runHub();
}

/**
 * Start the hub: home window, quick-menu overlay and all services.
 */
function runHub() {
  // Hub and web apps use separate profiles, so the single-instance lock only covers the hub
  app.setPath("userData", Paths.HUB_PROFILE);
  if (!app.requestSingleInstanceLock()) {
    console.error("MediaHub is already running.");
    app.exit(1);
    return;
  }

  // Gamepad polling and animations must keep running while the hub is behind an app
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  // Inside gamescope Electron must use X11 so its windows can carry gamescope's properties
  if (process.env.GAMESCOPE_WAYLAND_DISPLAY) app.commandLine.appendSwitch("ozone-platform", "x11");

  protocol.registerSchemesAsPrivileged([
    { scheme: "hub-asset", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);

  app.whenReady().then(async () => {
    Settings.load();
    Library.load();

    // hub-asset://file/<encoded absolute path> serves artwork and icons to the renderer
    protocol.handle("hub-asset", async request => {
      const path = decodeURIComponent(new URL(request.url).pathname.slice(1));
      if (!Paths.isAllowedAsset(path)) return new Response("Not found", { status: 404 });
      const file = await net.fetch(pathToFileURL(path).toString());
      // CORS lets the renderer read icon pixels to work out accent colours
      const headers = new Headers(file.headers);
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(file.body, { status: file.status, headers });
    });

    const inGamescope = await Hub.gamescope.init();
    console.log(inGamescope ? "Running inside gamescope." : "Running in standalone mode (no gamescope).");
    const fullscreen = inGamescope || process.argv.includes("--fullscreen") || process.env.MEDIAHUB_FULLSCREEN === "1";

    const preload = Path.join(__dirname, "preload.js");
    // Explicit bounds, since transparent frameless windows ignore `fullscreen` on some window managers
    const bounds = fullscreen ? screen.getPrimaryDisplay().bounds : { x: undefined, y: undefined, width: 1600, height: 900 };
    const home = new BrowserWindow({
      title: "MediaHub",
      ...bounds,
      fullscreen,
      frame: !fullscreen,
      autoHideMenuBar: true,
      backgroundColor: "#05070d",
      show: false,
      webPreferences: { preload, backgroundThrottling: false },
    });
    const overlay = new BrowserWindow({
      title: "MediaHub Quick Menu",
      ...bounds,
      fullscreen,
      frame: false,
      transparent: true,
      skipTaskbar: true,
      alwaysOnTop: !inGamescope,
      show: false,
      webPreferences: { preload, backgroundThrottling: false },
    });
    Hub.homeWindow = home;
    Hub.overlayWindow = overlay;

    if (inGamescope) {
      // Mark both windows before they map, so gamescope sees the hub as appid 769 from the first frame
      Hub.gamescope.setHubWindowAppId(getWindowId(home));
      Hub.gamescope.setHubWindowAppId(getWindowId(overlay));
      Hub.gamescope.makeOverlay(getWindowId(overlay));
    }

    loadView(home, "home");
    loadView(overlay, "overlay");
    home.once("ready-to-show", () => home.show());
    // In gamescope the overlay stays mapped and is shown/hidden through its opacity
    if (inGamescope) overlay.once("ready-to-show", () => overlay.showInactive());

    home.on("closed", () => app.quit());

    registerIpc();
    Hub.companion = new CompanionServer(Settings.get("companionPort"));
    await Hub.companion.start();
    await Hub.init();
    Hub.broadcast();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => Hub.input.stop());
}

function loadView(window: BrowserWindow, view: "home" | "overlay") {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}/index.html?view=${view}`);
  }
  else {
    window.loadFile(Path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), { query: { view } });
  }
}
