import "./SettingsPage.scss";
import { useEffect, useRef, useState } from "react";
import MediaHub from "../../MediaHub";
import useController from "../../lib/useController";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";
import Icon, { type IconName } from "../Icon/Icon";
import Hints from "../Hints/Hints";
import type { AudioSink, HubState, NetworkInfo } from "../../../shared/types";

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

interface Row {
  key: string;
  label: string;
  value?: string;
  big?: boolean;
  checked?: boolean;
  danger?: boolean;
  slider?: number; // 0..1
  onSelect?: () => void;
  onAdjust?: (direction: -1 | 1) => void;
}

/**
 * Settings: sound output and volume, phone pairing, network status, interface options and system info.
 */
export default function SettingsPage(props: SettingsPageProps) {
  const { onClose } = props;
  const state = useController(MediaHub.hub).state!;
  const [section, setSection] = useState(0);
  const [inContent, setInContent] = useState(false);
  const [rowIndex, setRowIndex] = useState(0);
  const [sinks, setSinks] = useState<AudioSink[]>([]);
  const [network, setNetwork] = useState<NetworkInfo | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const sectionId = SECTIONS[section].id;

  useEffect(() => {
    if (sectionId === "audio") MediaHub.run(() => MediaHub.api.listAudioSinks()).then(list => setSinks(list ?? []));
    if (sectionId === "network") MediaHub.run(() => MediaHub.api.getNetworkInfo()).then(info => setNetwork(info ?? null));
  }, [sectionId, state.volume.volume]);

  const rows = buildRows(sectionId, state, sinks, network, setSinks);
  const selectable = rows.filter(row => row.onSelect || row.onAdjust);
  const focusRow = Math.min(rowIndex, Math.max(0, selectable.length - 1));
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
        setRowIndex(0);
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
  });

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
            className={`settings-page__row ${row.onSelect || row.onAdjust ? "hub-focusable is-selectable" : ""} ${focusedKey === row.key ? "is-focused" : ""} ${row.danger ? "is-danger" : ""}`}
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
            {row.checked !== undefined && (
              <span className={`settings-page__check ${row.checked ? "is-on" : ""}`}>{row.checked && <Icon name="check" size="1rem" />}</span>
            )}
          </div>
        ))}
      </div>
      <Hints hints={inContent && selectable[focusRow]?.onAdjust ? [["←→", "Adjust"], ["B", "Back"]] : [["A", "Select"], ["B", "Back"]]} />
    </div>
  );
}

function buildRows(section: SectionId, state: HubState, sinks: AudioSink[], network: NetworkInfo | null, setSinks: (sinks: AudioSink[]) => void): Row[] {
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
      return [
        { key: "hostname", label: "Name", value: network.hostname },
        { key: "address", label: "IP address", value: network.addresses.join(", ") || "Not connected" },
        ...network.connections.map<Row>(c => ({ key: c.device, label: `${c.type === "wifi" ? "Wi-Fi" : c.type === "ethernet" ? "Ethernet" : c.type} (${c.device})`, value: c.connection || c.state })),
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
