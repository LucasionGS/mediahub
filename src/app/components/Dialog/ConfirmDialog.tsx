import "./ConfirmDialog.scss";
import { useState } from "react";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";

export interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A centred yes/no dialog. Focus starts on Cancel, so a stray press never confirms.
 */
export default function ConfirmDialog(props: ConfirmDialogProps) {
  const { title, message, confirmLabel, danger = false, onConfirm, onCancel } = props;
  const [index, setIndex] = useState(0); // 0 = cancel, 1 = confirm

  useInputLayer(action => {
    if (action === "left" || action === "right") {
      const next = action === "left" ? 0 : 1;
      if (next !== index) Sounds.move();
      setIndex(next);
    }
    else if (action === "confirm") {
      Sounds.select();
      if (index === 1) onConfirm();
      else onCancel();
    }
    else if (action === "back") {
      Sounds.back();
      onCancel();
    }
  });

  return (
    <div className="confirm-dialog">
      <div className="confirm-dialog__panel">
        <div className="confirm-dialog__title">{title}</div>
        {message && <div className="confirm-dialog__message">{message}</div>}
        <div className="confirm-dialog__buttons">
          <button className={`hub-button hub-focusable ${index === 0 ? "is-focused" : ""}`} onMouseEnter={() => setIndex(0)} onClick={onCancel}>
            Cancel
          </button>
          <button
            className={`hub-button hub-focusable ${danger ? "hub-button--danger" : ""} ${index === 1 ? "is-focused" : ""}`}
            onMouseEnter={() => setIndex(1)}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
