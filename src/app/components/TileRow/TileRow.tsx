import "./TileRow.scss";
import type { CSSProperties } from "react";
import AppTile from "../AppTile/AppTile";
import type { HubApp } from "../../../shared/types";

export interface TileRowProps {
  tiles: HubApp[];
  index: number; // Focused tile; tiles.length = the "Add apps" tile
  focused: boolean;
  moving: boolean;
  runningIds: Set<number>;
  onHover: (index: number) => void;
  onActivate: (index: number) => void;
}

/**
 * The home screen's horizontal row of app tiles. The focused tile stays in the same spot and the row slides
 * underneath it, with the focused app's name shown beside it.
 */
export default function TileRow(props: TileRowProps) {
  const { tiles, index, focused, moving, runningIds, onHover, onActivate } = props;
  const focusedApp = tiles[index] ?? null;

  return (
    <div className={`tile-row ${focused ? "is-active" : ""}`}>
      <div className="tile-row__track" style={{ "--tile-row-index": index } as CSSProperties}>
        {tiles.map((app, i) => (
          <AppTile
            key={app.appId}
            app={app}
            focused={focused && i === index}
            running={runningIds.has(app.appId)}
            moving={moving && i === index}
            className={i === index ? "tile-row__tile is-current" : "tile-row__tile"}
            onMouseEnter={() => onHover(i)}
            onClick={() => onActivate(i)}
          />
        ))}
        <AppTile
          app={null}
          icon="grid"
          focused={focused && index === tiles.length}
          className={index === tiles.length ? "tile-row__tile is-current" : "tile-row__tile"}
          onMouseEnter={() => onHover(tiles.length)}
          onClick={() => onActivate(tiles.length)}
        />
      </div>
      <div className="tile-row__name" key={focusedApp?.appId ?? "add"}>
        {focusedApp ? focusedApp.name : "Add apps"}
      </div>
    </div>
  );
}
