import { useEffect, useState } from "react";
import CompanionApi from "../../Api/CompanionApi";
import type RemoteConnection from "../../Api/RemoteConnection";
import useController from "../../../app/lib/useController";
import Icon from "../../../app/components/Icon/Icon";
import AppEditor from "../AppEditor/AppEditor";
import { tick } from "../../haptics";
import type { DesktopEntry, HubApp } from "../../../shared/types";
import type { WebPreset } from "../../../shared/presets";

export interface AppsTabProps {
  connection: RemoteConnection;
}

type View = { kind: "list" } | { kind: "edit"; appId: number } | { kind: "new-web" } | { kind: "add-installed" };

/**
 * Open links on the TV, switch between running apps, and manage the home screen.
 */
export default function AppsTab(props: AppsTabProps) {
  const connection = useController(props.connection);
  const state = connection.state;
  const [view, setView] = useState<View>({ kind: "list" });
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  if (!state) return <div className="c-note">Connecting…</div>;

  if (view.kind === "edit") {
    // Falls through to the list if the app was removed meanwhile
    const app = state.apps.find(a => a.appId === view.appId);
    if (app) return <AppEditor app={app} onDone={() => setView({ kind: "list" })} />;
  }
  if (view.kind === "new-web") return <AppEditor app={null} onDone={() => setView({ kind: "list" })} />;
  if (view.kind === "add-installed") return <InstalledPicker apps={state.apps} onDone={() => setView({ kind: "list" })} />;

  const openLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    if (await run(() => CompanionApi.openUrl(link))) setLink("");
    setBusy(false);
  };

  return (
    <div className="apps">
      <form className="apps__link" onSubmit={openLink}>
        <div className="c-label"><Icon name="link" size="1rem" /> Open a link on the TV</div>
        <div className="c-row">
          <input className="c-input" type="url" inputMode="url" placeholder="https://youtu.be/…" value={link} onChange={event => setLink(event.target.value)} />
          <button className="c-button c-button--primary" disabled={!link || busy}>Open</button>
        </div>
      </form>
      {error && <div className="c-error">{error}</div>}

      {state.running.length > 0 && (
        <section>
          <div className="c-heading">Running</div>
          {state.running.map(r => (
            <div key={r.appId} className="apps__item">
              <AppIcon app={r.app} />
              <span className="apps__name">{r.app.name}{r.appId === state.focusedAppId && <small>On screen</small>}</span>
              <button className="c-button" onClick={() => { tick(); run(() => CompanionApi.focus(r.appId)); }}>Show</button>
              <button className="c-icon-button" onClick={() => run(() => CompanionApi.close(r.appId))} aria-label="Close"><Icon name="close" /></button>
            </div>
          ))}
        </section>
      )}

      <section>
        <div className="c-heading">Home screen</div>
        {state.apps.map((app, i) => (
          <div key={app.appId} className="apps__item">
            <AppIcon app={app} />
            <button className="apps__name" onClick={() => setView({ kind: "edit", appId: app.appId })}>
              {app.name}
              <small>{app.type === "web" ? app.url : app.command}</small>
            </button>
            <button className="c-icon-button" disabled={i === 0} onClick={() => run(() => CompanionApi.moveApp(app.appId, i - 1))} aria-label="Move left"><Icon name="chevronUp" /></button>
            <button className="c-icon-button" disabled={i === state.apps.length - 1} onClick={() => run(() => CompanionApi.moveApp(app.appId, i + 1))} aria-label="Move right"><Icon name="chevronDown" /></button>
            <button className="c-icon-button" onClick={() => { tick(); run(() => CompanionApi.launch(app.appId)); }} aria-label="Start"><Icon name="play" /></button>
          </div>
        ))}
        <div className="c-row apps__add">
          <button className="c-button" onClick={() => setView({ kind: "new-web" })}><Icon name="globe" size="1.1rem" /> Add website</button>
          <button className="c-button" onClick={() => setView({ kind: "add-installed" })}><Icon name="plus" size="1.1rem" /> Add installed app</button>
        </div>
      </section>
    </div>
  );
}

/**
 * The app's icon, or its first letter on its accent colour.
 */
export function AppIcon(props: { app: HubApp }) {
  const { app } = props;
  const icon = CompanionApi.assetUrl(app.icon);
  return (
    <span className="app-icon" style={{ background: icon ? undefined : app.accentColor ?? undefined }}>
      {icon ? <img src={icon} alt="" /> : app.name.slice(0, 1)}
    </span>
  );
}

function InstalledPicker(props: { apps: HubApp[]; onDone: () => void }) {
  const { apps, onDone } = props;
  const [entries, setEntries] = useState<DesktopEntry[] | null>(null);
  const [presets, setPresets] = useState<WebPreset[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    CompanionApi.getDesktopEntries().then(setEntries).catch(err => setError(err.message));
    CompanionApi.getPresets().then(setPresets).catch(() => undefined);
  }, []);

  const added = new Set(apps.map(a => a.desktopFile ?? a.url));
  const q = query.trim().toLowerCase();
  const filtered = (entries ?? []).filter(e => !q || e.name.toLowerCase().includes(q));

  const add = async (input: Parameters<typeof CompanionApi.addApp>[0]) => {
    try {
      await CompanionApi.addApp(input);
      tick();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="apps">
      <div className="c-row">
        <button className="c-icon-button" onClick={onDone} aria-label="Back"><Icon name="arrowLeft" /></button>
        <input className="c-input" placeholder="Search installed apps" value={query} onChange={event => setQuery(event.target.value)} />
      </div>
      {error && <div className="c-error">{error}</div>}
      {!q && presets.length > 0 && (
        <section>
          <div className="c-heading">Web apps</div>
          {presets.map(preset => (
            <div key={preset.id} className="apps__item">
              <span className="app-icon" style={{ background: preset.app.accentColor ?? undefined }}>{preset.app.name.slice(0, 1)}</span>
              <span className="apps__name">{preset.app.name}<small>{preset.note ?? preset.app.url}</small></span>
              {added.has(preset.app.url) ? <Icon name="check" /> : <button className="c-button" onClick={() => add(preset.app)}>Add</button>}
            </div>
          ))}
        </section>
      )}
      <section>
        <div className="c-heading">Installed apps</div>
        {entries === null && <div className="c-note">Loading…</div>}
        {filtered.map(entry => (
          <div key={entry.id} className="apps__item">
            <span className="app-icon">{entry.icon ? <img src={CompanionApi.assetUrl(entry.icon)!} alt="" /> : entry.name.slice(0, 1)}</span>
            <span className="apps__name">{entry.name}<small>{entry.comment}</small></span>
            {added.has(entry.path)
              ? <Icon name="check" />
              : <button className="c-button" onClick={() => add({ type: "desktop", name: entry.name, command: entry.command, desktopFile: entry.path, icon: entry.icon })}>Add</button>}
          </div>
        ))}
      </section>
    </div>
  );
}
