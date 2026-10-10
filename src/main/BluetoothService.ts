import EventEmitter from "node:events";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { BluetoothDevice, BluetoothDeviceKind, BluetoothPairing, BluetoothResult, BluetoothStatus } from "../shared/types";

const SCAN_KEEPALIVE_MS = 30000; // Scanning stops this long after the settings page last asked for it
const SCAN_TIMEOUT_S = 40;
const PAIR_TIMEOUT_MS = 60000;
const CONNECT_TIMEOUT_MS = 20000;
const AGENT_WAIT_MS = 3000;
const ADDRESS = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i;

interface Pairing {
  state: BluetoothPairing;
  child: ChildProcessWithoutNullStreams;
  canceled: boolean;
}

/**
 * Bluetooth through BlueZ's `bluetoothctl`: the power switch, finding devices, pairing, connecting and forgetting them.
 * Machines without an adapter, or without BlueZ running, report `available: false`.
 */
export class BluetoothService {
  private constructor() { }

  public static readonly events = new EventEmitter();

  private static _scan: ReturnType<typeof spawn> | null = null;
  private static _scanUntil = 0;
  private static _pairing: Pairing | null = null;
  private static _kinds = new Map<string, BluetoothDeviceKind>(); // Device type by address, which never changes

  /**
   * The pairing in progress, or `null`.
   */
  public static get pairing(): BluetoothPairing | null {
    return BluetoothService._pairing?.state ?? null;
  }

  /**
   * Whether there's an adapter, whether it's on, and the paired and nearby devices.
   */
  public static async getStatus(): Promise<BluetoothStatus> {
    const status: BluetoothStatus = { available: false, powered: false, scanning: false, devices: [] };
    // Example:
    // Controller 00:1A:7D:DA:71:13 (public)
    //   Powered: yes
    const show = await bluetoothctl(["show"], 3000).catch(() => null);
    if (!show?.ok || !/^Controller /m.test(show.output)) return status;
    status.available = true;
    status.powered = /Powered: yes/.test(show.output);
    status.scanning = BluetoothService._scan !== null;

    const [all, paired, connected] = await Promise.all([listDevices(), listDevices("Paired"), listDevices("Connected")]);
    const pairedSet = new Set(paired.map(device => device.address));
    const connectedSet = new Set(connected.map(device => device.address));

    // Paired devices are looked up every time for their battery. Nearby ones only once, for their type.
    let lookups = 0;
    const devices = await Promise.all(all.map(async ({ address, name }) => {
      const isPaired = pairedSet.has(address);
      const device: BluetoothDevice = {
        address,
        name,
        kind: BluetoothService._kinds.get(address) ?? "other",
        paired: isPaired,
        connected: connectedSet.has(address),
        battery: null,
      };
      if (!isPaired && name === address.replace(/:/g, "-")) return null; // Nearby devices that don't say what they are
      if (isPaired || (!BluetoothService._kinds.has(address) && lookups++ < 30)) {
        const info = await bluetoothctl(["info", address], 3000).catch(() => null);
        if (info?.ok) {
          // Example:
          //   Icon: input-gaming
          //   Battery Percentage: 0x5a (90)
          device.kind = kindFromIcon(/Icon: (\S+)/.exec(info.output)?.[1]);
          BluetoothService._kinds.set(address, device.kind);
          const battery = /Battery Percentage: 0x([0-9a-f]+)/i.exec(info.output);
          if (battery) device.battery = parseInt(battery[1], 16);
        }
      }
      return device;
    }));

    status.devices = devices
      .filter(device => device !== null)
      .sort((a, b) =>
        Number(b.paired) - Number(a.paired)
        || Number(b.connected) - Number(a.connected)
        || Number(a.kind === "other") - Number(b.kind === "other") // Devices that say what they are first
        || a.name.localeCompare(b.name));
    return status;
  }

  /**
   * Turn the adapter on or off. Turning it on also lifts a soft rfkill block, when the system allows it.
   */
  public static async setPowered(powered: boolean) {
    let result = await bluetoothctl(["power", powered ? "on" : "off"], 10000);
    if (!result.ok && powered && /Blocked|rfkill/i.test(result.output)) {
      await run("rfkill", ["unblock", "bluetooth"], 5000).catch(() => undefined);
      result = await bluetoothctl(["power", "on"], 10000);
    }
    if (!result.ok) {
      throw new Error(`Couldn't turn Bluetooth ${powered ? "on" : "off"}: ${lastLine(result.output) || "bluetoothctl failed."}`);
    }
    if (!powered) BluetoothService.setScanning(false);
  }

