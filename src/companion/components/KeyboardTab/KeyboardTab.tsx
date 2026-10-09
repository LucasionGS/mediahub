import { useRef, useState } from "react";
import type RemoteConnection from "../../Api/RemoteConnection";
import Icon, { type IconName } from "../../../app/components/Icon/Icon";
import { tick } from "../../haptics";
import type { RemoteKey } from "../../../shared/types";

export interface KeyboardTabProps {
  connection: RemoteConnection;
}

const SPECIAL_KEYS: { key: RemoteKey; label?: string; icon?: IconName }[] = [
  { key: "escape", label: "Esc" },
  { key: "tab", label: "Tab" },
  { key: "left", icon: "chevronLeft" },
  { key: "up", icon: "chevronUp" },
  { key: "down", icon: "chevronDown" },
  { key: "right", icon: "chevronRight" },
  { key: "backspace", label: "⌫" },
  { key: "enter", label: "Enter" },
];

/**
 * Type on the TV with the phone's own keyboard, live as you type, or send a whole line at once.
 */
export default function KeyboardTab(props: KeyboardTabProps) {
  const { connection } = props;
  const liveRef = useRef<HTMLInputElement>(null);
  const previous = useRef("");
  const [line, setLine] = useState("");

  // Phone keyboards (especially Android ones that compose words) don't send reliable key events, so compare the
  // field before and after each change and send the difference as backspaces and text.
  const onLiveInput = (event: React.FormEvent<HTMLInputElement>) => {
    const value = event.currentTarget.value;
    const before = previous.current;
    let common = 0;
    while (common < before.length && common < value.length && before[common] === value[common]) common++;
    for (let i = 0; i < before.length - common; i++) connection.send({ type: "key", key: "backspace" });
    const added = value.slice(common);
    if (added) connection.send({ type: "text", text: added });
    previous.current = value;
  };

  const onLiveKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      connection.send({ type: "key", key: "enter" });
      // Start fresh so the diff doesn't grow forever
      event.currentTarget.value = "";
      previous.current = "";
    }
    else if (event.key === "Backspace" && event.currentTarget.value === "") {
      // Nothing left to diff against, but the TV may still have text
      connection.send({ type: "key", key: "backspace" });
    }
  };

  const sendLine = (event: React.FormEvent) => {
    event.preventDefault();
    if (!line) return;
    tick();
    connection.send({ type: "text", text: line });
    setLine("");
  };

  return (
    <div className="keyboard">
      <button className="keyboard__open" onClick={() => liveRef.current?.focus()}>
        <Icon name="keyboard" size="2rem" />
        <span>Tap to type on the TV</span>
        <input
          ref={liveRef}
          className="keyboard__live"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onInput={onLiveInput}
          onKeyDown={onLiveKeyDown}
          onBlur={event => { event.currentTarget.value = ""; previous.current = ""; }}
        />
      </button>

      <div className="keyboard__keys">
        {SPECIAL_KEYS.map(k => (
          <button key={k.key} className="keyboard__key" onClick={() => { tick(); connection.send({ type: "key", key: k.key }); }}>
            {k.icon ? <Icon name={k.icon} /> : k.label}
          </button>
        ))}
      </div>

      <form className="keyboard__line" onSubmit={sendLine}>
        <input className="c-input" placeholder="Or paste text to send in one go" value={line} onChange={event => setLine(event.target.value)} />
        <button className="c-button c-button--primary" disabled={!line}>Send</button>
      </form>
      <div className="c-note">Typing uses a US keyboard layout, so letters like æ, ø and å can't be sent yet.</div>
    </div>
  );
}
