import "./AppTile.scss";
import type { CSSProperties } from "react";
import { assetUrl } from "../../lib/assets";
import { useAccentColor } from "../../lib/color";
import Icon, { type IconName } from "../Icon/Icon";
import type { HubApp } from "../../../shared/types";

export interface AppTileProps {
  app: HubApp | null; // null = a special tile, drawn with `icon`
  icon?: IconName;
  label?: string;
  focused?: boolean;
  running?: boolean;
  moving?: boolean;
  className?: string;
  onMouseEnter?: () => void;
  onClick?: () => void;
}

/**
 * A square app tile: the app's cover art, or its icon on a gradient of its accent colour.
 */
export default function AppTile(props: AppTileProps) {
  const { app, icon = "plus", label, focused = false, running = false, moving = false, className, onMouseEnter, onClick } = props;
  const accent = useAccentColor(app);
  const cover = assetUrl(app?.cover);
  const iconUrl = assetUrl(app?.icon);

  const classes = ["app-tile", "hub-focusable", focused && "is-focused", moving && "is-moving", !app && "app-tile--special", className].filter(Boolean).join(" ");
  return (
    <button
      className={classes}
      style={{ "--app-tile-accent": accent } as CSSProperties}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
    >
      {cover ? (
        <img className="app-tile__cover" src={cover} alt="" draggable={false} />
      ) : app ? (
        iconUrl ? <img className="app-tile__icon" src={iconUrl} alt="" draggable={false} /> : <span className="app-tile__initial">{app.name.slice(0, 1)}</span>
      ) : (
        <Icon name={icon} size="40%" />
      )}
      {running && <span className="app-tile__running" />}
      {moving && <span className="app-tile__move"><Icon name="move" size="1.6rem" /></span>}
      {label && <span className="app-tile__label">{label}</span>}
    </button>
  );
}
