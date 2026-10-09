import { spawn, type ChildProcess } from "node:child_process";
import EventEmitter from "node:events";
import fs from "node:fs";
import Path from "node:path";
import readline from "node:readline";
import { app } from "electron";
import type { RemoteKey } from "../shared/types";

const GUIDE_HOLD_MS = 600;
const RESTART_DELAY_MS = 3000;

/**
 * Runs the `mediahub-input` helper, which reports controller Guide button presses and drives the virtual
 * "MediaHub Remote" mouse and keyboard.
 * A Guide tap emits `guide-tap` (toggle the quick menu) and a hold emits `guide-hold` (go home), like a PS5.
 * Shift+Escape on any keyboard counts as a Guide tap.
 */
export class InputService extends EventEmitter {
  private _child: ChildProcess | null = null;
  private _holdTimer: NodeJS.Timeout | null = null;
  private _held = false;
  private _stopped = false;

  /**
   * Whether the helper is running.
   */
  public helper = false;
  /**
   * Whether the virtual mouse and keyboard were created.
   */
  public remote = false;
  /**
   * Names of connected controllers.
   */
  public controllers: string[] = [];

  /**
   * Path to the helper binary: next to the asar when packaged, or the Go build output in development.
   */
  public static getHelperPath() {
    if (process.env.MEDIAHUB_INPUT_HELPER) return process.env.MEDIAHUB_INPUT_HELPER;
    return app.isPackaged
      ? Path.join(process.resourcesPath, "mediahub-input")
      : Path.join(app.getAppPath(), "native/input/bin/mediahub-input");
  }

  /**
   * Start the helper, restarting it if it crashes.
   */
  public start() {
    const path = InputService.getHelperPath();
    if (!fs.existsSync(path)) {
      console.warn(`Input helper not found at ${path}. Run "npm run build:input". The Guide button and phone remote won't work.`);
      return;
    }
    this._stopped = false;
    const child = spawn(path, [], { stdio: ["pipe", "pipe", "inherit"] });
    this._child = child;
    this.helper = true;

    readline.createInterface({ input: child.stdout! }).on("line", line => {
      try {
        this.onEvent(JSON.parse(line));
      } catch (error) {
        console.error("Bad line from input helper:", line, error);
      }
    });
    child.on("error", error => console.error("Input helper failed:", error));
    child.on("exit", code => {
      this._child = null;
      this.helper = false;
      this.remote = false;
      this.emit("change");
      if (this._stopped) return;
      console.error(`Input helper exited with code ${code}. Restarting in ${RESTART_DELAY_MS / 1000}s.`);
      setTimeout(() => this.start(), RESTART_DELAY_MS);
    });
  }

  /**
   * Stop the helper. Its virtual devices are removed when it exits.
   */
  public stop() {
    this._stopped = true;
    this._child?.stdin?.end();
    this._child?.kill();
  }

  /**
   * Move the remote pointer.
   */
  public move(dx: number, dy: number) {
    this.send({ cmd: "move", dx: Math.round(dx), dy: Math.round(dy) });
  }

  /**
   * Scroll by wheel detents. Positive `dy` scrolls up.
   */
  public scroll(dx: number, dy: number) {
    this.send({ cmd: "scroll", dx: Math.round(dx), dy: Math.round(dy) });
  }

  public button(button: "left" | "right" | "middle", state: "down" | "up" | "click") {
    this.send({ cmd: "button", button, state });
  }

  public key(key: RemoteKey, state: "down" | "up" | "tap" = "tap") {
    this.send({ cmd: "key", key, state });
  }

  /**
   * Type text through the virtual keyboard (US layout).
   */
  public text(text: string) {
    this.send({ cmd: "text", text });
  }

  private send(command: Record<string, unknown>) {
    if (!this._child?.stdin?.writable) return;
    this._child.stdin.write(JSON.stringify(command) + "\n");
  }

  private onEvent(event: InputService.HelperEvent) {
    switch (event.event) {
      case "guide":
        if (event.state === "down") this.onGuideDown();
        else this.onGuideUp();
        break;
      case "shortcut":
        if (event.name === "quick-menu") this.emit("guide-tap");
        break;
      case "controllers":
        this.controllers = event.names ?? [];
        this.emit("change");
        break;
      case "remote":
        this.remote = event.available;
        if (!event.available) console.warn(`Phone remote mouse/keyboard unavailable: ${event.message}`);
        this.emit("change");
        break;
      case "error":
        console.warn(`Input helper: ${event.message}`);
        break;
    }
  }

  private onGuideDown() {
    if (this._holdTimer) return; // Two controllers, or a repeated down
    this._held = false;
    this._holdTimer = setTimeout(() => {
      this._held = true;
      this.emit("guide-hold");
    }, GUIDE_HOLD_MS);
  }

  private onGuideUp() {
    if (!this._holdTimer) return;
    clearTimeout(this._holdTimer);
    this._holdTimer = null;
    if (!this._held) this.emit("guide-tap");
  }
}

export namespace InputService {
  export type HelperEvent =
    | { event: "guide"; state: "down" | "up"; device: string }
    | { event: "shortcut"; name: "quick-menu"; device: string }
    | { event: "controllers"; names: string[] | null }
    | { event: "remote"; available: boolean; message?: string }
    | { event: "ready"; version: string }
    | { event: "error"; message: string };
}

export interface InputService {
  // Guide button tapped, or Shift+Escape pressed
  emit(event: "guide-tap"): boolean;
  on(event: "guide-tap", listener: () => void): this;
  once(event: "guide-tap", listener: () => void): this;
  off(event: "guide-tap", listener: () => void): this;

  // Guide button held
  emit(event: "guide-hold"): boolean;
  on(event: "guide-hold", listener: () => void): this;
  once(event: "guide-hold", listener: () => void): this;
  off(event: "guide-hold", listener: () => void): this;

  // Helper status or controllers changed
  emit(event: "change"): boolean;
  on(event: "change", listener: () => void): this;
  once(event: "change", listener: () => void): this;
  off(event: "change", listener: () => void): this;
}

export default InputService;
