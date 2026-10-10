import "./BluetoothPairDialog.scss";
import MediaHub from "../../MediaHub";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";
import Icon from "../Icon/Icon";
import Hints from "../Hints/Hints";
import ConfirmDialog from "../Dialog/ConfirmDialog";
import type { BluetoothPairing } from "../../../shared/types";

export interface BluetoothPairDialogProps {
  pairing: BluetoothPairing;
}

/**
 * Follows a Bluetooth pairing: waiting for the device, a code to type on a keyboard, or a code to compare with the
 * device's own screen.
 */
export default function BluetoothPairDialog(props: BluetoothPairDialogProps) {
  const { pairing } = props;
  const answer = (accept: boolean) => MediaHub.run(() => MediaHub.api.answerBluetoothPairing(accept));

  if (pairing.confirm) {
    return (
      <ConfirmDialog
        title={`Pair with ${pairing.name}?`}
        message={`Check that ${pairing.name} shows ${formatCode(pairing.confirm)} too.`}
        confirmLabel="Pair"
        onConfirm={() => answer(true)}
        onCancel={() => answer(false)}
      />
    );
  }
  return <PairingProgress pairing={pairing} onCancel={() => answer(false)} />;
}

function PairingProgress(props: { pairing: BluetoothPairing; onCancel: () => void }) {
  const { pairing, onCancel } = props;

  useInputLayer(action => {
    if (action !== "back") return;
    Sounds.back();
    onCancel();
  });

  let title = `Pairing with ${pairing.name}…`;
  let message = "Keep it in pairing mode until this finishes. Controllers usually flash their light while they pair.";
  if (pairing.stage === "connecting") {
    title = `Connecting to ${pairing.name}…`;
    message = "Paired. Almost there.";
  }
  else if (pairing.passkey) {
    message = `Type this code on ${pairing.name}, then press Enter.`;
  }

  return (
    <div className="bluetooth-pair-dialog">
      <div className="bluetooth-pair-dialog__panel">
        <div className="bluetooth-pair-dialog__title">
          <Icon name="bluetooth" />
          {title}
        </div>
        <div className="bluetooth-pair-dialog__message">{message}</div>
        {pairing.passkey && pairing.stage === "pairing" && <div className="bluetooth-pair-dialog__code">{formatCode(pairing.passkey)}</div>}
        <Hints hints={[["B", "Cancel"]]} />
      </div>
    </div>
  );
}

/**
 * A six-digit code split in two for reading, like "182 508".
 */
function formatCode(code: string) {
  return code.replace(/^(\d{3})(\d{3})$/, "$1 $2");
}
