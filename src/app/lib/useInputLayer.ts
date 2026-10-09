import { useEffect, useRef } from "react";
import MediaHub from "../MediaHub";
import type { InputHandler } from "../controllers/InputController";

/**
 * Receive navigation input while `active`. The most recently activated layer gets the input, so a dialog
 * opened on top of a screen takes over until it closes.
 */
export function useInputLayer(handler: InputHandler, active = true) {
  const ref = useRef(handler);
  ref.current = handler;

  useEffect(() => {
    if (!active) return;
    return MediaHub.input.pushLayer(ref);
  }, [active]);
}

export default useInputLayer;
