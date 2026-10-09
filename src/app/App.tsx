import { useEffect } from "react";
import MediaHub from "./MediaHub";
import useController from "./lib/useController";
import Sounds from "./lib/sounds";
import Home from "./components/Home/Home";
import QuickMenu from "./components/QuickMenu/QuickMenu";
import Toasts from "./components/Toasts/Toasts";

export default function App() {
  const hub = useController(MediaHub.hub);
  const state = hub.state;

  useEffect(() => {
    document.body.classList.add(`view-${MediaHub.view}`);
    MediaHub.hub.init();
    MediaHub.input.start(() => MediaHub.api.toggleQuickMenu(), () => MediaHub.hub.state?.input.helper ?? false);
    return MediaHub.api.onToast(({ message, type }) => MediaHub.toasts.add(message, type));
  }, []);

  useEffect(() => {
    if (!state) return;
    Sounds.setEnabled(state.settings.uiSounds);
    // Only the window that's actually in front reacts to the controller
    MediaHub.input.setEnabled(MediaHub.view === "overlay" ? state.quickMenuOpen : state.hubFocused && !state.quickMenuOpen);
  }, [state]);

  if (!state) return null;
  return (
    <>
      {MediaHub.view === "overlay" ? <QuickMenu /> : <Home />}
      <Toasts />
    </>
  );
}
