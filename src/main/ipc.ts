import { ipcMain } from "electron";
import Hub from "./Hub";
import Library from "./Library";
import Settings from "./Settings";
import SystemService from "./SystemService";
import WifiService from "./WifiService";
import BluetoothService from "./BluetoothService";
import DisplayService from "./DisplayService";
import Updater from "./Updater";
import DesktopEntries from "./DesktopEntries";
import type { DisplayConfig, HubAppInput, HubSettings, PowerAction } from "../shared/types";

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
  ipcMain.handle("wifi:status", () => WifiService.getStatus());
  ipcMain.handle("wifi:scan", (_e, rescan: boolean) => WifiService.scan(rescan));
  ipcMain.handle("wifi:connect", (_e, ssid: string, password?: string) => WifiService.connect(ssid, password));
  ipcMain.handle("wifi:forget", (_e, ssid: string) => WifiService.forget(ssid));
  ipcMain.handle("wifi:enabled", (_e, enabled: boolean) => WifiService.setEnabled(enabled));
  ipcMain.handle("bluetooth:status", () => BluetoothService.getStatus());
  ipcMain.handle("bluetooth:powered", (_e, powered: boolean) => BluetoothService.setPowered(powered));
  ipcMain.handle("bluetooth:scanning", (_e, scanning: boolean) => BluetoothService.setScanning(scanning));
  ipcMain.handle("bluetooth:pair", (_e, address: string) => BluetoothService.pair(address));
  ipcMain.handle("bluetooth:answer", (_e, accept: boolean) => BluetoothService.answerPairing(accept));
  ipcMain.handle("bluetooth:connect", (_e, address: string) => BluetoothService.connect(address));
  ipcMain.handle("bluetooth:disconnect", (_e, address: string) => BluetoothService.disconnect(address));
  ipcMain.handle("bluetooth:forget", (_e, address: string) => BluetoothService.forget(address));
  ipcMain.handle("display:info", () => DisplayService.getInfo());
  ipcMain.handle("display:apply", async (_e, config: DisplayConfig) => {
    await DisplayService.apply(config);
    await Hub.power("restart-hub");
  });
  ipcMain.handle("display:keep", (_e, keep: boolean) => DisplayService.keep(keep));
  ipcMain.handle("system:power", (_e, action: PowerAction) => Hub.power(action));
  ipcMain.handle("update:check", () => Updater.check());
  ipcMain.handle("update:install", () => Updater.install());
  ipcMain.handle("update:branch", (_e, branch: string) => Updater.setBranch(branch));
  ipcMain.handle("settings:update", (_e, patch: Partial<HubSettings>) => {
    const { uiSounds, clock24h, externalBrowser, uiScale } = patch;
    if (uiScale !== undefined && !(typeof uiScale === "number" && uiScale >= 0.5 && uiScale <= 2)) throw new Error(`${uiScale} isn't a menu size.`);
    Settings.update(Object.fromEntries(Object.entries({ uiSounds, clock24h, externalBrowser, uiScale }).filter(([, v]) => v !== undefined)));
  });
  ipcMain.handle("companion:forget", () => Hub.companion?.forgetDevices());
}
