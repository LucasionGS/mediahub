import { spawn, execFile, type ChildProcess } from "node:child_process";
import EventEmitter from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import Path from "node:path";
import { app as electronApp } from "electron";
import Gamescope from "./Gamescope";
import InputService from "./InputService";
import Paths from "./Paths";
import Settings from "./Settings";
import type { HubApp, RunningApp } from "../shared/types";

/**
 * Environment that makes toolkits use X11, which is the only way an app takes part in gamescope's focus handling.
 */
const X11_ENV: Record<string, string> = {
  GDK_BACKEND: "x11",
  QT_QPA_PLATFORM: "xcb",
  SDL_VIDEODRIVER: "x11",
  MOZ_ENABLE_WAYLAND: "0",
  ELECTRON_OZONE_PLATFORM_HINT: "x11",
};

/**
 * Environment variables from the hub's own Electron process that must not leak into launched apps.
 */
const STRIPPED_ENV = ["WAYLAND_DISPLAY", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE", "CHROME_DESKTOP", "GOOGLE_API_KEY", "NODE_OPTIONS"];

/**
 * Chromium opens most of its files without close-on-exec, so every app spawned from the hub would inherit the hub's
 * cache files, sockets and locks (which breaks other Chromium/Electron apps outright). This closes every fd above
 * stderr, then runs the real command.
 */
const CLOSE_FDS_SCRIPT = `for fd in $(ls /proc/$$/fd); do [ "$fd" -gt 2 ] && [ -e "/proc/$$/fd/$fd" ] && eval "exec $fd>&-"; done; exec "$@"`;

/**
 * How long a closing app gets to quit by itself before it's killed.
 */
const CLOSE_GRACE_MS = 5000;

const EXTERNAL_BROWSERS = ["chromium", "google-chrome-stable", "google-chrome", "brave", "brave-browser", "vivaldi-stable"];

/**
 * Chromium-based browsers, by executable name and Flatpak app id. Added as desktop apps, they open as a normal window
 * that gamescope never maximises, so they're started fullscreen instead.
 */
const CHROMIUM_BROWSERS = new Set([
  ...EXTERNAL_BROWSERS,
  "chromium-browser", "chrome", "brave-browser-stable", "vivaldi", "microsoft-edge", "microsoft-edge-stable", "thorium-browser",
  "org.chromium.Chromium", "com.google.Chrome", "com.brave.Browser", "com.vivaldi.Vivaldi", "com.microsoft.Edge",
  "io.github.ungoogled_software.ungoogled_chromium",
]);

/**
 * Launches apps so gamescope can tell their windows apart: under a `reaper SteamLaunch AppId=<ID>` parent like Steam
 * does, inside their own systemd scope (`app-steam-app<ID>-<n>.scope`, read by gamescope 3.16.26+ and used to stop
 * the whole app). Keeps track of what's running.
 */
export class AppLauncher extends EventEmitter {
  private _running = new Map<number, AppLauncher.Process>();
  private _mru: number[] = []; // Most recently focused first
  private _instance = 0;
  private _hasSystemdRun: boolean | null = null;

  constructor(
    /** Used to switch focus and fix up window appids. */
    private readonly gamescope: Gamescope,
  ) {
    super();
    gamescope.on("windows", windows => this.onWindows(windows));
  }

  /**
   * Running apps, most recently focused first.
   */
  public list(): RunningApp[] {
    return this._mru.map(id => this._running.get(id)).filter((p): p is AppLauncher.Process => !!p).map(p => p.info);
  }

  public isRunning(appId: number) {
    return this._running.has(appId);
  }

  /**
   * Start an app, or bring it forward when it's already running.
   */
  public async launch(app: HubApp) {
    if (this._running.has(app.appId)) return this.focus(app.appId);

    // The reaper tags the app with its appid the way Steam does, which every gamescope version understands
    const reaper = await AppLauncher.ensureReaper();
    const tagged = reaper ? [reaper, "SteamLaunch", `AppId=${app.appId}`, "--"] : [];
    const argv = ["bash", "-c", CLOSE_FDS_SCRIPT, "mediahub-launch", ...tagged, ...await this.buildCommand(app)];
    const instance = ++this._instance;
    const unit = (await this.hasSystemdRun()) ? `app-steam-app${app.appId}-${instance}` : null;
    const fullArgv = unit
      // systemd-run expands $VAR in the command line itself; "$$" is its escape for a literal "$"
      ? ["systemd-run", "--user", "--scope", "--collect", "--quiet", `--unit=${unit}`, "--", ...argv.map(arg => arg.replaceAll("$", "$$$$"))]
      : argv;

    console.log(`Launching ${app.name} (${app.appId}): ${argv.slice(4 + tagged.length).join(" ")}`);
    // Each launch overwrites the app's log, so it always holds the latest run
    const log = fs.openSync(Path.join(Paths.LOGS, `${app.appId}.log`), "w");
    let child: ChildProcess;
    try {
      child = spawn(fullArgv[0], fullArgv.slice(1), {
        env: this.buildEnv(app),
        stdio: ["ignore", log, log],
        detached: true,
      });
    } catch (error) {
      throw new Error(`Failed to start ${app.name}: ${(error as Error).message}`);
    } finally {
      fs.closeSync(log);
    }
    child.unref();

    const proc: AppLauncher.Process = {
      child,
      info: { appId: app.appId, app, unit, pid: child.pid ?? null, startedAt: Date.now(), hasWindow: false },
      stopping: false,
    };
    this._running.set(app.appId, proc);
    child.once("error", error => {
      console.error(`Failed to start ${app.name}:`, error);
      this.markExited(app.appId, `Failed to start ${app.name}: ${error.message}`);
    });
    child.once("exit", () => this.onChildExit(app.appId));
    this.focus(app.appId);
    this.emit("change");
  }

  /**
   * Bring a running app to the front.
   */
  public focus(appId: number) {
    if (!this._running.has(appId)) return;
    this._mru = [appId, ...this._mru.filter(id => id !== appId)];
    this.gamescope.setFocusOrder(this._mru);
    this.emit("change");
  }

  /**
   * Show the hub, keeping apps running in the background.
   */
  public goHome() {
    this.gamescope.setFocusOrder([]);
  }

  /**
   * Stop a running app and everything it started. The app is asked to quit first (SIGTERM to the reaper, which passes
   * it on), so browsers can save their session; whatever is left after `CLOSE_GRACE_MS` is killed.
   */
  public async close(appId: number) {
    const proc = this._running.get(appId);
    if (!proc) return;
    proc.stopping = true;

    if (proc.info.pid && proc.child.exitCode === null) {
      try {
        process.kill(proc.info.pid, "SIGTERM");
      } catch {
        // Already gone
      }
      await waitForExit(proc.child, CLOSE_GRACE_MS);
    }

    if (proc.info.unit) {
      // Clean up anything that outlived the app, or the app itself if it ignored SIGTERM
      await run("systemctl", ["--user", "stop", `${proc.info.unit}.scope`]).catch(error => {
        console.error(`Failed to stop ${proc.info.unit}:`, error);
      });
    }
    else if (proc.info.pid) {
      try {
        process.kill(-proc.info.pid, "SIGKILL");
      } catch {
        // Nothing left in the process group
      }
    }
    this.markExited(appId);
  }

  /**
   * Stop every running app. Used when the hub quits.
   */
  public async closeAll() {
    await Promise.all([...this._running.keys()].map(id => this.close(id)));
  }

  private async buildCommand(app: HubApp): Promise<string[]> {
    if (app.type === "desktop") {
      let command = app.command ?? "";
      if (this.gamescope.isAvailable() && isChromiumCommand(command) && !/--(kiosk|start-fullscreen|app=)/.test(command)) {
        command += " --start-fullscreen";
      }
      // Desktop Exec lines are shell-style, so let sh handle quoting. `exec` keeps the pid the app's own.
      return ["sh", "-c", `exec ${command}`];
    }
    if (app.browser === "external") {
      const browser = Settings.get("externalBrowser") ?? await findExternalBrowser();
      if (!browser) {
        throw new Error(`${app.name} needs Chromium or Google Chrome, which doesn't seem to be installed. Install one, or set the browser in Settings.`);
      }
      return [browser, "--kiosk", `--app=${app.url}`, `--user-data-dir=${Paths.profileFor(app.appId)}`, "--no-first-run", "--ozone-platform=x11"];
    }
    // Built-in web runner: this same binary in --webapp mode
    const self = electronApp.isPackaged ? [process.execPath] : [process.execPath, electronApp.getAppPath()];
    const config = Buffer.from(JSON.stringify(app)).toString("base64url");
    return [...self, `--webapp=${config}`, "--ozone-platform=x11"];
  }

  private buildEnv(app: HubApp): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, ...X11_ENV, ...app.env };
    for (const key of STRIPPED_ENV) delete env[key];
    const display = Gamescope.getAppDisplay();
    if (display) env.DISPLAY = display;
    env.MEDIAHUB_APP_ID = String(app.appId);
    return env;
  }

  /**
   * Path to the `reaper` symlink (to the input helper, which acts as gamescope's reaper when started under that name),
   * creating it when needed. `null` when the helper isn't built.
   */
  private static async ensureReaper(): Promise<string | null> {
    const helper = InputService.getHelperPath();
    if (!fs.existsSync(helper)) return null;
    const link = Path.join(Paths.DATA, "bin", "reaper");
    const current = await fsp.readlink(link).catch(() => null);
    if (current !== helper) {
      await fsp.mkdir(Path.dirname(link), { recursive: true });
      await fsp.rm(link, { force: true });
      await fsp.symlink(helper, link);
    }
    return link;
  }

  private async hasSystemdRun() {
    // Escape hatch for machines without a systemd user session; the reaper alone still tags apps for gamescope
    if (process.env.MEDIAHUB_NO_SCOPE === "1") return false;
    this._hasSystemdRun ??= await run("systemctl", ["--user", "is-system-running"]).then(() => true).catch((error: RunError) => {
      // "degraded" still exits non-zero but systemd is usable
      return error.stdout?.trim() === "degraded";
    });
    return this._hasSystemdRun;
  }

  /**
   * The direct child exited. Apps like Firefox fork and exit, so with a scope we wait until the scope itself is gone.
   */
  private onChildExit(appId: number) {
    const proc = this._running.get(appId);
    if (!proc || proc.stopping) return;
    if (!proc.info.unit) return this.markExited(appId);

    const poll = async () => {
      if (this._running.get(appId) !== proc) return;
      const active = await run("systemctl", ["--user", "is-active", `${proc.info.unit}.scope`]).then(() => true).catch(() => false);
      if (active) setTimeout(poll, 2000);
      else this.markExited(appId);
    };
    poll();
  }

  private markExited(appId: number, error?: string) {
    const proc = this._running.get(appId);
    if (!proc) return;
    const wasFront = this._mru[0] === appId;
    this._running.delete(appId);
    this._mru = this._mru.filter(id => id !== appId);
    // Like a console: when the app in front closes, go home instead of to another app
    if (wasFront) this.gamescope.setFocusOrder([]);
    else this.gamescope.setFocusOrder(this._mru);
    console.log(`${proc.info.app.name} (${appId}) exited.`);
    this.emit("exit", proc.info.app, error);
    this.emit("change");
  }

  private onWindows(windows: Gamescope.FocusableWindow[]) {
    let changed = false;
    for (const proc of this._running.values()) {
      const hasWindow = windows.some(w => w.appId === proc.info.appId);
      if (hasWindow !== proc.info.hasWindow) {
        proc.info.hasWindow = hasWindow;
        changed = true;
      }
    }

    if (changed) this.emit("change");
  }
}

