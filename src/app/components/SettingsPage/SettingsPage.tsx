import "./SettingsPage.scss";
import { useCallback, useEffect, useRef, useState } from "react";
import MediaHub from "../../MediaHub";
import useController from "../../lib/useController";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";
import Icon, { type IconName } from "../Icon/Icon";
import Hints from "../Hints/Hints";
import ConfirmDialog from "../Dialog/ConfirmDialog";
import WifiPasswordDialog from "../WifiPasswordDialog/WifiPasswordDialog";
import type { AudioSink, HubState, NetworkInfo, WifiNetwork, WifiStatus } from "../../../shared/types";

export interface SettingsPageProps {
  onClose: () => void;
}

type SectionId = "audio" | "remote" | "network" | "interface" | "about";

const SECTIONS: { id: SectionId; label: string; icon: IconName }[] = [
  { id: "audio", label: "Sound", icon: "speaker" },
  { id: "remote", label: "Phone remote", icon: "phone" },
  { id: "network", label: "Network", icon: "wifi" },
  { id: "interface", label: "Interface", icon: "sliders" },
  { id: "about", label: "System", icon: "info" },
];

const WIFI_RESCAN_MS = 15000;

interface Row {
  key: string;
  label: string;
  value?: string;
  big?: boolean;
  heading?: boolean; // A small title above a group of rows
  checked?: boolean;
  danger?: boolean;
  slider?: number; // 0..1
  wifi?: { signal: number; secure: boolean };
  onSelect?: () => void;
  onAdjust?: (direction: -1 | 1) => void;
  onOptions?: () => void;
  optionsLabel?: string;
}

type WifiDialog =
  | { kind: "password"; ssid: string; message?: string }
  | { kind: "forget"; ssid: string };

/**
 * Everything the rows are built from.
 */
interface RowContext {
  state: HubState;
  sinks: AudioSink[];
  setSinks: (sinks: AudioSink[]) => void;
  network: NetworkInfo | null;
  wifi: WifiState;
  connectingTo: string | null;
  selectNetwork: (network: WifiNetwork) => void;
  setWifiDialog: (dialog: WifiDialog) => void;
}

/**
 * Settings: sound output and volume, phone pairing, network status and Wi-Fi, interface options and system info.
 */
