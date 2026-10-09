import "./WifiPasswordDialog.scss";
import { useEffect, useRef, useState } from "react";
import MediaHub from "../../MediaHub";
import OnScreenKeyboard from "../OnScreenKeyboard/OnScreenKeyboard";
import Icon from "../Icon/Icon";

export interface WifiPasswordDialogProps {
  ssid: string;
  message?: string; // Shown above the field, like why the saved password didn't work
  onConnected: () => void;
  onCancel: () => void;
}

const MIN_PASSWORD_LENGTH = 8; // WPA passphrases are 8 to 63 characters

/**
 * Asks for a Wi-Fi password with the on-screen keyboard and joins the network. A physical keyboard or the phone's
 * keyboard can type into the field too.
 */
export default function WifiPasswordDialog(props: WifiPasswordDialogProps) {
  const { ssid, message, onConnected, onCancel } = props;
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(message ?? null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const submit = async () => {
    if (connecting) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Wi-Fi passwords are at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    setConnecting(true);
    setError(null);
    const result = await MediaHub.run(() => MediaHub.api.connectWifi(ssid, password));
    setConnecting(false);
    if (!result) return; // The toast already shows what went wrong
    if (result.success) onConnected();
    else setError(result.message);
  };

  return (
    <div className="wifi-password-dialog">
      <div className="wifi-password-dialog__panel">
        <div className="wifi-password-dialog__title">
          <Icon name="wifi" />
          {ssid}
        </div>
        <div className={`wifi-password-dialog__message ${error ? "is-error" : ""}`}>
          {connecting ? `Connecting to ${ssid}…` : error ?? "Enter the password for this network."}
        </div>
        <div className="wifi-password-dialog__field">
          <input
            ref={inputRef}
            type={visible ? "text" : "password"}
            value={password}
            placeholder="Password"
            spellCheck={false}
            autoComplete="off"
            disabled={connecting}
            onChange={event => setPassword(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter") submit();
              else if (event.key === "Escape") onCancel();
            }}
          />
          <span className="wifi-password-dialog__visibility">{visible ? "Shown" : "Hidden"}</span>
        </div>
        <OnScreenKeyboard
          value={password}
          onChange={value => {
            setPassword(value);
            setError(null);
          }}
          onSubmit={submit}
          onCancel={onCancel}
          submitLabel="Connect"
          onAlternate={() => setVisible(!visible)}
          alternateLabel={visible ? "Hide" : "Show"}
          disabled={connecting}
        />
      </div>
    </div>
  );
}
