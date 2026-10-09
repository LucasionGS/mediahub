import "./AppActions.scss";
import Icon, { type IconName } from "../Icon/Icon";
import type { HubApp, RunningApp } from "../../../shared/types";

export type AppAction = "start" | "options" | "close" | "add";

export interface AppActionsProps {
  app: HubApp | null; // null = the "Add apps" tile
  running: RunningApp | null;
  actions: AppAction[];
  focusedIndex: number | null;
  onHover: (index: number) => void;
  onActivate: (action: AppAction) => void;
}

const LABELS: Record<AppAction, { label: string; icon: IconName }> = {
  start: { label: "Start", icon: "play" },
  options: { label: "", icon: "more" },
  close: { label: "Close", icon: "close" },
  add: { label: "Add apps", icon: "plus" },
};

/**
 * The focused app's details and buttons, under the tile row.
 */
export default function AppActions(props: AppActionsProps) {
  const { app, running, actions, focusedIndex, onHover, onActivate } = props;

  let subtitle: string;
  if (!app) subtitle = "Pick installed apps or web apps to put on the home screen.";
  else if (running && !running.hasWindow) subtitle = "Starting…";
  else if (running) subtitle = "Running";
  else if (app.temporary) subtitle = "Opened from your phone";
  else subtitle = app.type === "web" ? new URL(app.url ?? "https://localhost").hostname.replace(/^www\./, "") : "App";

  return (
    <div className="app-actions" key={app?.appId ?? "add"}>
      <div className="app-actions__title">{app?.name ?? "Your apps"}</div>
      <div className="app-actions__subtitle">
        {app?.type === "web" && <Icon name="globe" size="1.1rem" />}
        {subtitle}
      </div>
      <div className="app-actions__buttons">
        {actions.map((action, i) => {
          const { label, icon } = LABELS[action];
          const text = action === "start" && running ? "Resume" : label;
          return (
            <button
              key={action}
              className={`hub-button hub-focusable ${!text ? "hub-button--icon" : ""} ${focusedIndex === i ? "is-focused" : ""}`}
              onMouseEnter={() => onHover(i)}
              onClick={() => onActivate(action)}
              aria-label={text || "Options"}
            >
              <Icon name={icon} size="1.3rem" />
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
