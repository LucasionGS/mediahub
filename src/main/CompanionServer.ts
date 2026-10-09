import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import fsp from "node:fs/promises";
import Path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import Hub from "./Hub";
import Library, { WEB_PRESETS } from "./Library";
import Paths from "./Paths";
import Settings from "./Settings";
import SystemService from "./SystemService";
import DesktopEntries from "./DesktopEntries";
import type { CompanionInfo, HubAppInput, RemoteMessage, RemoteServerMessage } from "../shared/types";

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const COOKIE = "mediahub_token";
const MAX_JSON_BYTES = 256 * 1024;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_PAIR_ATTEMPTS = 5;
const PAIR_LOCKOUT_MS = 60_000;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".xpm": "image/x-xpixmap",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

const IMAGE_EXTS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/**
 * The phone companion: a LAN web page with a JSON API under `/api` and a WebSocket at `/ws` for the remote.
 * Phones pair once with the code shown in the hub's settings, and get a token cookie.
 */
export class CompanionServer {
  private _server: http.Server | null = null;
  private _wss = new WebSocketServer({ noServer: true });
  private _pairingCode = CompanionServer.newPairingCode();
  private _failedAttempts = new Map<string, { count: number; until: number }>();
  private _sockets = new Set<WebSocket>();

  constructor(
    /** Port to listen on, on all interfaces. */
    private readonly port: number,
  ) {
    Hub.events.on("state", () => this.pushState());
  }

