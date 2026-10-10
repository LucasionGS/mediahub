import "./PairHint.scss";
import QrCode from "../QrCode/QrCode";
import { formatPairingCode, pairingLink } from "../PairPhoneDialog/PairPhoneDialog";

export interface PairHintProps {
  url: string;
  pairingCode: string;
}

/**
 * A small corner card that offers pairing a phone, for when there's no controller to reach the settings with.
 */
export default function PairHint(props: PairHintProps) {
  const { url, pairingCode } = props;
  return (
    <div className="pair-hint">
      <QrCode className="pair-hint__qr" value={pairingLink(url, pairingCode)} />
      <div className="pair-hint__text">
        <div className="pair-hint__title">Use your phone as the remote</div>
        <div className="pair-hint__detail">Scan the code, or open <b>{url}</b></div>
        <div className="pair-hint__detail">and enter <b>{formatPairingCode(pairingCode)}</b></div>
      </div>
    </div>
  );
}
