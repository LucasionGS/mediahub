import { useState } from "react";
import CompanionApi from "../../Api/CompanionApi";
import Icon from "../../../app/components/Icon/Icon";
import { TV_USER_AGENT } from "../../../shared/presets";
import type { HubApp, HubAppInput } from "../../../shared/types";

export interface AppEditorProps {
  app: HubApp | null; // null = new website
  onDone: () => void;
}

type ArtworkKind = "icon" | "cover" | "background";
const ARTWORK: { kind: ArtworkKind; label: string; hint: string }[] = [
  { kind: "cover", label: "Tile art", hint: "Square image shown on the tile." },
  { kind: "background", label: "Background", hint: "Wide image shown behind the home screen." },
  { kind: "icon", label: "Icon", hint: "Used when there's no tile art." },
];

/**
 * Edit an app (name, address or command, browser options, artwork) or add a new website.
 */
export default function AppEditor(props: AppEditorProps) {
  const { app, onDone } = props;
  const isWeb = app ? app.type === "web" : true;
  const [name, setName] = useState(app?.name ?? "");
  const [url, setUrl] = useState(app?.url ?? "https://");
  const [command, setCommand] = useState(app?.command ?? "");
  const [tvMode, setTvMode] = useState(app?.userAgent === TV_USER_AGENT);
  const [external, setExternal] = useState(app?.browser === "external");
  const [gamepadKeys, setGamepadKeys] = useState(app?.gamepadKeys !== false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const fields: Partial<HubAppInput> = isWeb
      ? { name, url, userAgent: tvMode ? TV_USER_AGENT : null, browser: external ? "external" : "builtin", gamepadKeys }
      : { name, command };
    try {
      if (app) await CompanionApi.updateApp(app.appId, fields);
      else await CompanionApi.addApp({ type: "web", ...fields } as HubAppInput);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (kind: ArtworkKind, file: File | undefined) => {
    if (!app || !file) return;
    setError(null);
    try {
      await CompanionApi.uploadArtwork(app.appId, kind, file);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeArtwork = async (kind: ArtworkKind) => {
    if (!app) return;
    try {
      await CompanionApi.removeArtwork(app.appId, kind);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async () => {
    if (!app) return;
    try {
      await CompanionApi.removeApp(app.appId);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className="editor" onSubmit={save}>
      <div className="c-row">
        <button type="button" className="c-icon-button" onClick={onDone} aria-label="Back"><Icon name="arrowLeft" /></button>
        <div className="editor__title">{app ? `Edit ${app.name}` : "Add a website"}</div>
      </div>

      <label className="c-field">
        <span className="c-label">Name</span>
        <input className="c-input" value={name} onChange={event => setName(event.target.value)} required />
      </label>

      {isWeb ? (
        <>
          <label className="c-field">
            <span className="c-label">Address</span>
            <input className="c-input" type="url" inputMode="url" value={url} onChange={event => setUrl(event.target.value)} required />
          </label>
          <label className="c-check">
            <input type="checkbox" checked={tvMode} onChange={event => setTvMode(event.target.checked)} />
            <span>Ask for the TV version of the site<small>Needed for YouTube's TV interface.</small></span>
          </label>
          <label className="c-check">
            <input type="checkbox" checked={gamepadKeys} onChange={event => setGamepadKeys(event.target.checked)} />
            <span>Control with a gamepad<small>The D-pad and A/B buttons act as arrow keys, Enter and Escape. Turn off for sites with their own gamepad support.</small></span>
          </label>
          <label className="c-check">
            <input type="checkbox" checked={external} onChange={event => setExternal(event.target.checked)} />
            <span>Open in Chromium or Chrome<small>For sites with DRM, like Netflix or Disney+.</small></span>
          </label>
        </>
      ) : (
        <label className="c-field">
          <span className="c-label">Command</span>
          <input className="c-input c-input--mono" value={command} onChange={event => setCommand(event.target.value)} required />
        </label>
      )}

      {error && <div className="c-error">{error}</div>}
      <button className="c-button c-button--primary c-button--wide" disabled={busy}>{app ? "Save" : "Add to home screen"}</button>

      {app && (
        <>
          <div className="c-heading">Artwork</div>
          {ARTWORK.map(({ kind, label, hint }) => {
            const current = CompanionApi.assetUrl(app[kind]);
            return (
              <div key={kind} className="editor__artwork">
                <span className={`editor__preview editor__preview--${kind}`}>
                  {current ? <img src={current} alt="" /> : <Icon name="image" />}
                </span>
                <span className="editor__art-text">{label}<small>{hint}</small></span>
                <label className="c-button">
                  Choose
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden onChange={event => upload(kind, event.target.files?.[0])} />
                </label>
                {current && <button type="button" className="c-icon-button" onClick={() => removeArtwork(kind)} aria-label="Remove"><Icon name="trash" /></button>}
              </div>
            );
          })}

          <div className="c-heading">Remove</div>
          {confirmRemove ? (
            <div className="c-row">
              <button type="button" className="c-button c-button--danger" onClick={remove}>Yes, remove {app.name}</button>
              <button type="button" className="c-button" onClick={() => setConfirmRemove(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="c-button c-button--danger" onClick={() => setConfirmRemove(true)}>Remove from home screen</button>
          )}
        </>
      )}
    </form>
  );
}
