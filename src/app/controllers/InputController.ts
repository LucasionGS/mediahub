import Controller from "./Controller";

export type InputAction = "up" | "down" | "left" | "right" | "confirm" | "back" | "options" | "menu" | "prev-tab" | "next-tab";

export type InputHandler = (action: InputAction) => void;

interface Layer {
  id: number;
  handler: { current: InputHandler };
}

const BUTTON_ACTIONS: Record<number, InputAction> = {
  0: "confirm", // A / Cross
  1: "back", // B / Circle
  2: "options", // X / Square
  3: "options", // Y / Triangle
  4: "prev-tab", // LB / L1
  5: "next-tab", // RB / R1
  9: "menu", // Start / Options
  12: "up",
  13: "down",
  14: "left",
  15: "right",
};
const KEY_ACTIONS: Record<string, InputAction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "confirm",
  " ": "confirm",
  Escape: "back",
  Backspace: "back",
  BrowserBack: "back",
  o: "options",
  ContextMenu: "options",
  q: "prev-tab",
  e: "next-tab",
};
const REPEATING: InputAction[] = ["up", "down", "left", "right"];
const STICK_THRESHOLD = 0.55;
const REPEAT_DELAY_MS = 380;
const REPEAT_RATE_MS = 110;

/**
 * Turns controller and keyboard input into navigation actions and sends them to the topmost input layer.  
 * Screens and dialogs register layers with `useInputLayer`; the newest active layer gets the input.
 */
export class InputController extends Controller {
  private _layers: Layer[] = [];
  private _nextId = 1;
  private _held = new Map<InputAction, number>(); // action -> time of next repeat
  private _enabled = true;

  /**
   * Start listening to the keyboard and polling gamepads.
   * @param onGuide Called when a keyboard stand-in for the Guide button (Shift+Escape, F1 or Home) is pressed.
   * @param helperHandlesShortcut Whether the input helper is running. It sees Shift+Escape on every keyboard even
   * while an app has focus, so the page must not handle it too, or the quick menu would toggle twice.
   */
  public start(onGuide: () => void, helperHandlesShortcut: () => boolean) {
    window.addEventListener("keydown", event => {
      if (event.key === "Escape" && event.shiftKey) {
        event.preventDefault();
        if (!helperHandlesShortcut()) onGuide();
        return;
      }
      if (event.key === "F1" || event.key === "Home") {
        event.preventDefault();
        onGuide();
        return;
      }
      // No enabled check: key events only reach the window that has focus anyway
      const action = KEY_ACTIONS[event.key];
      if (!action) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      this.dispatch(action);
    });
    requestAnimationFrame(() => this.poll());
  }

  /**
   * Gamepad input is ignored while disabled, for example while an app is in front of the hub. Gamepads are
   * read globally, so without this the hub would react to input meant for the app.
   */
  public setEnabled(enabled: boolean) {
    if (enabled === this._enabled) return;
    this._enabled = enabled;
    // Buttons held while an app was in front shouldn't fire once the hub comes back
    this._held.clear();
    for (const action of this.readPressed()) this._held.set(action, Infinity);
  }

  /**
   * Add an input layer on top. Returns a function that removes it.
   */
  public pushLayer(handler: { current: InputHandler }): () => void {
    const layer = { id: this._nextId++, handler };
    this._layers.push(layer);
    return () => {
      this._layers = this._layers.filter(l => l !== layer);
    };
  }

  /**
   * Send an action to the topmost layer.
   */
  public dispatch(action: InputAction) {
    this._layers.at(-1)?.handler.current(action);
  }

  private readPressed(): Set<InputAction> {
    const pressed = new Set<InputAction>();
    for (const pad of navigator.getGamepads()) {
      if (!pad) continue;
      for (const [index, action] of Object.entries(BUTTON_ACTIONS)) {
        if (pad.buttons[Number(index)]?.pressed) pressed.add(action);
      }
      const [x = 0, y = 0] = pad.axes;
      if (y < -STICK_THRESHOLD) pressed.add("up");
      else if (y > STICK_THRESHOLD) pressed.add("down");
      if (x < -STICK_THRESHOLD) pressed.add("left");
      else if (x > STICK_THRESHOLD) pressed.add("right");
    }
    return pressed;
  }

  private poll() {
    const pressed = this.readPressed();
    const now = performance.now();
    for (const action of pressed) {
      const next = this._held.get(action);
      if (next === undefined) {
        this._held.set(action, now + REPEAT_DELAY_MS);
        if (this._enabled) this.dispatch(action);
      }
      else if (now >= next && REPEATING.includes(action)) {
        this._held.set(action, now + REPEAT_RATE_MS);
        if (this._enabled) this.dispatch(action);
      }
    }
    for (const action of [...this._held.keys()]) {
      if (!pressed.has(action)) this._held.delete(action);
    }
    requestAnimationFrame(() => this.poll());
  }
}

export default InputController;
