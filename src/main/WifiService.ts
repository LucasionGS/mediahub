import fsp from "node:fs/promises";
import { execFile } from "node:child_process";
import type { WifiConnectResult, WifiNetwork, WifiStatus } from "../shared/types";

const CONNECT_TIMEOUT_S = 30;

interface SavedNetwork {
  uuid: string;
  ssid: string;
}

/**
 * Wi-Fi through NetworkManager's `nmcli`: scanning, joining, forgetting and the radio switch.
 * Machines without a Wi-Fi adapter report `device: null`, and the hub hides Wi-Fi entirely.
 */
export class WifiService {
  private constructor() { }

  /**
   * Whether there's a Wi-Fi adapter, whether NetworkManager manages it, and which network it's on.
   */
  public static async getStatus(): Promise<WifiStatus> {
    const status: WifiStatus = { device: null, managed: false, enabled: false, connected: null };
    let output: string;
    try {
      // Example:
      // wlan0:wifi:connected:Home WiFi
      output = await nmcli(["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"]);
    } catch {
      // NetworkManager isn't installed or running. The adapter can still be there, it just can't be managed.
      status.device = await WifiService.findAdapter();
      return status;
    }

    const wifi = output.trim().split("\n").map(splitTerse).find(([, type]) => type === "wifi");
    if (!wifi) {
      status.device = await WifiService.findAdapter();
      return status;
    }
    const [device, , state] = wifi;
    status.device = device;
    status.managed = state !== "unmanaged";
    status.enabled = (await nmcli(["radio", "wifi"]).catch(() => "")).trim() === "enabled";
    if (state.startsWith("connected")) {
      const active = (await WifiService.scan(false)).find(network => network.active);
      status.connected = active?.ssid ?? null;
    }
    return status;
  }

  /**
   * Networks in range, strongest first, one entry per name. Hidden networks are left out.
   * @param rescan Ask the adapter for a fresh scan, which takes a few seconds. Otherwise NetworkManager's last results are used.
   */
  public static async scan(rescan: boolean): Promise<WifiNetwork[]> {
    // Example:
    // *:82:WPA2:Home WiFi
    //  :40:WPA1 WPA2 802.1X:Office
    const args = ["-t", "-f", "IN-USE,SIGNAL,SECURITY,SSID", "device", "wifi", "list", "--rescan", rescan ? "yes" : "no"];
    // A rescan right after another one is refused, so fall back to the cached results
    const output = await nmcli(args, 20000).catch(() => nmcli(args.with(-1, "no")));
    const saved = new Set((await WifiService.listSaved()).map(network => network.ssid));

    const networks = new Map<string, WifiNetwork>();
    for (const line of output.split("\n")) {
      const [inUse, signal, security, ssid] = splitTerse(line);
      if (!ssid) continue;
      const network: WifiNetwork = {
        ssid,
        signal: parseInt(signal) || 0,
        secure: security !== "" && security !== "--",
        enterprise: security.includes("802.1X"),
        saved: saved.has(ssid),
        active: inUse === "*",
      };
      // The same network shows up once per access point. Keep the one in use, or else the strongest.
      const existing = networks.get(ssid);
      if (!existing || (network.active && !existing.active) || (network.active === existing.active && network.signal > existing.signal)) {
        networks.set(ssid, network);
      }
    }
    return [...networks.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.signal - a.signal);
  }

  /**
   * Join a network. Without a password, a saved network connects with its stored password and an open network just
   * connects. A password replaces whatever was stored.
   */
  public static async connect(ssid: string, password?: string): Promise<WifiConnectResult> {
    const { device } = await WifiService.getStatus();
    if (!device) return { success: false, needsPassword: false, message: "This machine has no Wi-Fi adapter." };
    const savedBefore = await WifiService.listSaved();
    const saved = savedBefore.find(network => network.ssid === ssid);

    try {
      if (saved) {
        if (password !== undefined) await nmcli(["connection", "modify", "uuid", saved.uuid, "wifi-sec.psk", password]);
        await nmcli(["--wait", String(CONNECT_TIMEOUT_S), "connection", "up", "uuid", saved.uuid, "ifname", device], (CONNECT_TIMEOUT_S + 10) * 1000);
      }
      else {
        const args = ["--wait", String(CONNECT_TIMEOUT_S), "device", "wifi", "connect", ssid, "ifname", device];
        if (password !== undefined) args.push("password", password);
        await nmcli(args, (CONNECT_TIMEOUT_S + 10) * 1000);
      }
      return { success: true };
    } catch (error) {
      // A failed first attempt can leave a half-made profile behind, which would then count as "saved"
      const known = new Set(savedBefore.map(network => network.uuid));
      for (const network of await WifiService.listSaved()) {
        if (network.ssid === ssid && !known.has(network.uuid)) await nmcli(["connection", "delete", "uuid", network.uuid]).catch(() => undefined);
      }
      return WifiService.describeFailure(ssid, (error as Error).message);
    }
  }

