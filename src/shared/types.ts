/**
 * Gamescope appid used for the hub's own windows. Gamescope treats 769 as "Steam", which makes it
 * the home layer: always fullscreen and never frame-limited.
 */
export const HUB_APP_ID = 769;

/**
 * First appid handed out to library apps. Everything below is reserved.
 */
export const FIRST_APP_ID = 10001;

/**
 * First appid used for temporary web apps opened from the phone ("Open link on TV"). These are never stored.
 */
export const FIRST_TEMP_APP_ID = 90001;

export type HubAppType = "desktop" | "web";
export type WebBrowser = "builtin" | "external";

/**
 * An app tile on the home screen, as stored in `apps.json`.
 */
export interface HubApp {
  appId: number; // Gamescope appid, >= FIRST_APP_ID, stable
  type: HubAppType;
  name: string;

  // Desktop apps
  command?: string; // Exec line with field codes stripped
  desktopFile?: string;
  env?: Record<string, string>;

  // Web apps
  url?: string;
  userAgent?: string | null; // null = Electron default
  browser?: WebBrowser; // "external" = Chromium/Chrome kiosk, needed for DRM (Netflix, Disney+)
  gamepadKeys?: boolean; // Map controller input to arrow/Enter/Escape keys. Default true

  // Artwork (absolute paths)
  icon?: string | null;
  cover?: string | null;
  background?: string | null;
  accentColor?: string | null; // null = derived from icon

  order: number;
  temporary?: boolean; // Opened from the phone, not part of the library
}

/**
 * Fields accepted when creating an app. `appId` and `order` are assigned by the library.
 */
export type HubAppInput = Omit<HubApp, "appId" | "order">;

export interface RunningApp {
  appId: number;
  app: HubApp;
  unit: string | null; // systemd scope unit, null when launched without systemd-run
  pid: number | null;
  startedAt: number;
  hasWindow: boolean; // Gamescope has seen a focusable window for this appid
}

export interface AudioSink {
  id: number;
  name: string;
  isDefault: boolean;
}

export interface VolumeInfo {
  volume: number; // 0..1
  muted: boolean;
}

export interface NetworkInfo {
  hostname: string;
  addresses: string[];
  connections: { device: string; type: string; state: string; connection: string }[];
}

export interface WifiStatus {
  device: string | null; // Wi-Fi interface, like wlan0. null = this machine has no Wi-Fi adapter
  managed: boolean; // NetworkManager runs and manages the adapter. Without it the hub can only show that Wi-Fi exists
  enabled: boolean; // Wi-Fi radio is on
  connected: string | null; // SSID of the current network
}

export interface WifiNetwork {
  ssid: string;
  signal: number; // 0..100
  secure: boolean; // Needs a password
  enterprise: boolean; // 802.1X (WPA-Enterprise), which needs more than a password and can't be joined from the hub
  saved: boolean; // NetworkManager remembers it, so it connects without asking for the password
  active: boolean;
}

/**
 * Outcome of joining a Wi-Fi network. Wrong or missing passwords are expected, so they're results rather than errors.
 */
export type WifiConnectResult =
  | { success: true }
  | { success: false; needsPassword: boolean; message: string };

export type BluetoothDeviceKind = "controller" | "headphones" | "speaker" | "keyboard" | "mouse" | "phone" | "computer" | "tv" | "other";

export interface BluetoothDevice {
  address: string; // Like AA:BB:CC:DD:EE:FF
  name: string;
  kind: BluetoothDeviceKind;
  paired: boolean;
  connected: boolean;
  battery: number | null; // 0..100. null = the device doesn't report it
}

export interface BluetoothStatus {
  available: boolean; // false = no adapter, or BlueZ isn't installed or running
  powered: boolean;
  scanning: boolean; // Looking for devices to pair
  devices: BluetoothDevice[]; // Paired devices first, then the ones found nearby
}

/**
 * A pairing in progress, shown on the TV until it finishes.
 */
export interface BluetoothPairing {
  address: string;
  name: string;
  stage: "pairing" | "connecting";
  passkey: string | null; // Code to type on the keyboard that's being paired
  confirm: string | null; // Code the device should show too. Pairing waits for a yes or no
}

/**
 * Outcome of pairing or connecting. A device that's off or out of range is expected, so it's a result rather than an error.
 */
export type BluetoothResult =
  | { success: true; message?: string }
  | { success: false; canceled?: boolean; message: string };

/**
 * How gamescope drives the TV, as stored in the session config. Takes effect when the session starts gamescope again.
 */
export interface DisplayConfig {
  output: string | null; // Connector, like HDMI-A-1. null = let gamescope pick
  width: number | null; // null (with height) = the display's own preferred resolution
  height: number | null;
  refresh: number | null; // Hz. null = gamescope picks
  vrr: boolean; // Adaptive sync
  hdr: boolean;
}

export interface DisplayMode {
  width: number;
  height: number;
  refreshRates: number[]; // Hz, highest first. Empty = the display didn't say
}

export interface DisplayOutput {
  name: string; // Connector, like HDMI-A-1
  label: string | null; // The display's own name, like "LG TV SSCR2"
  modes: DisplayMode[]; // The display's preferred resolution first
  hdr: boolean | null; // The display supports HDR. null = unknown
}

export interface DisplayInfo {
  supported: boolean; // The session can apply new display settings
  message: string | null; // Why it can't
  outputs: DisplayOutput[]; // Connected displays
  config: DisplayConfig;
}

export interface DesktopEntry {
  id: string; // Desktop file id, like "org.jellyfin.JellyfinDesktop.desktop"
  path: string;
  name: string;
  command: string;
  icon: string | null; // Resolved absolute icon path
  comment: string | null;
}

