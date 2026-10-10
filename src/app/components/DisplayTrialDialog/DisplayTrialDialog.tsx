import { useEffect, useState } from "react";
import MediaHub from "../../MediaHub";
import ConfirmDialog from "../Dialog/ConfirmDialog";

export interface DisplayTrialDialogProps {
  deadline: number; // When the hub switches back by itself (epoch ms)
}

/**
 * Asks whether to keep new display settings, right after the hub starts with them. If the TV shows nothing, nobody
 * can answer, and the hub switches back when the countdown runs out.
 */
export default function DisplayTrialDialog(props: DisplayTrialDialogProps) {
  const { deadline } = props;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <ConfirmDialog
      title="Keep these display settings?"
      message={`Switching back to the previous settings in ${seconds} second${seconds === 1 ? "" : "s"}.`}
      confirmLabel="Keep"
      cancelLabel="Switch back"
      onConfirm={() => MediaHub.run(() => MediaHub.api.keepDisplay(true))}
      onCancel={() => MediaHub.run(() => MediaHub.api.keepDisplay(false))}
    />
  );
}
