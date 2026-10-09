import { ipcMain } from "electron";
import Hub from "./Hub";
import Library from "./Library";
import Settings from "./Settings";
import SystemService from "./SystemService";
import DesktopEntries from "./DesktopEntries";
import type { HubAppInput, HubSettings, PowerAction } from "../shared/types";

/**
 * Register the handlers behind `window.mediahub` (see `preload.ts`).
 */
export function registerIpc() {
  ipcMain.handle("state:get", () => Hub.getState());

  // Apps
  ipcMain.handle("app:launch", (_e, appId: number) => Hub.launch(appId));
  ipcMain.handle("app:focus", (_e, appId: number) => Hub.focus(appId));
  ipcMain.handle("app:close", (_e, appId: number) => Hub.close(appId));
  ipcMain.handle("hub:home", () => Hub.goHome());
  ipcMain.handle("hub:quick-menu", (_e, open: boolean) => Hub.setQuickMenu(open));
  ipcMain.handle("hub:quick-menu-toggle", () => Hub.toggleQuickMenu());

  // Library
  ipcMain.handle("library:add", (_e, app: HubAppInput) => Hub.addApp(app));
  ipcMain.handle("library:update", (_e, appId: number, patch: Partial<HubAppInput>) => Library.update(appId, patch));
  ipcMain.handle("library:remove", (_e, appId: number) => Hub.removeApp(appId));
  ipcMain.handle("library:move", (_e, appId: number, index: number) => Library.move(appId, index));
  ipcMain.handle("library:desktop-entries", () => DesktopEntries.list());

  // System
  ipcMain.handle("system:volume", (_e, volume: number) => Hub.setVolume(volume));
  ipcMain.handle("system:mute", () => Hub.toggleMute());
  ipcMain.handle("system:sinks", () => SystemService.listSinks());
  ipcMain.handle("system:default-sink", async (_e, id: number) => {
    await SystemService.setDefaultSink(id);
    await Hub.changeVolume(0);
  });
  ipcMain.handle("system:network", () => SystemService.getNetworkInfo());
  ipcMain.handle("system:power", (_e, action: PowerAction) => Hub.power(action));
  ipcMain.handle("settings:update", (_e, patch: Partial<HubSettings>) => {
    const { uiSounds, clock24h, externalBrowser } = patch;
    Settings.update(Object.fromEntries(Object.entries({ uiSounds, clock24h, externalBrowser }).filter(([, v]) => v !== undefined)));
  });
  ipcMain.handle("companion:forget", () => Hub.companion?.forgetDevices());
}
