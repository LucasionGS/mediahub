import fs from "node:fs";
import fsp from "node:fs/promises";
import Path from "node:path";
import EventEmitter from "node:events";
import Paths from "./Paths";
import { FIRST_APP_ID, type HubApp, type HubAppInput } from "../shared/types";
import { WEB_PRESETS } from "../shared/presets";

export { WEB_PRESETS, TV_USER_AGENT } from "../shared/presets";

interface ILibrary {
  nextAppId: number;
  apps: HubApp[];
}

/**
 * The apps on the home screen, stored in `apps.json`.
 */
export class Library {
  private constructor() { }

  private static data: ILibrary = { nextAppId: FIRST_APP_ID, apps: [] };
  public static readonly events = new EventEmitter();

  /**
   * Load the library from disk. On first run it is seeded with a YouTube TV tile.
   */
  public static load() {
    try {
      Library.data = JSON.parse(fs.readFileSync(Paths.APPS_FILE, "utf8"));
      Library.data.apps ??= [];
      Library.data.nextAppId ??= FIRST_APP_ID;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`Failed to read ${Paths.APPS_FILE}: ${(error as Error).message}. Fix or delete the file and restart MediaHub.`);
      }
      Library.data = { nextAppId: FIRST_APP_ID, apps: [] };
      Library.add({ ...WEB_PRESETS[0].app });
    }
    Library.normalizeOrder();
  }

  /**
   * All apps, in home screen order.
   */
  public static list(): HubApp[] {
    return [...Library.data.apps].sort((a, b) => a.order - b.order);
  }

  public static get(appId: number): HubApp | null {
    return Library.data.apps.find(app => app.appId === appId) ?? null;
  }

  /**
   * Add an app to the end of the home screen.
   * @throws When the app is missing the fields its type needs.
   */
  public static add(input: HubAppInput): HubApp {
    Library.validate(input);
    const app: HubApp = {
      ...input,
      appId: Library.data.nextAppId++,
      order: Library.data.apps.length,
    };
    delete app.temporary;
    Library.data.apps.push(app);
    Library.save();
    return app;
  }

  /**
   * Change fields on an existing app.
   * @throws When the app doesn't exist or the result is invalid.
   */
  public static update(appId: number, patch: Partial<HubAppInput>): HubApp {
    const app = Library.get(appId);
    if (!app) throw new Error(`App ${appId} not found.`);
    const updated = { ...app, ...patch, appId: app.appId, order: app.order };
    Library.validate(updated);
    Object.assign(app, updated);
    Library.save();
    return app;
  }

  /**
   * Remove an app and its artwork.
   */
  public static async remove(appId: number) {
    const index = Library.data.apps.findIndex(app => app.appId === appId);
    if (index === -1) throw new Error(`App ${appId} not found.`);
    Library.data.apps.splice(index, 1);
    Library.normalizeOrder();
    Library.save();
    await fsp.rm(Paths.artworkFor(appId), { recursive: true, force: true });
  }

  /**
   * Move an app to a new position on the home screen.
   */
  public static move(appId: number, index: number) {
    const apps = Library.list();
    const from = apps.findIndex(app => app.appId === appId);
    if (from === -1) throw new Error(`App ${appId} not found.`);
    const [app] = apps.splice(from, 1);
    apps.splice(Math.max(0, Math.min(index, apps.length)), 0, app);
    apps.forEach((app, i) => app.order = i);
    Library.save();
  }

  /**
   * Save an uploaded image as one of the app's artwork slots and point the app at it.
   * @param data Raw image bytes.
   * @param ext File extension without the dot (png, jpg, webp…).
   */
  public static async saveArtwork(appId: number, kind: "icon" | "cover" | "background", data: Buffer, ext: string): Promise<HubApp> {
    const app = Library.get(appId);
    if (!app) throw new Error(`App ${appId} not found.`);
    const dir = Paths.artworkFor(appId);
    await fsp.mkdir(dir, { recursive: true });
    // Remove the previous file for this slot, which may have a different extension
    for (const file of await fsp.readdir(dir)) {
      if (file.startsWith(`${kind}.`)) await fsp.rm(Path.join(dir, file), { force: true });
    }
    // Timestamped name so the hub's image cache picks up the new file
    const file = Path.join(dir, `${kind}.${Date.now()}.${ext}`);
    await fsp.writeFile(file, data);
    return Library.update(appId, { [kind]: file });
  }

  private static validate(app: Partial<HubApp>) {
    if (!app.name?.trim()) throw new Error("An app needs a name.");
    if (app.type === "desktop" && !app.command?.trim()) throw new Error("A desktop app needs a command to run.");
    if (app.type === "web") {
      if (!app.url) throw new Error("A web app needs a URL.");
      try {
        const url = new URL(app.url);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
      } catch {
        throw new Error(`"${app.url}" is not a valid web address. It must start with http:// or https://.`);
      }
    }
    if (app.type !== "desktop" && app.type !== "web") throw new Error(`Unknown app type "${app.type}". Use "desktop" or "web".`);
  }

  private static normalizeOrder() {
    Library.list().forEach((app, i) => app.order = i);
  }

  private static save() {
    fs.writeFileSync(Paths.APPS_FILE, JSON.stringify(Library.data, null, 2));
    Library.events.emit("change");
  }
}

export default Library;
