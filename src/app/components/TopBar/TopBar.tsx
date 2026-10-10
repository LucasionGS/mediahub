import "./TopBar.scss";
import { useEffect, useState } from "react";
import MediaHub from "../../MediaHub";
import useController from "../../lib/useController";
import Icon, { type IconName } from "../Icon/Icon";
import type { HubState } from "../../../shared/types";

export type TopBarItem = "update" | "settings" | "power";
const ITEM_ICONS: Record<TopBarItem, IconName> = { update: "download", settings: "settings", power: "power" };

/**
 * The buttons in the top bar, left to right. The update button only shows while there's something to do.
 */
export function getTopBarItems(state: HubState): TopBarItem[] {
  const { update } = state;
  const showUpdate = update.supported && (update.available || update.status === "updating" || update.status === "ready");
  return showUpdate ? ["update", "settings", "power"] : ["settings", "power"];
}

export interface TopBarProps {
  focusedIndex: number | null; // null = focus is elsewhere
  onHover: (index: number) => void;
  onActivate: (item: TopBarItem) => void;
}

/**
 * Top-right status bar: volume, clock and the settings/power buttons.
 */
export default function TopBar(props: TopBarProps) {
  const { focusedIndex, onHover, onActivate } = props;
  const state = useController(MediaHub.hub).state!;
  const time = useClock(state.settings.clock24h);
  const volume = Math.round(state.volume.volume * 100);
  const items = getTopBarItems(state);

  return (
    <div className="top-bar">
      <span className="top-bar__status">
        <Icon name={state.volume.muted || volume === 0 ? "volumeMute" : "volume"} size="1.2rem" />
        {state.volume.muted ? "Muted" : `${volume}%`}
      </span>
      {items.map((item, i) => {
        const label = item === "update" ? updateLabel(state) : null;
        return (
          <button
            key={item}
            className={`top-bar__button hub-focusable ${label ? "top-bar__button--labelled" : ""} ${focusedIndex === i ? "is-focused" : ""}`}
            onMouseEnter={() => onHover(i)}
            onClick={() => onActivate(item)}
            aria-label={label ?? item}
          >
            <Icon name={item === "update" && state.update.status === "ready" ? "restart" : ITEM_ICONS[item]} size="1.4rem" />
            {label}
          </button>
        );
      })}
      <span className="top-bar__clock">{time}</span>
    </div>
  );
}

function updateLabel(state: HubState): string {
  const { status, progress } = state.update;
  if (status === "updating") return `Updating ${Math.round(progress * 100)}%`;
  if (status === "ready") return "Restart to update";
  return "Update";
}

function useClock(clock24h: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !clock24h });
}
