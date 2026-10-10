import "./Home.scss";
import { useEffect, useMemo, useState } from "react";
import MediaHub from "../../MediaHub";
import useController from "../../lib/useController";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";
import HeroBackground from "../HeroBackground/HeroBackground";
import TopBar, { getTopBarItems, type TopBarItem } from "../TopBar/TopBar";
import TileRow from "../TileRow/TileRow";
import AppActions, { type AppAction } from "../AppActions/AppActions";
import SideMenu, { type SideMenuItem } from "../SideMenu/SideMenu";
import ConfirmDialog from "../Dialog/ConfirmDialog";
import PowerMenu from "../PowerMenu/PowerMenu";
import AppPicker from "../AppPicker/AppPicker";
import SettingsPage from "../SettingsPage/SettingsPage";
import Hints from "../Hints/Hints";
import type { HubApp } from "../../../shared/types";

type Zone = "top" | "tiles" | "actions";
type Overlay = null | "options" | "power" | "picker" | "settings" | "remove";

/**
 * The home screen: tile row, the focused app's details, and the top bar.
 */
export default function Home() {
  const hub = useController(MediaHub.hub);
  const state = hub.state!;
  const tiles = hub.getTiles();
  const [zone, setZone] = useState<Zone>("tiles");
  const [tileIndex, setTileIndex] = useState(0);
  const [actionIndex, setActionIndex] = useState(0);
  const [topItem, setTopItem] = useState<TopBarItem>("settings");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [moving, setMoving] = useState(false);

  // The "Add apps" tile sits after the last app
  const index = Math.min(tileIndex, tiles.length);
  const focusedApp: HubApp | null = tiles[index] ?? null;
  const running = focusedApp ? hub.getRunning(focusedApp.appId) : null;
  const runningIds = useMemo(() => new Set(state.running.map(r => r.appId)), [state.running]);
  const actions: AppAction[] = focusedApp ? ["start", "options", ...(running ? ["close" as const] : [])] : ["add"];
  const actionFocus = Math.min(actionIndex, actions.length - 1);
  // Focus follows the button rather than its position, since the update button comes and goes
  const topItems = getTopBarItems(state);
  const topIndex = Math.max(0, topItems.indexOf(topItem));
  const [settingsUpdate, setSettingsUpdate] = useState(false); // Settings opened from the update button

  useEffect(() => setActionIndex(0), [focusedApp?.appId]);

  const start = (app: HubApp) => {
    Sounds.select();
    MediaHub.run(() => running ? MediaHub.api.focus(app.appId) : MediaHub.api.launch(app.appId));
  };

  const activateTile = (i: number) => {
    const app = tiles[i];
    if (!app) {
      Sounds.select();
      return setOverlay("picker");
    }
    start(app);
  };

  const activateAction = (action: AppAction) => {
    if (action === "add") {
      Sounds.select();
      return setOverlay("picker");
    }
    if (!focusedApp) return;
    if (action === "start") return start(focusedApp);
    if (action === "options") {
      Sounds.open();
      return setOverlay("options");
    }
    if (action === "close") {
      Sounds.select();
      MediaHub.run(() => MediaHub.api.close(focusedApp.appId));
    }
  };

  const activateTop = (item: TopBarItem) => {
    Sounds.open();
    setSettingsUpdate(item === "update");
    setOverlay(item === "update" ? "settings" : item);
  };

  const moveTile = (direction: -1 | 1) => {
    if (!focusedApp) return;
    const target = index + direction;
    // Only library apps can move, and the "Add apps" tile stays last
    if (target < 0 || target >= state.apps.length) return Sounds.bump();
    Sounds.move();
    setTileIndex(target);
    MediaHub.run(() => MediaHub.api.moveApp(focusedApp.appId, target));
  };

  useInputLayer(action => {
    if (moving) {
      if (action === "left" || action === "right") moveTile(action === "left" ? -1 : 1);
      else if (action === "confirm" || action === "back") {
        Sounds.select();
        setMoving(false);
      }
      return;
    }

    if (zone === "tiles") {
      if (action === "left" || action === "right") {
        const next = index + (action === "left" ? -1 : 1);
        if (next < 0 || next > tiles.length) return Sounds.bump();
        Sounds.move();
        setTileIndex(next);
      }
      else if (action === "down") {
        Sounds.move();
        setZone("actions");
      }
      else if (action === "up") {
        Sounds.move();
        setZone("top");
      }
      else if (action === "confirm") activateTile(index);
      else if (action === "options" && focusedApp) {
        Sounds.open();
        setOverlay("options");
      }
    }
    else if (zone === "actions") {
      if (action === "left" || action === "right") {
        const next = actionFocus + (action === "left" ? -1 : 1);
        if (next < 0 || next >= actions.length) return Sounds.bump();
        Sounds.move();
        setActionIndex(next);
      }
      else if (action === "up" || action === "back") {
        Sounds.move();
        setZone("tiles");
      }
      else if (action === "confirm") activateAction(actions[actionFocus]);
      else if (action === "options" && focusedApp) {
        Sounds.open();
        setOverlay("options");
      }
    }
    else if (zone === "top") {
      if (action === "left" || action === "right") {
        const next = topIndex + (action === "left" ? -1 : 1);
        if (next < 0 || next >= topItems.length) return Sounds.bump();
        Sounds.move();
        setTopItem(topItems[next]);
      }
      else if (action === "down" || action === "back") {
        Sounds.move();
        setZone("tiles");
      }
      else if (action === "confirm") activateTop(topItems[topIndex]);
    }
    if (action === "menu") {
      Sounds.open();
      MediaHub.api.toggleQuickMenu();
    }
  }, overlay === null);

  const optionItems: SideMenuItem[] = [];
  if (focusedApp) {
    optionItems.push({ label: running ? "Resume" : "Start", icon: "play", onSelect: () => { setOverlay(null); start(focusedApp); } });
    if (running) optionItems.push({ label: "Close app", icon: "close", onSelect: () => { setOverlay(null); MediaHub.run(() => MediaHub.api.close(focusedApp.appId)); } });
    if (!focusedApp.temporary) {
      optionItems.push({ label: "Move", icon: "move", onSelect: () => { setOverlay(null); setZone("tiles"); setMoving(true); } });
      optionItems.push({ label: "Remove from home", icon: "trash", danger: true, onSelect: () => setOverlay("remove") });
    }
  }

  return (
    <div className="home">
      <HeroBackground app={focusedApp} />
      <TopBar
        focusedIndex={zone === "top" && !overlay ? topIndex : null}
        onHover={i => { setZone("top"); setTopItem(topItems[i]); }}
        onActivate={activateTop}
      />
      <div className="home__content">
        <TileRow
          tiles={tiles}
          index={index}
          focused={zone === "tiles"}
          moving={moving}
          runningIds={runningIds}
          onHover={i => { if (!moving) { setZone("tiles"); setTileIndex(i); } }}
          onActivate={activateTile}
        />
        <AppActions
          app={focusedApp}
          running={running}
          actions={actions}
          focusedIndex={zone === "actions" ? actionFocus : null}
          onHover={i => { setZone("actions"); setActionIndex(i); }}
          onActivate={activateAction}
        />
      </div>
      {!overlay && (
        <Hints hints={moving ? [["←→", "Move"], ["A", "Done"]] : [["A", running ? "Resume" : "Start"], ["Y", "Options"], ["☰", "Quick menu"]]} />
      )}

      {overlay === "options" && focusedApp && (
        <SideMenu
          title={focusedApp.name}
          subtitle={focusedApp.type === "web" ? focusedApp.url : focusedApp.command}
          items={optionItems}
          footer={state.companion.url ? `Edit names, links and artwork from your phone at ${state.companion.url}` : undefined}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "remove" && focusedApp && (
        <ConfirmDialog
          title={`Remove ${focusedApp.name}?`}
          message="It will be taken off the home screen. You can add it again from Add apps."
          confirmLabel="Remove"
          danger
          onCancel={() => setOverlay("options")}
          onConfirm={() => {
            setOverlay(null);
            MediaHub.run(() => MediaHub.api.removeApp(focusedApp.appId));
          }}
        />
      )}
      {overlay === "power" && <PowerMenu onClose={() => setOverlay(null)} />}
      {overlay === "picker" && <AppPicker onClose={() => setOverlay(null)} />}
      {overlay === "settings" && (
        <SettingsPage
          initialSection={settingsUpdate ? "updates" : undefined}
          startUpdate={settingsUpdate}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}
