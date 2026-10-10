import { useEffect, useMemo, useState } from "react";
import CompanionApi from "./Api/CompanionApi";
import RemoteConnection from "./Api/RemoteConnection";
import useController from "../app/lib/useController";
import Icon, { type IconName } from "../app/components/Icon/Icon";
import Pair from "./components/Pair/Pair";
import RemoteTab from "./components/RemoteTab/RemoteTab";
import TrackpadTab from "./components/TrackpadTab/TrackpadTab";
import KeyboardTab from "./components/KeyboardTab/KeyboardTab";
import AppsTab from "./components/AppsTab/AppsTab";

type Tab = "remote" | "trackpad" | "keyboard" | "apps";
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: "remote", label: "Remote", icon: "dpad" },
  { id: "trackpad", label: "Trackpad", icon: "mouse" },
  { id: "keyboard", label: "Keyboard", icon: "keyboard" },
  { id: "apps", label: "Apps", icon: "grid" },
];
const TAB_KEY = "mediahub.tab";

/**
 * Pairing code from the hub's QR code (`/?pair=123456`). Read once and removed from the address bar, since the code
 * only works once and shouldn't end up in a bookmark or the home screen shortcut.
 */
const QR_PAIRING_CODE = new URLSearchParams(location.search).get("pair");
if (QR_PAIRING_CODE !== null) history.replaceState(null, "", location.pathname);

/**
 * The phone companion: pairing, then a remote, trackpad, keyboard and app manager for the hub.
 */
export default function CompanionApp() {
  const [paired, setPaired] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    CompanionApi.isPaired().then(setPaired).catch(() => setError("Can't reach MediaHub. Is the TV box on?"));
  }, []);

  if (error) return <div className="companion__message">{error}</div>;
  if (paired === null) return <div className="companion__message">Connecting…</div>;
  if (!paired) return <Pair initialCode={QR_PAIRING_CODE} onPaired={() => setPaired(true)} />;
  return <Remote onUnpaired={() => setPaired(false)} />;
}

function Remote(props: { onUnpaired: () => void }) {
  const { onUnpaired } = props;
  const connection = useController(useMemo(() => new RemoteConnection(), []));
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem(TAB_KEY) as Tab) || "remote";
    } catch {
      return "remote";
    }
  });

  useEffect(() => {
    connection.onUnpaired = onUnpaired;
    connection.connect();
    return () => connection.disconnect();
  }, [connection]);

  const selectTab = (next: Tab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      // Private mode; the tab just isn't remembered
    }
  };

  const state = connection.state;
  const focused = state?.running.find(r => r.appId === state.focusedAppId);
  return (
    <div className="companion">
      <header className="companion__header">
        <span className={`companion__dot ${connection.connected ? "is-on" : ""}`} />
        <span className="companion__title">{focused ? focused.app.name : "MediaHub"}</span>
        <span className="companion__subtitle">{connection.connected ? (focused ? "On the TV now" : "Home screen") : "Reconnecting…"}</span>
      </header>
      <main className="companion__main">
        {tab === "remote" && <RemoteTab connection={connection} />}
        {tab === "trackpad" && <TrackpadTab connection={connection} />}
        {tab === "keyboard" && <KeyboardTab connection={connection} />}
        {tab === "apps" && <AppsTab connection={connection} />}
      </main>
      <nav className="companion__nav">
        {TABS.map(t => (
          <button key={t.id} className={`companion__tab ${tab === t.id ? "is-active" : ""}`} onClick={() => selectTab(t.id)}>
            <Icon name={t.icon} size="1.4rem" />
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
