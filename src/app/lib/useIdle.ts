import { useEffect, useState } from "react";
import MediaHub from "../MediaHub";

/**
 * Whether there's been no controller, keyboard or mouse input for `timeoutMs` while `enabled`. Any input makes it
 * false again and restarts the wait.
 */
export function useIdle(timeoutMs: number, enabled = true): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    setIdle(false);
    if (!enabled) return;
    let timer = setTimeout(() => setIdle(true), timeoutMs);
    const stop = MediaHub.input.onActivity(() => {
      setIdle(false);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), timeoutMs);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [timeoutMs, enabled]);

  return idle;
}

export default useIdle;
