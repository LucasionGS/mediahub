import "./PairPhoneDialog.scss";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";
import QrCode from "../QrCode/QrCode";
import Hints from "../Hints/Hints";

export interface PairPhoneDialogProps {
  url: string;
  pairingCode: string;
  onClose: () => void;
}

/**
 * A QR code that opens the phone companion and pairs straight away. The pairing code is single-use and the hub picks
 * a new one after each pairing, so the code follows along and a second phone can scan it too.
 */
export default function PairPhoneDialog(props: PairPhoneDialogProps) {
  const { url, pairingCode, onClose } = props;

  useInputLayer(action => {
    if (action === "back" || action === "confirm") {
      Sounds.back();
      onClose();
    }
  });

  return (
    <div className="pair-phone-dialog" onClick={onClose}>
      <div className="pair-phone-dialog__panel">
        <QrCode className="pair-phone-dialog__qr" value={pairingLink(url, pairingCode)} />
        <div className="pair-phone-dialog__text">
          <div className="pair-phone-dialog__title">Scan with your phone</div>
          <div className="pair-phone-dialog__message">
            Point your phone's camera at the code to open the remote. It pairs by itself, no typing needed.
          </div>
          <div className="pair-phone-dialog__manual">
            <span>Or open</span>
            <b>{url}</b>
            <span>and enter</span>
            <b>{formatPairingCode(pairingCode)}</b>
          </div>
          <Hints hints={[["B", "Close"]]} />
        </div>
      </div>
    </div>
  );
}

/**
 * Companion link that pairs the phone that opens it, for QR codes.
 */
export function pairingLink(url: string, pairingCode: string) {
  return `${url}/?pair=${pairingCode}`;
}

/**
 * A pairing code split in two for reading, like "182 508".
 */
export function formatPairingCode(pairingCode: string) {
  return pairingCode.replace(/(\d{3})(\d{3})/, "$1 $2");
}