export default function SettingsPage(props: SettingsPageProps) {
  const { onClose } = props;
  const state = useController(MediaHub.hub).state!;
  const [section, setSection] = useState(0);
  const [inContent, setInContent] = useState(false);
  const [rowFocus, setRowFocus] = useState<{ index: number; key: string | null }>({ index: 0, key: null });
  const [sinks, setSinks] = useState<AudioSink[]>([]);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const [wifiDialog, setWifiDialog] = useState<WifiDialog | null>(null);
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const sectionId = SECTIONS[section].id;
  const wifi = useWifi(sectionId === "network");

  const refreshNetwork = useCallback(() => {
    MediaHub.run(() => MediaHub.api.getNetworkInfo()).then(info => setNetwork(info ?? null));
  }, []);

  useEffect(() => {
    if (sectionId === "audio") MediaHub.run(() => MediaHub.api.listAudioSinks()).then(list => setSinks(list ?? []));
    if (sectionId === "network") refreshNetwork();
  }, [sectionId, state.volume.volume, refreshNetwork]);

  const onWifiChanged = () => {
    wifi.refresh(false);
    refreshNetwork();
  };

  const selectNetwork = async (target: WifiNetwork) => {
    if (connectingTo) return;
    if (target.active) return setWifiDialog({ kind: "forget", ssid: target.ssid });
    if (target.enterprise) {
      MediaHub.toasts.add(`${target.ssid} needs a username and certificate (WPA-Enterprise), which the hub can't set up.`, "error");
      return;
    }
    if (target.secure && !target.saved) return setWifiDialog({ kind: "password", ssid: target.ssid });

    // Saved and open networks connect straight away
    setConnectingTo(target.ssid);
    const result = await MediaHub.run(() => MediaHub.api.connectWifi(target.ssid));
    setConnectingTo(null);
    if (!result) return;
    if (result.success) {
      MediaHub.toasts.add(`Connected to ${target.ssid}.`, "success");
      onWifiChanged();
    }
    else if (result.needsPassword) {
      setWifiDialog({ kind: "password", ssid: target.ssid, message: result.message });
    }
    else {
      MediaHub.toasts.add(result.message, "error");
    }
  };

  const rows = buildRows(sectionId, { state, sinks, setSinks, network, wifi, connectingTo, selectNetwork, setWifiDialog });
  const selectable = rows.filter(row => row.onSelect || row.onAdjust);
  // Follow the focused row by key, so it stays put when the Wi-Fi list reorders after a scan
  const keyIndex = rowFocus.key ? selectable.findIndex(row => row.key === rowFocus.key) : -1;
  const focusRow = keyIndex !== -1 ? keyIndex : Math.min(rowFocus.index, Math.max(0, selectable.length - 1));
  const setRowIndex = (index: number) => setRowFocus({ index, key: selectable[index]?.key ?? null });
  const focusedKey = inContent ? selectable[focusRow]?.key : null;

  useEffect(() => {
    contentRef.current?.querySelector(".is-focused")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusedKey]);

  useInputLayer(action => {
    if (!inContent) {
      if (action === "up" || action === "down") {
        const next = section + (action === "up" ? -1 : 1);
        if (next < 0 || next >= SECTIONS.length) return Sounds.bump();
        Sounds.move();
        setSection(next);
        setRowFocus({ index: 0, key: null });
      }
      else if ((action === "right" || action === "confirm") && selectable.length > 0) {
        Sounds.move();
        setInContent(true);
      }
      else if (action === "back") {
        Sounds.back();
        onClose();
      }
      return;
    }

    const row = selectable[focusRow];
    if (action === "up" || action === "down") {
      const next = focusRow + (action === "up" ? -1 : 1);
      if (next < 0 || next >= selectable.length) return Sounds.bump();
      Sounds.move();
      setRowIndex(next);
    }
    else if ((action === "left" || action === "right") && row?.onAdjust) {
      Sounds.move();
      row.onAdjust(action === "left" ? -1 : 1);
    }
    else if (action === "left" || action === "back") {
      Sounds.back();
      setInContent(false);
    }
    else if (action === "confirm" && row?.onSelect) {
      Sounds.select();
      row.onSelect();
    }
    else if (action === "options" && row?.onOptions) {
      Sounds.select();
      row.onOptions();
    }
  }, !wifiDialog);

  const focusedRow = inContent ? selectable[focusRow] : undefined;
  const hints: [string, string][] = focusedRow?.onAdjust ? [["←→", "Adjust"]] : [["A", "Select"]];
  if (focusedRow?.onOptions) hints.push(["X", focusedRow.optionsLabel ?? "Options"]);
  hints.push(["B", "Back"]);

  return (
    <div className="settings-page">
      <div className="settings-page__sidebar">
        <div className="settings-page__title">Settings</div>
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            className={`settings-page__section hub-focusable ${i === section ? "is-selected" : ""} ${!inContent && i === section ? "is-focused" : ""}`}
            onMouseEnter={() => { if (!inContent) setSection(i); }}
            onClick={() => { setSection(i); setInContent(false); }}
          >
            <Icon name={s.icon} />
            {s.label}
          </button>
        ))}
      </div>
      <div className="settings-page__content" key={sectionId} ref={contentRef}>
        <div className="settings-page__heading">{SECTIONS[section].label}</div>
        {rows.map(row => (
          <div
            key={row.key}
            className={`settings-page__row ${row.onSelect || row.onAdjust ? "hub-focusable is-selectable" : ""} ${focusedKey === row.key ? "is-focused" : ""} ${row.danger ? "is-danger" : ""} ${row.heading ? "is-heading" : ""}`}
            onMouseEnter={() => {
              const i = selectable.indexOf(row);
              if (i !== -1) { setInContent(true); setRowIndex(i); }
            }}
            onClick={() => row.onSelect?.()}
          >
            <span className="settings-page__label">{row.label}</span>
            {row.slider !== undefined && (
              <span className="settings-page__slider"><span style={{ width: `${row.slider * 100}%` }} /></span>
            )}
            {row.value !== undefined && <span className={`settings-page__value ${row.big ? "is-big" : ""}`}>{row.value}</span>}
            {row.wifi && <WifiSignal signal={row.wifi.signal} secure={row.wifi.secure} />}
            {row.checked !== undefined && (
              <span className={`settings-page__check ${row.checked ? "is-on" : ""}`}>{row.checked && <Icon name="check" size="1rem" />}</span>
            )}
          </div>
        ))}
      </div>
      <Hints hints={hints} />
      {wifiDialog?.kind === "password" && (
        <WifiPasswordDialog
          ssid={wifiDialog.ssid}
          message={wifiDialog.message}
          onCancel={() => setWifiDialog(null)}
          onConnected={() => {
            MediaHub.toasts.add(`Connected to ${wifiDialog.ssid}.`, "success");
            setWifiDialog(null);
            onWifiChanged();
          }}
        />
      )}
      {wifiDialog?.kind === "forget" && (
        <ConfirmDialog
          title={`Forget ${wifiDialog.ssid}?`}
          message="The hub disconnects and won't join it on its own anymore. You'll need the password to connect again."
          confirmLabel="Forget"
          danger
          onCancel={() => setWifiDialog(null)}
          onConfirm={() => {
            const ssid = wifiDialog.ssid;
            setWifiDialog(null);
            MediaHub.run(async () => {
              await MediaHub.api.forgetWifi(ssid);
              MediaHub.toasts.add(`Forgot ${ssid}.`, "success");
              onWifiChanged();
            });
          }}
        />
      )}
    </div>
  );
}