  /**
   * Forget a network, so it no longer connects on its own.
   */
  public static async forget(ssid: string) {
    for (const network of await WifiService.listSaved()) {
      if (network.ssid === ssid) await nmcli(["connection", "delete", "uuid", network.uuid]);
    }
  }

  /**
   * Turn the Wi-Fi radio on or off.
   */
  public static async setEnabled(enabled: boolean) {
    await nmcli(["radio", "wifi", enabled ? "on" : "off"]);
  }

  /**
   * Wi-Fi profiles NetworkManager has stored. Their names usually match the SSID, but not always, so the SSID is read
   * from each profile.
   */
  private static async listSaved(): Promise<SavedNetwork[]> {
    let output: string;
    try {
      // Example:
      // 6cedb4d3-e223-4a51-b5b6-ca4be18e4d8c:802-11-wireless
      output = await nmcli(["-t", "-f", "UUID,TYPE", "connection", "show"]);
    } catch {
      return [];
    }
    const uuids = output.trim().split("\n").map(splitTerse).filter(([, type]) => type === "802-11-wireless").map(([uuid]) => uuid);
    const networks = await Promise.all(uuids.map(async uuid => {
      const ssid = await nmcli(["-g", "802-11-wireless.ssid", "connection", "show", "uuid", uuid]).catch(() => null);
      return ssid === null ? null : { uuid, ssid: splitTerse(ssid.trim()).join(":") };
    }));
    return networks.filter(network => network !== null);
  }

  /**
   * First Wi-Fi interface the kernel knows about, found without NetworkManager.
   */
  private static async findAdapter(): Promise<string | null> {
    const interfaces = await fsp.readdir("/sys/class/net").catch(() => []);
    for (const name of interfaces) {
      if (await fsp.stat(`/sys/class/net/${name}/wireless`).then(() => true).catch(() => false)) return name;
    }
    return null;
  }

  /**
   * Turn nmcli's error output into a sentence for the TV.
   */
  private static describeFailure(ssid: string, error: string): WifiConnectResult {
    // Examples:
    // Error: Connection activation failed: Secrets were required, but not provided.
    // Error: 802-11-wireless-security.psk: property is invalid.
    if (/Secrets were required|psk: property is invalid/i.test(error)) {
      return { success: false, needsPassword: true, message: `The password for ${ssid} didn't work. Check it and try again.` };
    }
    if (/No network with SSID/i.test(error)) {
      return { success: false, needsPassword: false, message: `${ssid} is out of range. Move closer or search again.` };
    }
    if (/not authorized|Insufficient privileges/i.test(error)) {
      return { success: false, needsPassword: false, message: "MediaHub isn't allowed to change Wi-Fi settings. Run setup.sh again to allow it." };
    }
    if (/timeout|timed out/i.test(error)) {
      return { success: false, needsPassword: false, message: `${ssid} didn't answer in time. Try again.` };
    }
    return { success: false, needsPassword: false, message: `Couldn't connect to ${ssid}: ${error.replace(/^Error:\s*/, "").trim()}` };
  }
}

/**
 * Run `nmcli` and resolve to its output. Errors carry only nmcli's own message, never the command line, which can
 * hold a Wi-Fi password.
 */
function nmcli(args: string[], timeout = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("nmcli", args, { timeout }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      const killed = (error as { killed?: boolean }).killed;
      reject(new Error(killed ? "nmcli timed out." : (stderr.trim() || "nmcli failed.")));
    });
  });
}

/**
 * Split a line of `nmcli -t` output into fields. nmcli escapes `:` and `\` inside values with a backslash.
 */
function splitTerse(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "\\" && i + 1 < line.length) {
      current += line[++i];
    }
    else if (char === ":") {
      fields.push(current);
      current = "";
    }
    else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

export default WifiService;
