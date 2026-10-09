import "./AppPicker.scss";
import { useEffect, useRef, useState } from "react";
import MediaHub from "../../MediaHub";
import useController from "../../lib/useController";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";
import { assetUrl } from "../../lib/assets";
import Icon from "../Icon/Icon";
import Hints from "../Hints/Hints";
import { WEB_PRESETS } from "../../../shared/presets";
import type { DesktopEntry, HubAppInput } from "../../../shared/types";

export interface AppPickerProps {
  onClose: () => void;
}

type Tab = "installed" | "web";
const COLUMNS = 6;

interface Choice {
  key: string;
  name: string;
  detail: string | null;
  icon: string | null;
  accent: string | null;
  added: boolean;
  input: HubAppInput;
}

/**
 * Pick installed desktop apps or web app presets to add to the home screen.
 */
export default function AppPicker(props: AppPickerProps) {
  const { onClose } = props;
  const state = useController(MediaHub.hub).state!;
  const [tab, setTab] = useState<Tab>("installed");
  const [entries, setEntries] = useState<DesktopEntry[] | null>(null);
  const [index, setIndex] = useState(0);
  const [inTabs, setInTabs] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    MediaHub.run(() => MediaHub.api.listDesktopEntries()).then(list => setEntries(list ?? []));
  }, []);

  const addedDesktop = new Set(state.apps.map(app => app.desktopFile).filter(Boolean));
  const addedUrls = new Set(state.apps.map(app => app.url).filter(Boolean));

  const choices: Choice[] = tab === "installed"
    ? (entries ?? []).map(entry => ({
      key: entry.id,
      name: entry.name,
      detail: entry.comment,
      icon: entry.icon,
      accent: null,
      added: addedDesktop.has(entry.path),
      input: { type: "desktop", name: entry.name, command: entry.command, desktopFile: entry.path, icon: entry.icon },
    }))
    : WEB_PRESETS.map(preset => ({
      key: preset.id,
      name: preset.app.name,
      detail: preset.note ?? preset.app.url ?? null,
      icon: null,
      accent: preset.app.accentColor ?? null,
      added: addedUrls.has(preset.app.url),
      input: preset.app,
    }));
  const focusIndex = Math.min(index, Math.max(0, choices.length - 1));
  const focused = choices[focusIndex] ?? null;

  // Keep the focused card in view
  useEffect(() => {
    gridRef.current?.querySelector(".is-focused")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusIndex, tab]);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    Sounds.move();
    setTab(next);
    setIndex(0);
  };

  const add = async (choice: Choice) => {
    if (choice.added) return Sounds.bump();
    Sounds.select();
    const app = await MediaHub.run(() => MediaHub.api.addApp(choice.input));
    if (app) MediaHub.toasts.add(`Added ${app.name} to the home screen.`, "success");
  };

  useInputLayer(action => {
    if (action === "back") {
      Sounds.back();
      return onClose();
    }
    if (action === "prev-tab") return switchTab("installed");
    if (action === "next-tab") return switchTab("web");

    if (inTabs) {
      if (action === "left") switchTab("installed");
      else if (action === "right") switchTab("web");
      else if (action === "down" && choices.length > 0) {
        Sounds.move();
        setInTabs(false);
      }
      return;
    }

    const col = focusIndex % COLUMNS;
    let next = focusIndex;
    if (action === "left" && col > 0) next--;
    else if (action === "right" && col < COLUMNS - 1 && focusIndex + 1 < choices.length) next++;
    else if (action === "down" && focusIndex + COLUMNS < choices.length) next += COLUMNS;
    else if (action === "down" && Math.floor(focusIndex / COLUMNS) < Math.floor((choices.length - 1) / COLUMNS)) next = choices.length - 1;
    else if (action === "up" && focusIndex - COLUMNS >= 0) next -= COLUMNS;
    else if (action === "up") {
      Sounds.move();
      return setInTabs(true);
    }
    else if (action === "confirm" && focused) return add(focused);
    else if (action === "left" || action === "right" || action === "down") return Sounds.bump();

    if (next !== focusIndex) {
      Sounds.move();
      setIndex(next);
    }
  });

  return (
    <div className="app-picker">
      <div className="app-picker__header">
        <div className="app-picker__title">Add apps</div>
        <div className="app-picker__tabs">
          {(["installed", "web"] as Tab[]).map(t => (
            <button
              key={t}
              className={`app-picker__tab hub-focusable ${tab === t ? "is-selected" : ""} ${inTabs && tab === t ? "is-focused" : ""}`}
              onClick={() => switchTab(t)}
            >
              {t === "installed" ? "Installed apps" : "Web apps"}
            </button>
          ))}
        </div>
      </div>

      <div className="app-picker__grid" ref={gridRef}>
        {tab === "installed" && entries === null && <div className="app-picker__empty">Looking for installed apps…</div>}
        {tab === "installed" && entries?.length === 0 && <div className="app-picker__empty">No installed apps found.</div>}
        {choices.map((choice, i) => (
          <button
            key={choice.key}
            className={`app-picker__card hub-focusable ${!inTabs && i === focusIndex ? "is-focused" : ""} ${choice.added ? "is-added" : ""}`}
            onMouseEnter={() => { setInTabs(false); setIndex(i); }}
            onClick={() => add(choice)}
          >
            <span className="app-picker__icon" style={choice.accent ? { background: choice.accent } : undefined}>
              {choice.icon ? <img src={assetUrl(choice.icon)!} alt="" /> : <span>{choice.name.slice(0, 1)}</span>}
            </span>
            <span className="app-picker__name">{choice.name}</span>
            {choice.added && <span className="app-picker__added"><Icon name="check" size="1rem" /> Added</span>}
          </button>
        ))}
      </div>

      <div className="app-picker__detail">
        {focused?.detail}
        {tab === "web" && state.companion.url && <div>Add any other website from your phone at {state.companion.url}</div>}
      </div>
      <Hints hints={[["A", "Add"], ["LB/RB", "Switch tab"], ["B", "Back"]]} />
    </div>
  );
}
