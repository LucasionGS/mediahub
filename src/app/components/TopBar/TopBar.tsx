import "./TopBar.scss";
import { useEffect, useState } from "react";
import MediaHub from "../../MediaHub";
import useController from "../../lib/useController";
import Icon, { type IconName } from "../Icon/Icon";

export type TopBarItem = "settings" | "power";
export const TOP_BAR_ITEMS: TopBarItem[] = ["settings", "power"];
const ITEM_ICONS: Record<TopBarItem, IconName> = { settings: "settings", power: "power" };

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

  return (
    <div className="top-bar">
      <span className="top-bar__status">
        <Icon name={state.volume.muted || volume === 0 ? "volumeMute" : "volume"} size="1.2rem" />
        {state.volume.muted ? "Muted" : `${volume}%`}
      </span>
      {TOP_BAR_ITEMS.map((item, i) => (
        <button
          key={item}
          className={`top-bar__button hub-focusable ${focusedIndex === i ? "is-focused" : ""}`}
          onMouseEnter={() => onHover(i)}
          onClick={() => onActivate(item)}
          aria-label={item}
        >
          <Icon name={ITEM_ICONS[item]} size="1.4rem" />
        </button>
      ))}
      <span className="top-bar__clock">{time}</span>
    </div>
  );
}

function useClock(clock24h: boolean) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(timer);
  }, []);
  return now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !clock24h });
}