function buildRows(section: SectionId, ctx: RowContext): Row[] {
  const { state, sinks, setSinks, network } = ctx;
  const api = MediaHub.api;
  switch (section) {
    case "audio": return [
      {
        key: "volume",
        label: "Volume",
        value: state.volume.muted ? "Muted" : `${Math.round(state.volume.volume * 100)}%`,
        slider: state.volume.muted ? 0 : state.volume.volume,
        onAdjust: direction => MediaHub.run(() => api.setVolume(state.volume.volume + direction * 0.05)),
      },
      { key: "mute", label: "Mute", checked: state.volume.muted, onSelect: () => MediaHub.run(() => api.toggleMute()) },
      ...sinks.map<Row>(sink => ({
        key: `sink-${sink.id}`,
        label: sink.name,
        checked: sink.isDefault,
        onSelect: async () => {
          await MediaHub.run(() => api.setDefaultSink(sink.id));
          setSinks(sinks.map(s => ({ ...s, isDefault: s.id === sink.id })));
        },
      })),
      ...(sinks.length === 0 ? [{ key: "no-sinks", label: "No audio outputs found. Is PipeWire running?" }] : []),
    ];
    case "remote": return [
      { key: "url", label: "Open on your phone", value: state.companion.url ?? "Not running", big: true },
      { key: "code", label: "Pairing code", value: state.companion.pairingCode.replace(/(\d{3})(\d{3})/, "$1 $2"), big: true },
      { key: "devices", label: "Paired phones", value: String(state.companion.pairedDevices) },
      { key: "mouse", label: "Phone mouse and keyboard", value: state.input.remote ? "Ready" : "Unavailable (run setup.sh)" },
      {
        key: "forget",
        label: "Unpair all phones",
        danger: true,
        onSelect: () => MediaHub.run(async () => {
          await api.forgetPairedDevices();
          MediaHub.toasts.add("All phones were unpaired.", "success");
        }),
      },
    ];
    case "network": {
      if (!network) return [{ key: "loading", label: "Checking network…" }];
      const wifiRows = buildWifiRows(ctx);
      return [
        { key: "hostname", label: "Name", value: network.hostname },
        { key: "address", label: "IP address", value: network.addresses.join(", ") || "Not connected" },
        ...network.connections
          .filter(c => !(c.type === "wifi" && wifiRows.length > 0)) // Shown in the Wi-Fi section instead
          .map<Row>(c => ({ key: c.device, label: `${c.type === "wifi" ? "Wi-Fi" : c.type === "ethernet" ? "Ethernet" : c.type} (${c.device})`, value: c.connection || c.state })),
        ...wifiRows,
        {
          key: "bluetooth",
          label: "Bluetooth",
          value: network.bluetooth
            ? (network.bluetooth.powered ? (network.bluetooth.connected.length ? network.bluetooth.connected.join(", ") : "On, nothing connected") : "Off")
            : "Not available",
        },
      ];
    }
    case "interface": return [
      { key: "sounds", label: "Menu sounds", checked: state.settings.uiSounds, onSelect: () => MediaHub.run(() => api.updateSettings({ uiSounds: !state.settings.uiSounds })) },
      { key: "clock", label: "24-hour clock", checked: state.settings.clock24h, onSelect: () => MediaHub.run(() => api.updateSettings({ clock24h: !state.settings.clock24h })) },
    ];
    case "about": return [
      { key: "version", label: "MediaHub version", value: state.version },
      { key: "mode", label: "Display mode", value: state.gamescope ? "Gamescope" : "Standalone (no gamescope)" },
      { key: "helper", label: "Controller helper", value: state.input.helper ? "Running" : "Not running" },
      { key: "controllers", label: "Controllers", value: state.input.controllers.join(", ") || "None connected" },
      { key: "running", label: "Open apps", value: String(state.running.length) },
    ];
  }
}

