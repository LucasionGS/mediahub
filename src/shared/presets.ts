import type { HubAppInput } from "./types";

export interface WebPreset {
  id: string;
  app: HubAppInput;
  note?: string;
}

/**
 * Smart-TV user agent that makes youtube.com/tv serve its TV interface instead of redirecting to desktop.
 */
export const TV_USER_AGENT = "Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1";

/**
 * Web apps offered in the app picker.
 */
export const WEB_PRESETS: WebPreset[] = [
  {
    id: "youtube-tv",
    app: { type: "web", name: "YouTube", url: "https://www.youtube.com/tv", userAgent: TV_USER_AGENT, browser: "builtin", gamepadKeys: true, accentColor: "#ff0033" },
  },
  {
    id: "cinemion",
    app: { type: "web", name: "Cinemion", url: "http://localhost:8600/?mode=tv", userAgent: null, browser: "builtin", gamepadKeys: true, accentColor: "#5b9dff" },
    note: "Change the server address from the phone companion if Cinemion isn't on this machine.",
  },
  {
    id: "jellyfin",
    app: { type: "web", name: "Jellyfin", url: "http://localhost:8096/web/", userAgent: null, browser: "builtin", gamepadKeys: true, accentColor: "#aa5cc3" },
    note: "Change the server address from the phone companion if Jellyfin isn't on this machine.",
  },
  {
    id: "plex",
    app: { type: "web", name: "Plex", url: "https://app.plex.tv/desktop", userAgent: null, browser: "builtin", gamepadKeys: true, accentColor: "#e5a00d" },
  },
  {
    id: "twitch",
    app: { type: "web", name: "Twitch", url: "https://www.twitch.tv", userAgent: null, browser: "builtin", gamepadKeys: true, accentColor: "#9146ff" },
  },
  {
    id: "netflix",
    app: { type: "web", name: "Netflix", url: "https://www.netflix.com", userAgent: null, browser: "external", gamepadKeys: false, accentColor: "#e50914" },
    note: "Opens in Chromium or Chrome, since Netflix needs DRM.",
  },
  {
    id: "disney",
    app: { type: "web", name: "Disney+", url: "https://www.disneyplus.com", userAgent: null, browser: "external", gamepadKeys: false, accentColor: "#113ccf" },
    note: "Opens in Chromium or Chrome, since Disney+ needs DRM.",
  },
];
