import type { DesktopEntry, HubApp, HubAppInput, HubState, VolumeInfo } from "../../shared/types";
import type { WebPreset } from "../../shared/presets";

/**
 * Client for the hub's `/api`. Every call throws an `Error` with the hub's message when it fails.
 */
export namespace CompanionApi {
  /**
   * Thrown when this phone isn't paired (or was unpaired).
   */
  export class UnpairedError extends Error { }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body instanceof Blob ? { "Content-Type": body.type } : body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new UnpairedError(data.message || "Not paired.");
    if (!res.ok) throw new Error(data.message || res.statusText);
    return data as T;
  }

  export const GET = <T>(path: string) => request<T>("GET", path);
  export const POST = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
  export const PATCH = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);
  export const PUT = <T>(path: string, body: Blob) => request<T>("PUT", path, body);
  export const DELETE = <T>(path: string) => request<T>("DELETE", path);

  export async function isPaired() {
    return (await GET<{ paired: boolean }>("/status")).paired;
  }

  export function pair(code: string) {
    return POST("/pair", { code });
  }

  export function getState() {
    return GET<HubState>("/state");
  }

  export function getPresets() {
    return GET<WebPreset[]>("/presets");
  }

  export function getDesktopEntries() {
    return GET<DesktopEntry[]>("/desktop-entries");
  }

  export function addApp(app: HubAppInput) {
    return POST<HubApp>("/apps", app);
  }

  export function updateApp(appId: number, patch: Partial<HubAppInput>) {
    return PATCH<HubApp>(`/apps/${appId}`, patch);
  }

  export function removeApp(appId: number) {
    return DELETE(`/apps/${appId}`);
  }

  export function moveApp(appId: number, index: number) {
    return POST(`/apps/${appId}/move`, { index });
  }

  export function launch(appId: number) {
    return POST(`/apps/${appId}/launch`);
  }

  export function focus(appId: number) {
    return POST(`/apps/${appId}/focus`);
  }

  export function close(appId: number) {
    return POST(`/apps/${appId}/close`);
  }

  export function uploadArtwork(appId: number, kind: "icon" | "cover" | "background", file: Blob) {
    return PUT<HubApp>(`/apps/${appId}/artwork/${kind}`, file);
  }

  export function removeArtwork(appId: number, kind: "icon" | "cover" | "background") {
    return DELETE<HubApp>(`/apps/${appId}/artwork/${kind}`);
  }

  export function openUrl(url: string) {
    return POST("/open-url", { url });
  }

  export function setVolume(volume: number) {
    return POST<VolumeInfo>("/volume", { volume });
  }

  /**
   * URL of a local image on the hub.
   */
  export function assetUrl(path: string | null | undefined) {
    return path ? `/api/asset?path=${encodeURIComponent(path)}` : null;
  }
}

export default CompanionApi;
