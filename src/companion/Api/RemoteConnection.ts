import Controller from "../../app/controllers/Controller";
import type { HubState, RemoteMessage, RemoteServerMessage } from "../../shared/types";

const RECONNECT_MS = 2000;

/**
 * The WebSocket to the hub: sends remote input and receives live state. Reconnects on its own.
 */
export class RemoteConnection extends Controller {
  private _ws: WebSocket | null = null;
  private _state: HubState | null = null;
  private _connected = false;
  private _closed = false;
  private _pendingMove = { dx: 0, dy: 0 };
  private _moveQueued = false;

  /**
   * Called when the hub rejects the socket because this phone isn't paired.
   */
  public onUnpaired: (() => void) | null = null;

  public get state() {
    return this._state;
  }

  public get connected() {
    return this._connected;
  }

  public connect() {
    this._closed = false;
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${location.host}/ws`);
    this._ws = ws;
    ws.onopen = () => {
      this._connected = true;
      this.notify();
    };
    ws.onmessage = event => {
      const message: RemoteServerMessage = JSON.parse(event.data);
      if (message.type === "state") {
        this._state = message.state;
        this.notify();
      }
    };
    ws.onclose = event => {
      this._connected = false;
      this._ws = null;
      this.notify();
      if (event.code === 4001) return this.onUnpaired?.();
      if (!this._closed) setTimeout(() => this.connect(), RECONNECT_MS);
    };
  }

  public disconnect() {
    this._closed = true;
    this._ws?.close();
  }

  public send(message: RemoteMessage) {
    if (this._ws?.readyState === WebSocket.OPEN) this._ws.send(JSON.stringify(message));
  }

  /**
   * Queue pointer movement, sent at most once per frame.
   */
  public move(dx: number, dy: number) {
    this._pendingMove.dx += dx;
    this._pendingMove.dy += dy;
    if (this._moveQueued) return;
    this._moveQueued = true;
    requestAnimationFrame(() => {
      this._moveQueued = false;
      const dxInt = Math.trunc(this._pendingMove.dx);
      const dyInt = Math.trunc(this._pendingMove.dy);
      // Keep the fractions so slow movement still adds up
      this._pendingMove.dx -= dxInt;
      this._pendingMove.dy -= dyInt;
      if (dxInt || dyInt) this.send({ type: "move", dx: dxInt, dy: dyInt });
    });
  }
}

export default RemoteConnection;
