import "./QuickMenu.scss";
import { useEffect, useState } from "react";
import MediaHub from "../../MediaHub";
import useController from "../../lib/useController";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";
import AppTile from "../AppTile/AppTile";
import Icon, { type IconName } from "../Icon/Icon";
import Hints from "../Hints/Hints";
import PowerMenu from "../PowerMenu/PowerMenu";
import type { RunningApp } from "../../../shared/types";

type Control = "volume-down" | "volume-up" | "mute" | "power";
const CONTROLS: { id: Control; icon: IconName; label: string }[] = [
  { id: "volume-down", icon: "minus", label: "Volume down" },
  { id: "volume-up", icon: "plus", label: "Volume up" },
  { id: "mute", icon: "volumeMute", label: "Mute" },
  { id: "power", icon: "power", label: "Power" },
];

/**
 * The quick menu, drawn by the overlay window on top of whatever app is running: switch or close apps,
 * go home, change the volume or power off. Opened with a tap on the Guide button.
 */
export default function QuickMenu() {
  const state = useController(MediaHub.hub).state!;
  const open = state.quickMenuOpen;
  if (!open) return null;
  return <QuickMenuPanel />;
}

function QuickMenuPanel() {
  const state = useController(MediaHub.hub).state!;
  const running = state.running;
  const [row, setRow] = useState<"cards" | "controls">("cards");
  const [cardIndex, setCardIndex] = useState(() => {
    // Start on the app that's in front, or on Home
    const i = running.findIndex(r => r.appId === state.focusedAppId);
    return i === -1 ? 0 : i + 1;
  });
  const [controlIndex, setControlIndex] = useState(0);
  const [powerOpen, setPowerOpen] = useState(false);

  // Card 0 is Home, then one per running app
  const cardCount = running.length + 1;
  const card = Math.min(cardIndex, cardCount - 1);
  const focusedRunning: RunningApp | null = card > 0 ? running[card - 1] : null;

  useEffect(() => Sounds.open(), []);

  const close = () => {
    Sounds.back();
    MediaHub.api.setQuickMenu(false);
  };

  const activateCard = (i: number) => {
    Sounds.select();
    if (i === 0) MediaHub.api.goHome();
    else MediaHub.run(() => MediaHub.api.focus(running[i - 1].appId));
  };

  const activateControl = (control: Control) => {
    const volume = state.volume.volume;
    if (control === "volume-down") MediaHub.run(() => MediaHub.api.setVolume(volume - 0.05));
    else if (control === "volume-up") MediaHub.run(() => MediaHub.api.setVolume(volume + 0.05));
    else if (control === "mute") MediaHub.run(() => MediaHub.api.toggleMute());
    else if (control === "power") {
      Sounds.open();
      return setPowerOpen(true);
    }
    Sounds.move();
  };

  useInputLayer(action => {
    if (action === "back" || action === "menu") return close();
    if (row === "cards") {
      if (action === "left" || action === "right") {
        const next = card + (action === "left" ? -1 : 1);
        if (next < 0 || next >= cardCount) return Sounds.bump();
        Sounds.move();
        setCardIndex(next);
      }
      else if (action === "down") {
        Sounds.move();
        setRow("controls");
      }
      else if (action === "confirm") activateCard(card);
      else if (action === "options" && focusedRunning) {
        Sounds.select();
        MediaHub.run(() => MediaHub.api.close(focusedRunning.appId));
      }
    }
    else {
      if (action === "left" || action === "right") {
        const next = controlIndex + (action === "left" ? -1 : 1);
        if (next < 0 || next >= CONTROLS.length) return Sounds.bump();
        Sounds.move();
        setControlIndex(next);
      }
      else if (action === "up") {
        Sounds.move();
        setRow("cards");
      }
      else if (action === "confirm") activateControl(CONTROLS[controlIndex].id);
    }
  }, !powerOpen);

  const volume = Math.round(state.volume.volume * 100);
  return (
    <div className="quick-menu" onClick={close}>
      <div className="quick-menu__panel" onClick={event => event.stopPropagation()}>
        <div className="quick-menu__heading">
          {focusedRunning ? focusedRunning.app.name : "Home"}
          <span className="quick-menu__sub">
            {focusedRunning ? (focusedRunning.appId === state.focusedAppId ? "On screen now" : "Running in the background") : "Go to the home screen"}
          </span>
        </div>
        <div className="quick-menu__cards">
          <AppTile
            app={null}
            icon="home"
            label="Home"
            focused={row === "cards" && card === 0}
            onMouseEnter={() => { setRow("cards"); setCardIndex(0); }}
            onClick={() => activateCard(0)}
          />
          {running.map((r, i) => (
            <AppTile
              key={r.appId}
              app={r.app}
              label={r.app.name}
              running={r.appId === state.focusedAppId}
              focused={row === "cards" && card === i + 1}
              onMouseEnter={() => { setRow("cards"); setCardIndex(i + 1); }}
              onClick={() => activateCard(i + 1)}
            />
          ))}
        </div>
        <div className="quick-menu__controls">
          {CONTROLS.map((control, i) => (
            <button
              key={control.id}
              className={`quick-menu__control hub-focusable ${row === "controls" && i === controlIndex ? "is-focused" : ""}`}
              onMouseEnter={() => { setRow("controls"); setControlIndex(i); }}
              onClick={() => activateControl(control.id)}
              aria-label={control.label}
            >
              <Icon name={control.id === "mute" && state.volume.muted ? "volume" : control.icon} />
            </button>
          ))}
          <div className="quick-menu__volume">
            <Icon name={state.volume.muted ? "volumeMute" : "volume"} size="1.2rem" />
            <span className="quick-menu__bar"><span style={{ width: `${state.volume.muted ? 0 : volume}%` }} /></span>
            <span className="quick-menu__percent">{state.volume.muted ? "Muted" : `${volume}%`}</span>
          </div>
        </div>
      </div>
      {!powerOpen && <Hints hints={focusedRunning && row === "cards" ? [["A", "Switch to"], ["Y", "Close app"], ["B", "Back"]] : [["A", "Select"], ["B", "Back"]]} />}
      {powerOpen && <PowerMenu onClose={() => setPowerOpen(false)} />}
    </div>
  );
}