  /**
   * Look for devices to pair while the settings page is open. Call again every few seconds to keep looking, since
   * scanning stops by itself after `SCAN_KEEPALIVE_MS` (it slows down connected controllers and headphones).
   */
  public static setScanning(scanning: boolean) {
    if (!scanning) {
      BluetoothService._scanUntil = 0;
      BluetoothService._scan?.kill();
      return;
    }
    BluetoothService._scanUntil = Date.now() + SCAN_KEEPALIVE_MS;
    BluetoothService.startScan();
  }

  /**
   * Pair with a device, then trust it so it reconnects by itself, and connect to it. Codes to type or confirm show up
   * in `pairing` while it waits for them.
   */
  public static pair(address: string): Promise<BluetoothResult> {
    BluetoothService.checkAddress(address);
    if (BluetoothService._pairing) throw new Error("Already pairing with another device. Wait for it to finish.");

    // Pairing works better without a scan running alongside. It starts again afterwards.
    BluetoothService._scan?.kill();
    const child = spawn("bluetoothctl", ["--agent", "KeyboardDisplay"], { stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => undefined); // Writing after it quit
    const pairing: Pairing = {
      state: { address, name: address, stage: "pairing", passkey: null, confirm: null },
      child,
      canceled: false,
    };
    BluetoothService._pairing = pairing;
    BluetoothService.getName(address).then(name => {
      pairing.state.name = name;
      BluetoothService.events.emit("change");
    });
    BluetoothService.events.emit("change");

    return new Promise<BluetoothResult>(resolve => {
      let buffer = "";
      let started = false;
      let done = false;
      const name = () => pairing.state.name;
      const write = (line: string) => {
        if (child.stdin.writable) child.stdin.write(`${line}\n`);
      };
      const update = (patch: Partial<BluetoothPairing>) => {
        Object.assign(pairing.state, patch);
        BluetoothService.events.emit("change");
      };
      const finish = (result: BluetoothResult) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        clearTimeout(agentWait);
        write("quit");
        child.kill();
        BluetoothService._pairing = null;
        BluetoothService.events.emit("change");
        if (Date.now() < BluetoothService._scanUntil) BluetoothService.startScan();
        resolve(pairing.canceled ? { success: false, canceled: true, message: "Pairing canceled." } : result);
      };
      const start = () => {
        if (started) return;
        started = true;
        write("default-agent");
        write(`pair ${address}`);
      };
      const connect = () => {
        update({ stage: "connecting", passkey: null, confirm: null });
        write(`trust ${address}`);
        write(`connect ${address}`);
      };
      // Controllers often connect by themselves right after pairing and turn down the extra connect
      const connectFailed = async () => {
        await new Promise(r => setTimeout(r, 3000));
        const info = await bluetoothctl(["info", address], 3000).catch(() => null);
        if (info && /Connected: yes/.test(info.output)) finish({ success: true });
        else finish({ success: true, message: `Paired with ${name()}. Turn it on or press a button on it to connect.` });
      };

      // Prompts end without a newline, so the output is searched as it arrives rather than line by line. Each entry
      // handles one message, and the text up to it is dropped, so nothing is handled twice.
      const handlers: [RegExp, (match: RegExpExecArray) => void][] = [
        [/Agent (is already )?registered/, start],
        [/Confirm passkey (\d+)/, match => update({ confirm: match[1].padStart(6, "0") })],
        [/Accept pairing \(yes\/no\)|Authorize service/, () => write("yes")],
        [/Enter PIN code:/, () => write("0000")], // Older devices without a screen use 0000
        [/Enter passkey/, () => finish({ success: false, message: `${name()} wants a code typed in on the TV, which MediaHub can't do yet.` })],
        [/Passkey: (\d+)/, match => update({ passkey: match[1].padStart(6, "0") })],
        [/PIN code: (\w+)/, match => update({ passkey: match[1] })],
        [/Pairing successful/, connect],
        [/Failed to pair: (.+)/, match => {
          if (/AlreadyExists/.test(match[1])) connect();
          else finish({ success: false, message: describeFailure(name(), match[1], true) });
        }],
        [/Device \S+ not available/, () => finish({ success: false, message: `${name()} is out of range. Put it in pairing mode and search again.` })],
        [/Connection successful/, () => finish({ success: true })],
        [/Failed to connect: (.+)/, connectFailed],
        [/Request canceled/, () => finish({ success: false, message: `${name()} canceled the pairing.` })],
      ];
      const handle = () => {
        while (!done) {
          let first: { index: number; end: number; match: RegExpExecArray; handler: (match: RegExpExecArray) => void } | null = null;
          for (const [pattern, handler] of handlers) {
            const match = pattern.exec(buffer);
            if (match && (!first || match.index < first.index)) first = { index: match.index, end: match.index + match[0].length, match, handler };
          }
          if (!first) break;
          buffer = buffer.slice(first.end);
          first.handler(first.match);
        }
        if (buffer.length > 4096) buffer = buffer.slice(-1024);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        buffer += cleanOutput(chunk.toString());
        handle();
      });
      child.stderr.on("data", () => undefined);
      child.on("error", () => finish({ success: false, message: "bluetoothctl isn't installed. Run setup.sh to set up Bluetooth." }));
      child.on("exit", () => finish({ success: false, message: `Pairing with ${name()} stopped unexpectedly. Try again.` }));
      const agentWait = setTimeout(start, AGENT_WAIT_MS); // In case the agent message looks different
      const timeout = setTimeout(() => finish({ success: false, message: `${name()} didn't finish pairing in time. Put it in pairing mode and try again.` }), PAIR_TIMEOUT_MS);
    });
  }

  /**
   * Answer the pairing's "does the device show this code?" question. Saying no, or answering while there's no
   * question, cancels the pairing.
   */
  public static answerPairing(accept: boolean) {
    const pairing = BluetoothService._pairing;
    if (!pairing) return;
    if (pairing.state.confirm && accept) {
      pairing.child.stdin.write("yes\n");
      pairing.state.confirm = null;
      BluetoothService.events.emit("change");
      return;
    }
    pairing.canceled = true;
    if (pairing.state.confirm) pairing.child.stdin.write("no\n");
    pairing.child.kill();
  }

  /**
   * Connect to a paired device.
   */
  public static async connect(address: string): Promise<BluetoothResult> {
    BluetoothService.checkAddress(address);
    const name = await BluetoothService.getName(address);
    const result = await bluetoothctl(["connect", address], CONNECT_TIMEOUT_MS).catch(() => null);
    if (result && /Connection successful/.test(result.output)) return { success: true };
    // Example:
    // Failed to connect: org.bluez.Error.Failed br-connection-page-timeout
    const error = result ? /Failed to connect: (.+)/.exec(result.output)?.[1].trim() : undefined;
    return { success: false, message: error ? describeFailure(name, error) : `${name} didn't answer. Make sure it's on and close by.` };
  }

  /**
   * Disconnect a device. It stays paired.
   */
  public static async disconnect(address: string) {
    BluetoothService.checkAddress(address);
    const result = await bluetoothctl(["disconnect", address], CONNECT_TIMEOUT_MS);
    if (!result.ok) throw new Error(`Couldn't disconnect: ${lastLine(result.output) || "bluetoothctl failed."}`);
  }

  /**
   * Unpair a device, so it has to be paired again to connect.
   */
  public static async forget(address: string) {
    BluetoothService.checkAddress(address);
    const result = await bluetoothctl(["remove", address], 10000);
    if (!result.ok) throw new Error(`Couldn't forget the device: ${lastLine(result.output) || "bluetoothctl failed."}`);
    BluetoothService._kinds.delete(address);
  }

  private static startScan() {
    if (BluetoothService._scan || BluetoothService._pairing) return;
    // Discovery lasts as long as the bluetoothctl that started it
    const scan = spawn("bluetoothctl", ["--timeout", String(SCAN_TIMEOUT_S), "scan", "on"], { stdio: "ignore" });
    BluetoothService._scan = scan;
    const started = Date.now();
    let failed = false;
    scan.on("error", () => failed = true);
    scan.on("close", () => {
      if (BluetoothService._scan === scan) BluetoothService._scan = null;
      // Keep going after the timeout, but not after a failure to start, like with Bluetooth off
      const ranFine = !failed && Date.now() - started > 5000;
      if (ranFine && Date.now() < BluetoothService._scanUntil) BluetoothService.startScan();
    });
  }

  private static async getName(address: string) {
    const info = await bluetoothctl(["info", address], 3000).catch(() => null);
    return (info && /Alias: (.+)/.exec(info.output)?.[1].trim()) || address;
  }

  private static checkAddress(address: string) {
    if (!ADDRESS.test(address)) throw new Error(`"${address}" isn't a Bluetooth address. It looks like AA:BB:CC:DD:EE:FF.`);
  }
}