export namespace AppLauncher {
  export interface Process {
    child: ChildProcess;
    info: RunningApp;
    stopping: boolean;
  }
}

export interface AppLauncher {
  // Running apps changed
  emit(event: "change"): boolean;
  on(event: "change", listener: () => void): this;
  once(event: "change", listener: () => void): this;
  off(event: "change", listener: () => void): this;

  // App exited (error is set when it failed to start)
  emit(event: "exit", app: HubApp, error?: string): boolean;
  on(event: "exit", listener: (app: HubApp, error?: string) => void): this;
  once(event: "exit", listener: (app: HubApp, error?: string) => void): this;
  off(event: "exit", listener: (app: HubApp, error?: string) => void): this;
}

interface RunError extends Error {
  stdout?: string;
}

/**
 * Run a command and resolve with its stdout. Rejects on a non-zero exit, with `stdout` attached.
 */
export function run(command: string, args: string[], timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error, stdout) => {
      if (error) {
        (error as RunError).stdout = stdout;
        return reject(error);
      }
      resolve(stdout);
    });
  });
}

/**
 * Resolve when `child` exits, or after `timeout` ms.
 */
function waitForExit(child: ChildProcess, timeout: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(resolve, timeout);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Whether a desktop Exec line starts a Chromium-based browser, directly, through `env` or as a Flatpak.
 */
function isChromiumCommand(command: string): boolean {
  // Examples:
  // /usr/bin/chromium
  // env GTK_USE_PORTAL=1 brave-browser-stable
  // /usr/bin/flatpak run --branch=stable --arch=x86_64 --command=chromium org.chromium.Chromium
  const words = command.trim().split(/\s+/).filter(word => word !== "env" && !/^\w+=/.test(word));
  if (Path.basename(words[0] ?? "") === "flatpak") {
    return words.slice(2).some(word => !word.startsWith("-") && CHROMIUM_BROWSERS.has(word));
  }
  return CHROMIUM_BROWSERS.has(Path.basename(words[0] ?? ""));
}

async function findExternalBrowser(): Promise<string | null> {
  for (const browser of EXTERNAL_BROWSERS) {
    const found = await run("which", [browser]).then(() => true).catch(() => false);
    if (found) return browser;
  }
  return null;
}

export default AppLauncher;