/**
 * The Wi-Fi switch and the networks in range. Machines without a Wi-Fi adapter get no rows at all.
 */
function buildWifiRows(ctx: RowContext): Row[] {
  const { wifi, connectingTo, selectNetwork, setWifiDialog } = ctx;
  const { status, networks, scanning } = wifi;
  if (!status?.device) return [];
  if (!status.managed) {
    return [{ key: "wifi", label: `Wi-Fi (${status.device})`, value: "Needs NetworkManager. Run setup.sh to set it up." }];
  }

  const rows: Row[] = [{
    key: "wifi",
    label: `Wi-Fi (${status.device})`,
    checked: status.enabled,
    onSelect: () => MediaHub.run(async () => {
      await MediaHub.api.setWifiEnabled(!status.enabled);
      wifi.refresh(true);
    }),
  }];
  if (!status.enabled) return rows;

  rows.push({ key: "wifi-heading", label: scanning ? "Networks · Searching…" : "Networks", heading: true });
  for (const network of networks ?? []) {
    let value: string | undefined;
    if (connectingTo === network.ssid) value = "Connecting…";
    else if (network.active) value = "Connected";
    else if (network.saved) value = "Saved";
    rows.push({
      key: `wifi-${network.ssid}`,
      label: network.ssid,
      value,
      wifi: { signal: network.signal, secure: network.secure },
      onSelect: () => selectNetwork(network),
      ...(network.saved ? { onOptions: () => setWifiDialog({ kind: "forget", ssid: network.ssid }), optionsLabel: "Forget" } : {}),
    });
  }
  if (networks?.length === 0) rows.push({ key: "wifi-none", label: scanning ? "Searching for networks…" : "No networks found." });
  rows.push({ key: "wifi-rescan", label: "Search again", onSelect: () => wifi.refresh(true) });
  return rows;
}

/**
 * Signal bars, with a lock for networks that need a password.
 */
function WifiSignal(props: { signal: number; secure: boolean }) {
  const { signal, secure } = props;
  const bars = signal >= 75 ? 4 : signal >= 50 ? 3 : signal >= 25 ? 2 : 1;
  return (
    <span className="settings-page__wifi">
      {secure && <Icon name="lock" size="1.1rem" />}
      <span className="settings-page__signal">
        {[1, 2, 3, 4].map(bar => <span key={bar} className={bar <= bars ? "is-on" : ""} style={{ height: `${bar * 25}%` }} />)}
      </span>
    </span>
  );
}

interface WifiState {
  status: WifiStatus | null; // null = not loaded yet
  networks: WifiNetwork[] | null; // null = not scanned yet
  scanning: boolean;
  refresh: (rescan: boolean) => void;
}

/**
 * Wi-Fi status and nearby networks, rescanned every few seconds while `active`.
 */
function useWifi(active: boolean): WifiState {
  const [status, setStatus] = useState<WifiStatus | null>(null);
  const [networks, setNetworks] = useState<WifiNetwork[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const busy = useRef(false);
  const queued = useRef<boolean | null>(null); // Refresh asked for while another ran. true = with a rescan

  const refresh = useCallback(async function run(rescan: boolean) {
    if (busy.current) {
      // Don't drop it: after connecting, the list has to catch up even if a scan was already under way
      queued.current = (queued.current ?? false) || rescan;
      return;
    }
    busy.current = true;
    try {
      const next = await MediaHub.api.getWifiStatus();
      setStatus(next);
      if (!next.managed || !next.enabled) return setNetworks(null);
      // Show what NetworkManager already knows straight away, then the fresh scan once it's done
      setNetworks(await MediaHub.api.scanWifi(false));
      if (!rescan) return;
      setScanning(true);
      setNetworks(await MediaHub.api.scanWifi(true));
      setStatus(await MediaHub.api.getWifiStatus());
    } catch (error) {
      console.error("Wi-Fi refresh failed:", error);
    } finally {
      busy.current = false;
      setScanning(false);
      if (queued.current !== null) {
        const next = queued.current;
        queued.current = null;
        run(next);
      }
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh(true);
    const timer = setInterval(() => refresh(true), WIFI_RESCAN_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  return { status, networks, scanning, refresh };
}