  public start(): Promise<void> {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        this.handle(req, res).catch(error => {
          console.error("Companion request failed:", error);
          if (!res.headersSent) sendJson(res, 500, { message: "Something went wrong on the hub." });
          else res.end();
        });
      });
      server.on("upgrade", (req, socket, head) => this.onUpgrade(req, socket as net.Socket, head));
      server.on("error", error => {
        console.error(`Companion server could not listen on port ${this.port}:`, error.message);
        this._server = null;
        resolve();
      });
      server.listen(this.port, "0.0.0.0", () => {
        this._server = server;
        console.log(`Companion running at ${this.getUrl()}`);
        resolve();
      });
    });
  }

  public getUrl(): string | null {
    if (!this._server) return null;
    const address = SystemService.getLanAddresses()[0] ?? "localhost";
    return `http://${address}:${this.port}`;
  }

  public getInfo(): CompanionInfo {
    return { url: this.getUrl(), pairingCode: this._pairingCode, pairedDevices: Settings.get("companionTokens").length };
  }

  /**
   * Unpair every phone. They'll need the pairing code again.
   */
  public forgetDevices() {
    Settings.set("companionTokens", []);
    for (const socket of this._sockets) socket.close(4001, "Unpaired");
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!url.pathname.startsWith("/api/")) return this.serveStatic(req, res, url);

    const method = req.method ?? "GET";
    const path = url.pathname.slice(4); // Strip "/api"

    if (method === "GET" && path === "/status") {
      return sendJson(res, 200, { paired: this.isAuthorized(req) });
    }
    if (method === "POST" && path === "/pair") return this.pair(req, res);
    if (!this.isAuthorized(req)) {
      return sendJson(res, 401, { message: "This device isn't paired yet. Enter the pairing code from the hub's Settings." });
    }

    try {
      await this.route(method, path, url, req, res);
    } catch (error) {
      if (res.headersSent) return;
      sendJson(res, 400, { message: (error as Error).message });
    }
  }

  private async route(method: string, path: string, url: URL, req: http.IncomingMessage, res: http.ServerResponse) {
    if (method === "GET" && path === "/state") return sendJson(res, 200, Hub.getState());
    if (method === "GET" && path === "/presets") return sendJson(res, 200, WEB_PRESETS);
    if (method === "GET" && path === "/desktop-entries") return sendJson(res, 200, await DesktopEntries.list());
    if (method === "GET" && path === "/asset") return this.serveAsset(res, url.searchParams.get("path"));
    if (method === "POST" && path === "/home") {
      Hub.goHome();
      return sendJson(res, 200, {});
    }
    if (method === "POST" && path === "/quick-menu") {
      Hub.toggleQuickMenu();
      return sendJson(res, 200, {});
    }
    if (method === "POST" && path === "/mute") {
      await Hub.toggleMute();
      return sendJson(res, 200, Hub.volume);
    }
    if (method === "POST" && path === "/volume") {
      const body = await readJson<{ volume?: number; delta?: number }>(req);
      if (typeof body.volume === "number") await Hub.setVolume(body.volume);
      else if (typeof body.delta === "number") await Hub.changeVolume(body.delta);
      else return sendJson(res, 400, { message: "Send either volume (0 to 1) or delta." });
      return sendJson(res, 200, Hub.volume);
    }
    if (method === "POST" && path === "/open-url") {
      const { url: link } = await readJson<{ url?: string }>(req);
      if (!link) return sendJson(res, 400, { message: "A URL is required." });
      await Hub.openUrl(link);
      return sendJson(res, 200, {});
    }
    if (method === "GET" && path === "/apps") return sendJson(res, 200, Library.list());
    if (method === "POST" && path === "/apps") {
      const app = Hub.addApp(await readJson<HubAppInput>(req));
      return sendJson(res, 201, app);
    }

    // Example:
    // /apps/10002/artwork/cover
    const match = /^\/apps\/(\d+)(?:\/(\w+))?(?:\/(\w+))?$/.exec(path);
    if (!match) return sendJson(res, 404, { message: `No API route for ${method} ${path}.` });
    const appId = parseInt(match[1]);
    const action = match[2];
    const app = Library.get(appId);
    const isRunning = Hub.launcher.isRunning(appId);
    if (!app && !isRunning) return sendJson(res, 404, { message: `App ${appId} not found.` });

    if (!action) {
      if (method === "PATCH") return sendJson(res, 200, Library.update(appId, await readJson<Partial<HubAppInput>>(req)));
      if (method === "DELETE") {
        await Hub.removeApp(appId);
        return sendJson(res, 200, {});
      }
    }
    if (method === "POST" && action === "launch") {
      await Hub.launch(appId);
      return sendJson(res, 200, {});
    }
    if (method === "POST" && action === "focus") {
      Hub.focus(appId);
      return sendJson(res, 200, {});
    }
    if (method === "POST" && action === "close") {
      await Hub.close(appId);
      return sendJson(res, 200, {});
    }
    if (method === "POST" && action === "move") {
      const { index } = await readJson<{ index?: number }>(req);
      if (typeof index !== "number") return sendJson(res, 400, { message: "index is required." });
      Library.move(appId, index);
      return sendJson(res, 200, {});
    }
    if (action === "artwork") {
      const kind = match[3];
      if (kind !== "icon" && kind !== "cover" && kind !== "background") {
        return sendJson(res, 400, { message: "Artwork must be icon, cover or background." });
      }
      if (method === "DELETE") return sendJson(res, 200, Library.update(appId, { [kind]: null }));
      if (method === "PUT") {
        const type = (req.headers["content-type"] ?? "").split(";")[0].trim();
        const ext = IMAGE_EXTS[type];
        if (!ext) return sendJson(res, 400, { message: "Upload a PNG, JPEG, WebP, GIF or SVG image." });
        const data = await readBody(req, MAX_UPLOAD_BYTES);
        return sendJson(res, 200, await Library.saveArtwork(appId, kind, data, ext));
      }
    }
    return sendJson(res, 404, { message: `No API route for ${method} ${path}.` });
  }

  private async pair(req: http.IncomingMessage, res: http.ServerResponse) {
    const ip = req.socket.remoteAddress ?? "";
    const failed = this._failedAttempts.get(ip);
    if (failed && failed.until > Date.now()) {
      return sendJson(res, 429, { message: "Too many wrong codes. Wait a minute and try again." });
    }
    const { code } = await readJson<{ code?: string }>(req).catch(() => ({ code: undefined }));
    if (!code || code.trim() !== this._pairingCode) {
      const count = (failed?.count ?? 0) + 1;
      this._failedAttempts.set(ip, { count, until: count >= MAX_PAIR_ATTEMPTS ? Date.now() + PAIR_LOCKOUT_MS : 0 });
      return sendJson(res, 403, { message: "That code doesn't match. Check Settings → Phone remote on the TV." });
    }
    this._failedAttempts.delete(ip);
    const token = crypto.randomBytes(24).toString("hex");
    Settings.set("companionTokens", [...Settings.get("companionTokens"), token]);
    // A code is used once
    this._pairingCode = CompanionServer.newPairingCode();
    Hub.broadcast();
    res.setHeader("Set-Cookie", `${COOKIE}=${token}; Path=/; Max-Age=315360000; HttpOnly; SameSite=Strict`);
    sendJson(res, 200, {});
  }

  private isAuthorized(req: http.IncomingMessage) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return false;
    return Settings.get("companionTokens").some(known => safeEqual(known, token));
  }

  private async serveAsset(res: http.ServerResponse, path: string | null) {
    if (!path || !Paths.isAllowedAsset(path)) return sendJson(res, 404, { message: "Asset not found." });
    return this.sendFile(res, path, "public, max-age=86400");
  }

  private async serveStatic(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
    const pathname = url.pathname === "/" ? "/companion.html" : url.pathname;
    if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      return proxyHttp(req, res, MAIN_WINDOW_VITE_DEV_SERVER_URL, pathname + url.search);
    }
    const root = Path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}`);
    const file = Path.resolve(root, "." + decodeURIComponent(pathname));
    if (!file.startsWith(root + Path.sep)) return sendJson(res, 404, { message: "Not found." });
    return this.sendFile(res, file, pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  }

  private async sendFile(res: http.ServerResponse, file: string, cacheControl: string) {
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) return sendJson(res, 404, { message: "Not found." });
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[Path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": cacheControl,
    });
    fs.createReadStream(file).pipe(res);
  }

  private onUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      // In development, pass Vite's hot-reload socket through to the dev server
      if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== "undefined" && MAIN_WINDOW_VITE_DEV_SERVER_URL) {
        return proxyUpgrade(req, socket, head, MAIN_WINDOW_VITE_DEV_SERVER_URL);
      }
      return socket.destroy();
    }
    if (!this.isAuthorized(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    this._wss.handleUpgrade(req, socket, head, ws => this.onSocket(ws));
  }

  private onSocket(ws: WebSocket) {
    this._sockets.add(ws);
    ws.on("close", () => this._sockets.delete(ws));
    ws.on("message", data => {
      try {
        this.onRemoteMessage(JSON.parse(data.toString()));
      } catch (error) {
        console.warn("Bad remote message:", (error as Error).message);
      }
    });
    send(ws, { type: "state", state: Hub.getState() });
  }

  private onRemoteMessage(message: RemoteMessage) {
    const input = Hub.input;
    switch (message.type) {
      case "move": return input.move(message.dx, message.dy);
      case "scroll": return input.scroll(message.dx, message.dy);
      case "button": return input.button(message.button, message.state);
      case "key": return input.key(message.key, message.state);
      case "text": return input.text(message.text);
      case "action":
        switch (message.action) {
          case "home": return Hub.goHome();
          case "menu": return Hub.toggleQuickMenu();
          case "volume-up": return Hub.changeVolume(0.05);
          case "volume-down": return Hub.changeVolume(-0.05);
          case "mute": return Hub.toggleMute();
        }
    }
  }

  private pushState() {
    if (this._sockets.size === 0) return;
    const message: RemoteServerMessage = { type: "state", state: Hub.getState() };
    for (const ws of this._sockets) send(ws, message);
  }

  private static newPairingCode() {
    return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  }
}

function send(ws: WebSocket, message: RemoteServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body ?? {});
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error(`The upload is too large. The limit is ${Math.round(limit / 1024 / 1024)} MB.`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const body = await readBody(req, MAX_JSON_BYTES);
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch {
    throw new Error("The request body must be valid JSON.");
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) cookies[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return cookies;
}

function safeEqual(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function proxyHttp(req: http.IncomingMessage, res: http.ServerResponse, target: string, path: string) {
  const upstream = http.request(new URL(path, target), { method: req.method, headers: { ...req.headers, host: new URL(target).host } }, upstreamRes => {
    res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
    upstreamRes.pipe(res);
  });
  upstream.on("error", () => sendJson(res, 502, { message: "The Vite dev server isn't reachable." }));
  req.pipe(upstream);
}

function proxyUpgrade(req: http.IncomingMessage, socket: net.Socket, head: Buffer, target: string) {
  const { hostname, port } = new URL(target);
  const upstream = net.connect(parseInt(port), hostname, () => {
    const headers = Object.entries(req.headers).map(([key, value]) => `${key}: ${key === "host" ? `${hostname}:${port}` : value}`);
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`);
    upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
}

export default CompanionServer;