/**
 * Devices bluetoothctl knows, optionally only those with a property like `Paired` or `Connected`.
 */
async function listDevices(filter?: string): Promise<{ address: string; name: string }[]> {
  const result = await bluetoothctl(filter ? ["devices", filter] : ["devices"], 3000).catch(() => null);
  if (!result?.ok) return [];
  const devices: { address: string; name: string }[] = [];
  for (const line of result.output.split("\n")) {
    // Example:
    // Device AA:BB:CC:DD:EE:FF Xbox Wireless Controller
    const match = /^Device (\S+) (.*)$/.exec(line.trim());
    if (match && ADDRESS.test(match[1])) devices.push({ address: match[1], name: match[2].trim() || match[1] });
  }
  return devices;
}

/**
 * BlueZ's device icon name, like `input-gaming`, as a device type.
 */
function kindFromIcon(icon: string | undefined): BluetoothDeviceKind {
  switch (icon) {
    case "input-gaming": return "controller";
    case "audio-headset":
    case "audio-headphones": return "headphones";
    case "audio-card":
    case "audio-speakers": return "speaker";
    case "input-keyboard": return "keyboard";
    case "input-mouse":
    case "input-tablet": return "mouse";
    case "phone": return "phone";
    case "computer": return "computer";
    case "video-display": return "tv";
    default: return "other";
  }
}

