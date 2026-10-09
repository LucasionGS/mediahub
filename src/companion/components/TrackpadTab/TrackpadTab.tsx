import { useRef, useState } from "react";
import type RemoteConnection from "../../Api/RemoteConnection";
import { tick } from "../../haptics";

export interface TrackpadTabProps {
  connection: RemoteConnection;
}

const TAP_MAX_MS = 220;
const TAP_MAX_MOVE = 10;
const SCROLL_STEP_PX = 28; // Finger travel per wheel detent
const SENSITIVITY_KEY = "mediahub.sensitivity";

interface Touch {
  x: number;
  y: number;
  startX: number;
  startY: number;
  time: number;
}

/**
 * The whole area works like a laptop touchpad: drag to move, tap to click, two-finger tap to right-click,
 * two-finger drag to scroll. The buttons underneath can be held for dragging.
 */
export default function TrackpadTab(props: TrackpadTabProps) {
  const { connection } = props;
  const [sensitivity, setSensitivity] = useState(() => {
    try {
      return parseFloat(localStorage.getItem(SENSITIVITY_KEY) ?? "") || 1.6;
    } catch {
      return 1.6;
    }
  });
  const touches = useRef(new Map<number, Touch>());
  const gesture = useRef({ start: 0, maxFingers: 0, moved: false, scrollRemainder: 0, lastMove: 0 });

  const onPointerDown = (event: React.PointerEvent) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const now = performance.now();
    if (touches.current.size === 0) gesture.current = { start: now, maxFingers: 0, moved: false, scrollRemainder: 0, lastMove: now };
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: now });
    gesture.current.maxFingers = Math.max(gesture.current.maxFingers, touches.current.size);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const touch = touches.current.get(event.pointerId);
    if (!touch) return;
    const dx = event.clientX - touch.x;
    const dy = event.clientY - touch.y;
    touch.x = event.clientX;
    touch.y = event.clientY;
    if (Math.hypot(touch.x - touch.startX, touch.y - touch.startY) > TAP_MAX_MOVE) gesture.current.moved = true;

    if (touches.current.size >= 2) {
      // Two fingers scroll. Only the first finger drives it, so both fingers don't count twice.
      if (event.pointerId !== [...touches.current.keys()][0]) return;
      gesture.current.scrollRemainder += dy;
      const steps = Math.trunc(gesture.current.scrollRemainder / SCROLL_STEP_PX);
      if (steps !== 0) {
        gesture.current.scrollRemainder -= steps * SCROLL_STEP_PX;
        // Natural scrolling: content follows the fingers
        connection.send({ type: "scroll", dx: 0, dy: steps });
      }
      return;
    }

    // Pointer acceleration: faster swipes travel further
    const now = performance.now();
    const elapsed = Math.max(1, now - gesture.current.lastMove);
    gesture.current.lastMove = now;
    const speed = Math.hypot(dx, dy) / elapsed;
    const factor = sensitivity * (1 + Math.min(speed, 2.5) * 0.9);
    connection.move(dx * factor, dy * factor);
  };

  const onPointerUp = (event: React.PointerEvent) => {
    touches.current.delete(event.pointerId);
    if (touches.current.size > 0) return;
    const { start, maxFingers, moved } = gesture.current;
    if (moved || performance.now() - start > TAP_MAX_MS) return;
    tick();
    connection.send({ type: "button", button: maxFingers >= 2 ? "right" : "left", state: "click" });
  };

  const changeSensitivity = (value: number) => {
    setSensitivity(value);
    try {
      localStorage.setItem(SENSITIVITY_KEY, String(value));
    } catch {
      // Not remembered in private mode
    }
  };

  const holdButton = (button: "left" | "right") => ({
    onPointerDown: (event: React.PointerEvent) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      tick();
      connection.send({ type: "button", button, state: "down" });
    },
    onPointerUp: () => connection.send({ type: "button", button, state: "up" }),
    onPointerCancel: () => connection.send({ type: "button", button, state: "up" }),
  });

  return (
    <div className="trackpad">
      <div
        className="trackpad__pad"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="trackpad__hint">Drag to move · Tap to click · Two fingers to scroll or right-click</span>
      </div>
      <div className="trackpad__buttons">
        <button className="trackpad__button" {...holdButton("left")}>Left</button>
        <button className="trackpad__button" {...holdButton("right")}>Right</button>
      </div>
      <label className="trackpad__sensitivity">
        Speed
        <input type="range" min={0.6} max={3.5} step={0.1} value={sensitivity} onChange={event => changeSensitivity(parseFloat(event.target.value))} />
      </label>
    </div>
  );
}
