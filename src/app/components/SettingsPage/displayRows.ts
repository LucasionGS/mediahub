import { useEffect, useState } from "react";
import MediaHub from "../../MediaHub";
import type { ConfirmRequest, Row } from "./SettingsPage";
import type { DisplayConfig, DisplayInfo, DisplayOutput } from "../../../shared/types";

export interface DisplayState {
  info: DisplayInfo | null; // null = not loaded yet
  draft: DisplayConfig | null; // Settings picked on the page, applied together
  setDraft: (draft: DisplayConfig) => void;
}

/**
 * The connected displays and display settings, loaded while `active`.
 */
export function useDisplay(active: boolean): DisplayState {
  const [info, setInfo] = useState<DisplayInfo | null>(null);
  const [draft, setDraft] = useState<DisplayConfig | null>(null);

  useEffect(() => {
    if (!active) return;
    MediaHub.run(() => MediaHub.api.getDisplayInfo()).then(next => {
      if (!next) return;
      setInfo(next);
      setDraft(current => current ?? next.config);
    });
  }, [active]);

  return { info, draft, setDraft };
}

/**
 * Output, resolution, refresh rate, HDR and VRR. Changes are collected and applied together, since applying restarts
 * the hub.
 */
export function buildDisplayRows(display: DisplayState, askConfirm: (request: ConfirmRequest) => void): Row[] {
  const { info, draft, setDraft } = display;
  if (!info || !draft) return [{ key: "display-loading", label: "Checking displays…" }];
  const editable = info.supported;
  const output = findOutput(info, draft.output);
  const rows: Row[] = [];
  if (info.message) rows.push({ key: "display-message", label: info.message });

  // Output
  const outputChoices: (string | null)[] = [null, ...info.outputs.map(o => o.name)];
  if (draft.output && !outputChoices.includes(draft.output)) outputChoices.push(draft.output);
  rows.push(choiceRow("display-output", "TV output", outputChoices, draft.output, name => {
    if (name === null) return info.outputs.length === 1 ? `Automatic (${info.outputs[0].name})` : "Automatic";
    const connected = info.outputs.find(o => o.name === name);
    if (!connected) return `${name} · Not connected`;
    return connected.label ? `${name} · ${connected.label}` : name;
  }, editable, name => setDraft(fitToOutput({ ...draft, output: name }, findOutput(info, name)))));

  // Resolution
  const resolution = draft.width && draft.height ? `${draft.width}x${draft.height}` : null;
  const resolutionChoices: (string | null)[] = [null, ...(output?.modes ?? []).map(m => `${m.width}x${m.height}`)];
  if (resolution && !resolutionChoices.includes(resolution)) resolutionChoices.push(resolution);
  const best = output?.modes[0];
  rows.push(choiceRow("display-resolution", "Resolution", resolutionChoices, resolution, choice => {
    if (choice === null) return best ? `Automatic (${best.width} × ${best.height})` : "Automatic";
    return `${choice.replace("x", " × ")}${choice === `${best?.width}x${best?.height}` ? " · Best" : ""}`;
  }, editable, choice => {
    const [width, height] = choice ? choice.split("x").map(Number) : [null, null];
    setDraft(fitToOutput({ ...draft, width, height }, output));
  }));

  // Refresh rate
  const rates = refreshRates(output, draft);
  const rateChoices: (number | null)[] = [null, ...rates];
  if (draft.refresh && !rateChoices.includes(draft.refresh)) rateChoices.push(draft.refresh);
  rows.push(choiceRow("display-refresh", "Refresh rate", rateChoices, draft.refresh, rate => {
    if (rate === null) return "Automatic";
    return `${rate} Hz`;
  }, editable, rate => setDraft({ ...draft, refresh: rate })));

  // HDR and VRR
  if (output?.hdr === false && !draft.hdr) {
    rows.push({ key: "display-hdr", label: "HDR", value: "Not supported by this display" });
  }
  else {
    rows.push({
      key: "display-hdr",
      label: "HDR",
      checked: draft.hdr,
      ...(editable ? { onSelect: () => setDraft({ ...draft, hdr: !draft.hdr }) } : {}),
    });
  }
  rows.push({
    key: "display-vrr",
    label: "Adaptive sync (VRR), if the TV supports it",
    checked: draft.vrr,
    ...(editable ? { onSelect: () => setDraft({ ...draft, vrr: !draft.vrr }) } : {}),
  });

  if (editable && !sameConfig(draft, info.config)) {
    rows.push({
      key: "display-apply",
      label: "Apply changes",
      value: "Restarts MediaHub",
      onSelect: () => askConfirm({
        title: "Switch display settings?",
        message: "MediaHub restarts and open apps close. If the TV shows nothing afterwards, wait 20 seconds and it switches back by itself.",
        confirmLabel: "Switch",
        onConfirm: () => MediaHub.run(() => MediaHub.api.applyDisplay(draft)),
      }),
    });
    rows.push({ key: "display-undo", label: "Undo changes", onSelect: () => setDraft(info.config) });
  }
  return rows;
}

/**
 * A row that steps through `choices` with left and right, or A.
 */
function choiceRow<T>(key: string, label: string, choices: T[], current: T, describe: (choice: T) => string, editable: boolean, onChange: (choice: T) => void): Row {
  const step = (direction: -1 | 1) => {
    const index = Math.max(0, choices.indexOf(current));
    onChange(choices[(index + direction + choices.length) % choices.length]);
  };
  const canChange = editable && choices.length > 1;
  return {
    key,
    label,
    value: canChange ? `‹ ${describe(current)} ›` : describe(current),
    ...(canChange ? { onAdjust: step, onSelect: () => step(1) } : {}),
  };
}

/**
 * The output the settings apply to: the chosen one, or the first connected one when gamescope picks.
 */
function findOutput(info: DisplayInfo, name: string | null): DisplayOutput | null {
  return info.outputs.find(o => o.name === name) ?? (name === null ? info.outputs[0] ?? null : null);
}

/**
 * Refresh rates the display lists for the chosen resolution, or for its best one when the resolution is automatic.
 */
function refreshRates(output: DisplayOutput | null, config: DisplayConfig): number[] {
  if (!output) return [];
  const mode = config.width ? output.modes.find(m => m.width === config.width && m.height === config.height) : output.modes[0];
  return mode?.refreshRates ?? [];
}

/**
 * Drop a resolution or refresh rate the display doesn't list, back to automatic.
 */
function fitToOutput(config: DisplayConfig, output: DisplayOutput | null): DisplayConfig {
  if (!output) return config;
  const next = { ...config };
  if (next.width && !output.modes.some(m => m.width === next.width && m.height === next.height)) {
    next.width = null;
    next.height = null;
  }
  const rates = refreshRates(output, next);
  if (next.refresh && rates.length > 0 && !rates.includes(next.refresh)) next.refresh = null;
  return next;
}

function sameConfig(a: DisplayConfig, b: DisplayConfig) {
  return a.output === b.output && a.width === b.width && a.height === b.height && a.refresh === b.refresh && a.vrr === b.vrr && a.hdr === b.hdr;
}
