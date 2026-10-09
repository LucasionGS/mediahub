import os from "node:os";
import { run } from "./AppLauncher";
import type { AudioSink, NetworkInfo, PowerAction, VolumeInfo } from "../shared/types";

const DEFAULT_SINK = "@DEFAULT_AUDIO_SINK@";

/**
 * Volume, audio output, power and network status, through `wpctl`, `systemctl`, `nmcli` and `bluetoothctl`.
 */
export class SystemService {
  private constructor() { }

  /**
   * Volume of the default PipeWire sink.
   */
  public static async getVolume(): Promise<VolumeInfo> {
    try {
      // Example:
      // Volume: 0.45 [MUTED]
      const output = await run("wpctl", ["get-volume", DEFAULT_SINK]);
      const match = /Volume:\s*([\d.]+)/.exec(output);
      return { volume: match ? parseFloat(match[1]) : 0, muted: output.includes("[MUTED]") };
    } catch {
      return { volume: 0, muted: false };
    }
  }

  /**
   * Set the volume of the default sink.
   * @param volume From 0 to 1. Values above 1 are clamped.
   */
  public static async setVolume(volume: number) {
    const clamped = Math.max(0, Math.min(1, volume));
    await run("wpctl", ["set-volume", "-l", "1.0", DEFAULT_SINK, clamped.toFixed(2)]);
    if (clamped > 0) await run("wpctl", ["set-mute", DEFAULT_SINK, "0"]);
  }

  /**
   * Change the volume by `delta` (for example `0.05` for 5%).
   */
  public static async changeVolume(delta: number) {
    const { volume } = await SystemService.getVolume();
    await SystemService.setVolume(volume + delta);
  }

  public static async toggleMute() {
    await run("wpctl", ["set-mute", DEFAULT_SINK, "toggle"]);
  }

  /**
   * Audio outputs, from the "Sinks" section of `wpctl status`.
   */
  public static async listSinks(): Promise<AudioSink[]> {
    let output: string;
    try {
      output = await run("wpctl", ["status"]);
    } catch {
      return [];
    }
    const sinks: AudioSink[] = [];
    let inAudio = false;
    let inSinks = false;
    for (const line of output.split("\n")) {
      if (/^\S/.test(line)) inAudio = line.startsWith("Audio");
      if (!inAudio) continue;
      if (/Sinks:/.test(line)) {
        inSinks = true;
        continue;
      }
      if (inSinks && /(Sources|Filters|Streams|Sink endpoints):/.test(line)) break;
      if (!inSinks) continue;
      // Example:
      //  │  *   48. Built-in Audio Analog Stereo      [vol: 0.40]
      const match = /^[\s│├└─]*(\*)?\s*(\d+)\.\s+(.+?)(?:\s+\[vol:.*\])?\s*$/.exec(line);
      if (match) sinks.push({ id: parseInt(match[2]), name: match[3], isDefault: !!match[1] });
    }
    return sinks;
  }

  public static async setDefaultSink(id: number) {
    await run("wpctl", ["set-default", String(id)]);
  }

  /**
   * Power off, restart or suspend the machine. `restart-hub` is handled by the hub itself.
   */
  public static async power(action: Exclude<PowerAction, "restart-hub">) {
    try {
      await run("systemctl", [action]);
    } catch (error) {
      throw new Error(`Could not ${action}: ${(error as Error).message.trim()}. Run setup.sh and allow power actions without a password.`);
    }
  }

  /**
   * IPv4 addresses on the local network.
   */
  public static getLanAddresses(): string[] {
    return Object.values(os.networkInterfaces())
      .flat()
      .filter(addr => addr && addr.family === "IPv4" && !addr.internal)
      .map(addr => addr!.address);
  }

  public static async getNetworkInfo(): Promise<NetworkInfo> {
    const info: NetworkInfo = { hostname: os.hostname(), addresses: SystemService.getLanAddresses(), connections: [], bluetooth: null };
    try {
      // Example:
      // wlan0:wifi:connected:Home WiFi
      const output = await run("nmcli", ["-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"]);
      for (const line of output.trim().split("\n")) {
        const [device, type, state, connection] = line.split(":");
        if (!device || type === "loopback" || type === "bridge" || type === "tun" || state === "unmanaged") continue;
        info.connections.push({ device, type, state, connection: connection ?? "" });
      }
    } catch {
      // NetworkManager not installed
    }
    try {
      const show = await run("bluetoothctl", ["show"], 3000);
      const connected = await run("bluetoothctl", ["devices", "Connected"], 3000).catch(() => "");
      info.bluetooth = {
        powered: /Powered:\s*yes/.test(show),
        // Example:
        // Device AA:BB:CC:DD:EE:FF Xbox Wireless Controller
        connected: connected.trim().split("\n").filter(Boolean).map(line => line.replace(/^Device \S+ /, "")),
      };
    } catch {
      // bluetoothctl not installed or no adapter
    }
    return info;
  }
}

export default SystemService;
