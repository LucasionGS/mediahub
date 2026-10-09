import { ipcRenderer } from "electron";

/**
 * Turns controller input into arrow/Enter/Escape key presses for web apps, so TV-style web interfaces
 * (YouTube TV, Jellyfin) can be used with a gamepad. The main process sends the actual trusted key events.
 */

const BUTTON_KEYS: Record<number, string> = {
  0: "Enter", // A / Cross
  1: "Escape", // B / Circle
  12: "Up",
  13: "Down",
  14: "Left",
  15: "Right",
};
const STICK_THRESHOLD = 0.6;
const REPEAT_DELAY_MS = 400;
const REPEAT_RATE_MS = 110;

const held = new Map<string, number>(); // key -> time of next repeat

function poll() {
  const pressed = new Set<string>();
  for (const pad of navigator.getGamepads()) {
    if (!pad) continue;
    for (const [index, key] of Object.entries(BUTTON_KEYS)) {
      if (pad.buttons[Number(index)]?.pressed) pressed.add(key);
    }
    const [x = 0, y = 0] = pad.axes;
    if (y < -STICK_THRESHOLD) pressed.add("Up");
    else if (y > STICK_THRESHOLD) pressed.add("Down");
    if (x < -STICK_THRESHOLD) pressed.add("Left");
    else if (x > STICK_THRESHOLD) pressed.add("Right");
  }

  // While the hub's quick menu is open it has input focus, and the controller is meant for it, not for this page
  if (!document.hasFocus()) pressed.clear();

  const now = performance.now();
  for (const key of pressed) {
    const next = held.get(key);
    if (next === undefined) {
      ipcRenderer.send("webapp:key", key);
      held.set(key, now + REPEAT_DELAY_MS);
    }
    // Only directions repeat; repeating Enter would activate things twice
    else if (now >= next && ["Up", "Down", "Left", "Right"].includes(key)) {
      ipcRenderer.send("webapp:key", key);
      held.set(key, now + REPEAT_RATE_MS);
    }
  }
  for (const key of [...held.keys()]) {
    if (!pressed.has(key)) held.delete(key);
  }
  requestAnimationFrame(poll);
}

window.addEventListener("DOMContentLoaded", () => requestAnimationFrame(poll));
