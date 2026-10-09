import { useState } from "react";
import MediaHub from "../../MediaHub";
import SideMenu from "../SideMenu/SideMenu";
import ConfirmDialog from "../Dialog/ConfirmDialog";
import type { PowerAction } from "../../../shared/types";

export interface PowerMenuProps {
  onClose: () => void;
}

const CONFIRM: Record<PowerAction, { title: string; label: string; message: string }> = {
  suspend: { title: "Enter sleep mode?", label: "Sleep", message: "Apps stay open and resume when the machine wakes." },
  reboot: { title: "Restart the media server?", label: "Restart", message: "Open apps will be closed." },
  poweroff: { title: "Turn off the media server?", label: "Turn off", message: "Open apps will be closed." },
  "restart-hub": { title: "Restart MediaHub?", label: "Restart MediaHub", message: "Open apps will be closed and the hub starts again." },
};

/**
 * Sleep / restart / power off, each confirmed first.
 */
export default function PowerMenu(props: PowerMenuProps) {
  const { onClose } = props;
  const [pending, setPending] = useState<PowerAction | null>(null);

  const run = (action: PowerAction) => {
    setPending(null);
    onClose();
    MediaHub.run(() => MediaHub.api.power(action));
  };

  return (
    <>
      <SideMenu
        title="Power"
        items={[
          { label: "Enter sleep mode", icon: "moon", onSelect: () => setPending("suspend") },
          { label: "Restart", icon: "restart", onSelect: () => setPending("reboot") },
          { label: "Turn off", icon: "power", danger: true, onSelect: () => setPending("poweroff") },
          { label: "Restart MediaHub", icon: "restart", onSelect: () => setPending("restart-hub") },
        ]}
        onClose={onClose}
      />
      {pending && (
        <ConfirmDialog
          title={CONFIRM[pending].title}
          message={CONFIRM[pending].message}
          confirmLabel={CONFIRM[pending].label}
          danger={pending === "poweroff"}
          onConfirm={() => run(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