/**
 * Turn a BlueZ error, like `org.bluez.Error.AuthenticationFailed` or `org.bluez.Error.Failed br-connection-page-timeout`,
 * into a sentence for the TV.
 */
function describeFailure(name: string, error: string, pairing = false): string {
  if (/profile-unavailable/.test(error)) return `${name} has no sound support on this machine. Run setup.sh to set up Bluetooth audio.`;
  if (/Authentication(Failed|Rejected|Canceled)/.test(error)) return `${name} turned down the pairing. Put it in pairing mode and try again.`;
  if (/ConnectionAttemptFailed|AuthenticationTimeout|page-timeout|Host is down|NotAvailable|DoesNotExist/i.test(error)) {
    return `${name} didn't answer. Make sure it's on${pairing ? ", in pairing mode" : ""} and close by.`;
  }
  if (/InProgress|busy/i.test(error)) return `${name} is busy. Wait a moment and try again.`;
  if (/NotReady/.test(error)) return "Bluetooth is off. Turn it on and try again.";
  return `Something went wrong with ${name} (${error.replace(/^org\.bluez\.Error\./, "").trim()}). Try again.`;
}

/**
 * bluetoothctl output without colours, readline markers and prompts.
 */
function cleanOutput(text: string) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/[\x01\x02\r]/g, "");
}

function lastLine(text: string) {
  return cleanOutput(text).trim().split("\n").pop()?.trim() ?? "";
}

/**
 * Run bluetoothctl with a command. Resolves with its output either way, and rejects only when it can't run or hangs,
 * like when bluetoothd isn't running.
 */
function bluetoothctl(args: string[], timeout: number) {
  return run("bluetoothctl", args, timeout).then(result => ({ ...result, output: cleanOutput(result.output) }));
}

function run(command: string, args: string[], timeout: number): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`;
      if (!error) return resolve({ ok: true, output });
      if ((error as { killed?: boolean }).killed) return reject(new Error(`${command} timed out.`));
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return reject(new Error(`${command} isn't installed.`));
      resolve({ ok: false, output });
    });
  });
}

export default BluetoothService;