export interface CompanionInfo {
  url: string | null; // null = server not running
  pairingCode: string;
  pairedDevices: number;
}

export interface HubSettings {
  uiSounds: boolean;
  clock24h: boolean;
  externalBrowser: string | null; // null = auto-detect chromium/chrome/brave
  companionPort: number;
  updateBranch: string; // Git branch the hub updates from
  uiScale: number; // Size of the hub's menus, 1 = normal
}

export type UpdateStatus =
  | "idle"
  | "updating"
  | "ready" // Installed, takes effect after a restart
  | "failed"
  | "needs-setup"; // The update needs ./setup.sh, which needs root

export interface UpdateCommit {
  sha: string;
  subject: string;
}

/**
 * Updating the hub from its git repository.
 */
export interface UpdateState {
  supported: boolean; // false when the hub isn't installed in the versioned layout, for example in development
  repository: string;
  branch: string;
  branches: string[]; // Branches on the remote, for picking one in settings
  installed: { version: string; commit: string | null; branch: string | null };
  latest: { commit: string; commits: UpdateCommit[] } | null; // null = not checked yet. `commits` is newest first, may be empty
  available: boolean; // `latest` differs from what's installed
  checking: boolean;
  lastChecked: number | null;
  status: UpdateStatus;
  progress: number; // 0..1 while updating
  message: string | null; // Current step while updating, or what went wrong
}

/**
 * Everything the hub, overlay and companion render from. Pushed by the main process on every change.
 */
export interface HubState {
  apps: HubApp[];
  running: RunningApp[];
  focusedAppId: number | null; // App shown by gamescope, HUB_APP_ID or null when unknown
  hubFocused: boolean;
  quickMenuOpen: boolean;
  gamescope: boolean; // false = standalone (dev) mode
  volume: VolumeInfo;
  companion: CompanionInfo;
  settings: HubSettings;
  input: { helper: boolean; remote: boolean; controllers: string[] };
  version: string;
  update: UpdateState;
  bluetoothPairing: BluetoothPairing | null;
  displayTrial: number | null; // When new display settings switch back unless kept (epoch ms). null = not trying any
}

export type PowerAction = "poweroff" | "reboot" | "suspend" | "restart-hub";

/**
 * Remote key names understood by the input helper.
 */
export type RemoteKey =
  | "up" | "down" | "left" | "right" | "enter" | "escape" | "backspace" | "tab" | "space"
  | "home" | "end" | "pageup" | "pagedown" | "delete"
  | "playpause" | "next" | "previous" | "stop" | "volumeup" | "volumedown" | "mute";

/**
 * Messages a phone sends over the companion WebSocket.
 */
export type RemoteMessage =
  | { type: "move"; dx: number; dy: number }
  | { type: "button"; button: "left" | "right" | "middle"; state: "down" | "up" | "click" }
  | { type: "scroll"; dx: number; dy: number }
  | { type: "key"; key: RemoteKey; state?: "down" | "up" | "tap" }
  | { type: "text"; text: string }
  | { type: "action"; action: "home" | "menu" | "volume-up" | "volume-down" | "mute" };

/**
 * Messages the hub sends over the companion WebSocket.
 */
export type RemoteServerMessage =
  | { type: "state"; state: HubState };

/**
 * Typed API exposed by the preload script as `window.mediahub`.
 */
export interface MediaHubApi {
  view: "home" | "overlay";
  getState(): Promise<HubState>;
  onState(listener: (state: HubState) => void): () => void;
  onToast(listener: (toast: { message: string; type: "info" | "error" }) => void): () => void;

  // Apps
  launch(appId: number): Promise<void>;
  focus(appId: number): Promise<void>;
  close(appId: number): Promise<void>;
  goHome(): Promise<void>;
  setQuickMenu(open: boolean): Promise<void>;
  toggleQuickMenu(): Promise<void>;

  // Library
  addApp(app: HubAppInput): Promise<HubApp>;
  updateApp(appId: number, patch: Partial<HubAppInput>): Promise<HubApp>;
  removeApp(appId: number): Promise<void>;
  moveApp(appId: number, index: number): Promise<void>;
  listDesktopEntries(): Promise<DesktopEntry[]>;

  // System
  setVolume(volume: number): Promise<void>;
  toggleMute(): Promise<void>;
  listAudioSinks(): Promise<AudioSink[]>;
  setDefaultSink(id: number): Promise<void>;
  getNetworkInfo(): Promise<NetworkInfo>;
  getWifiStatus(): Promise<WifiStatus>;
  scanWifi(rescan: boolean): Promise<WifiNetwork[]>;
  connectWifi(ssid: string, password?: string): Promise<WifiConnectResult>;
  forgetWifi(ssid: string): Promise<void>;
  setWifiEnabled(enabled: boolean): Promise<void>;
  getBluetoothStatus(): Promise<BluetoothStatus>;
  setBluetoothPowered(powered: boolean): Promise<void>;
  setBluetoothScanning(scanning: boolean): Promise<void>;
  pairBluetooth(address: string): Promise<BluetoothResult>;
  answerBluetoothPairing(accept: boolean): Promise<void>;
  connectBluetooth(address: string): Promise<BluetoothResult>;
  disconnectBluetooth(address: string): Promise<void>;
  forgetBluetooth(address: string): Promise<void>;
  getDisplayInfo(): Promise<DisplayInfo>;
  applyDisplay(config: DisplayConfig): Promise<void>;
  keepDisplay(keep: boolean): Promise<void>;
  power(action: PowerAction): Promise<void>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  setUpdateBranch(branch: string): Promise<void>;
  updateSettings(patch: Partial<HubSettings>): Promise<void>;
  forgetPairedDevices(): Promise<void>;
}
