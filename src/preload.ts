import { contextBridge, ipcRenderer } from "electron";
import type { HubState, MediaHubApi } from "./shared/types";

/**
 * Call a main-process handler, turning Electron's wrapped error message back into the original sentence.
 */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    const message = (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
    throw new Error(message);
  }
}

const view = new URLSearchParams(location.search).get("view") === "overlay" ? "overlay" : "home";

const api: MediaHubApi = {
  view,
  getState: () => invoke("state:get"),
  onState: (listener) => {
    const handler = (_event: unknown, state: HubState) => listener(state);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.off("state", handler);
  },
  onToast: (listener) => {
    const handler = (_event: unknown, toast: { message: string; type: "info" | "error" }) => listener(toast);
    ipcRenderer.on("toast", handler);
    return () => ipcRenderer.off("toast", handler);
  },

  // Apps
  launch: (appId) => invoke("app:launch", appId),
  focus: (appId) => invoke("app:focus", appId),
  close: (appId) => invoke("app:close", appId),
  goHome: () => invoke("hub:home"),
  setQuickMenu: (open) => invoke("hub:quick-menu", open),
  toggleQuickMenu: () => invoke("hub:quick-menu-toggle"),

  // Library
  addApp: (app) => invoke("library:add", app),
  updateApp: (appId, patch) => invoke("library:update", appId, patch),
  removeApp: (appId) => invoke("library:remove", appId),
  moveApp: (appId, index) => invoke("library:move", appId, index),
  listDesktopEntries: () => invoke("library:desktop-entries"),

  // System
  setVolume: (volume) => invoke("system:volume", volume),
  toggleMute: () => invoke("system:mute"),
  listAudioSinks: () => invoke("system:sinks"),
  setDefaultSink: (id) => invoke("system:default-sink", id),
  getNetworkInfo: () => invoke("system:network"),
  power: (action) => invoke("system:power", action),
  updateSettings: (patch) => invoke("settings:update", patch),
  forgetPairedDevices: () => invoke("companion:forget"),
};

contextBridge.exposeInMainWorld("mediahub", api);
