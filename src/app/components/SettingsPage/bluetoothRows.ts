import { useCallback, useEffect, useRef, useState } from "react";
import MediaHub from "../../MediaHub";
import type { IconName } from "../Icon/Icon";
import type { ConfirmRequest, Row } from "./SettingsPage";
import type { BluetoothDevice, BluetoothDeviceKind, BluetoothStatus } from "../../../shared/types";

const REFRESH_MS = 2500;
const SCAN_KEEPALIVE_MS = 15000;

const KINDS: Record<BluetoothDeviceKind, { label: string; icon: IconName }> = {
  controller: { label: "Controller", icon: "gamepad" },
  headphones: { label: "Headphones", icon: "headphones" },
  speaker: { label: "Speaker", icon: "speaker" },
  keyboard: { label: "Keyboard", icon: "keyboard" },
  mouse: { label: "Mouse", icon: "mouse" },
  phone: { label: "Phone", icon: "phone" },
  computer: { label: "Computer", icon: "monitor" },
  tv: { label: "TV", icon: "monitor" },
  other: { label: "", icon: "bluetooth" },
};

export interface BluetoothState {
  status: BluetoothStatus | null; // null = not loaded yet
  busy: string | null; // Address of the device being connected or paired
  refresh: () => void;
  setPowered: (powered: boolean) => void;
  connect: (device: BluetoothDevice) => void;
  disconnect: (device: BluetoothDevice) => void;
  pair: (device: BluetoothDevice) => void;
  forget: (device: BluetoothDevice) => void;
}

/**
 * Bluetooth status, refreshed every few seconds while `active`, which also keeps looking for devices to pair.
 */
export function useBluetooth(active: boolean): BluetoothState {
  const [status, setStatus] = useState<BluetoothStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const loading = useRef(false);
  const api = MediaHub.api;

  const refresh = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      setStatus(await api.getBluetoothStatus());
    } catch (error) {
      console.error("Bluetooth refresh failed:", error);
    } finally {
      loading.current = false;
    }
  }, [api]);

  const powered = status?.powered ?? false;
  useEffect(() => {
    if (!active) return;
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, refresh]);

  // Look for devices only while the page is open and Bluetooth is on, since scanning slows down connected devices
  useEffect(() => {
    if (!active || !powered) return;
    const scan = () => api.setBluetoothScanning(true).catch(() => undefined);
    scan();
    const timer = setInterval(scan, SCAN_KEEPALIVE_MS);
    return () => {
      clearInterval(timer);
      api.setBluetoothScanning(false).catch(() => undefined);
    };
  }, [active, powered, api]);

  const withBusy = async (device: BluetoothDevice, action: () => Promise<void>) => {
    setBusy(device.address);
    try {
      await action();
    } finally {
      setBusy(null);
      refresh();
    }
  };

  return {
    status,
    busy,
    refresh,
    setPowered: next => MediaHub.run(async () => {
      await api.setBluetoothPowered(next);
      await refresh();
    }),
    connect: device => withBusy(device, async () => {
      const result = await MediaHub.run(() => api.connectBluetooth(device.address));
      if (result?.success) MediaHub.toasts.add(`Connected to ${device.name}.`, "success");
      else if (result) MediaHub.toasts.add(result.message, "error");
    }),
    disconnect: device => withBusy(device, async () => {
      await MediaHub.run(() => api.disconnectBluetooth(device.address));
    }),
    pair: device => withBusy(device, async () => {
      const result = await MediaHub.run(() => api.pairBluetooth(device.address));
      if (result?.success) MediaHub.toasts.add(result.message ?? `Paired with ${device.name}.`, "success");
      else if (result && !result.canceled) MediaHub.toasts.add(result.message, "error");
    }),
    forget: device => withBusy(device, async () => {
      await MediaHub.run(async () => {
        await api.forgetBluetooth(device.address);
        MediaHub.toasts.add(`Forgot ${device.name}.`, "success");
      });
    }),
  };
}

/**
 * The Bluetooth switch, paired devices, and devices nearby to pair.
 */
export function buildBluetoothRows(bluetooth: BluetoothState, askConfirm: (request: ConfirmRequest) => void): Row[] {
  const { status, busy } = bluetooth;
  if (!status) return [{ key: "bt-loading", label: "Checking Bluetooth…" }];
  if (!status.available) {
    return [{ key: "bt-none", label: "No Bluetooth adapter found. Plug one in, or run setup.sh to set Bluetooth up." }];
  }

  const rows: Row[] = [{
    key: "bt-power",
    label: "Bluetooth",
    checked: status.powered,
    onSelect: () => bluetooth.setPowered(!status.powered),
  }];
  if (!status.powered) return rows;

  const paired = status.devices.filter(device => device.paired);
  const nearby = status.devices.filter(device => !device.paired);

  if (paired.length > 0) rows.push({ key: "bt-paired", label: "Your devices", heading: true });
  for (const device of paired) {
    let value = device.connected ? "Connected" : "Not connected";
    if (busy === device.address) value = "Connecting…";
    else if (device.connected && device.battery !== null) value = `Connected · ${device.battery}%`;
    rows.push({
      key: `bt-${device.address}`,
      label: device.name,
      icon: KINDS[device.kind].icon,
      value,
      onSelect: () => {
        if (busy) return;
        if (!device.connected) return bluetooth.connect(device);
        askConfirm({
          title: `Disconnect ${device.name}?`,
          message: "It stays paired, so it connects again when you turn it on or select it here.",
          confirmLabel: "Disconnect",
          onConfirm: () => bluetooth.disconnect(device),
        });
      },
      onOptions: () => askConfirm({
        title: `Forget ${device.name}?`,
        message: "It disconnects, and has to be paired again before it can connect.",
        confirmLabel: "Forget",
        danger: true,
        onConfirm: () => bluetooth.forget(device),
      }),
      optionsLabel: "Forget",
    });
  }

  rows.push({ key: "bt-nearby", label: status.scanning ? "Pair a new device · Searching…" : "Pair a new device", heading: true });
  for (const device of nearby) {
    rows.push({
      key: `bt-${device.address}`,
      label: device.name,
      icon: KINDS[device.kind].icon,
      value: busy === device.address ? "Pairing…" : KINDS[device.kind].label || undefined,
      onSelect: () => {
        if (!busy) bluetooth.pair(device);
      },
    });
  }
  if (nearby.length === 0) {
    rows.push({ key: "bt-hint", label: "Put your controller, headphones or keyboard in pairing mode to see it here." });
  }
  return rows;
}
