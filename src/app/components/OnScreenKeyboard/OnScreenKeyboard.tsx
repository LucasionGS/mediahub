import "./OnScreenKeyboard.scss";
import { useState } from "react";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";
import Hints from "../Hints/Hints";

export interface OnScreenKeyboardProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel?: string;
  /**
   * Extra action on LB, like showing a hidden password. Shown in the hints when set.
   */
  onAlternate?: () => void;
  alternateLabel?: string;
  disabled?: boolean;
}

type SpecialKey = "shift" | "symbols" | "backspace" | "space" | "submit";

interface Key {
  label: string;
  text?: string; // Character typed, unless it's a special key
  special?: SpecialKey;
  span: number; // Width in columns. Every row adds up to COLUMNS
}

const COLUMNS = 10;

// Every printable ASCII character is reachable, since Wi-Fi passwords can use any of them
const LETTER_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl-", "zxcvbnm._"];
const SYMBOL_ROWS = ["1234567890", "!@#$%^&*()", "-_=+[]{}\\|", ";:'\",<>/?`", "~.,!?@#$%"];

/**
 * A controller-driven keyboard: the D-pad moves, A types, X deletes, RB switches case and Start submits.
 * It takes over input while mounted, so the screen behind it only gets input again once it closes.
 */
export default function OnScreenKeyboard(props: OnScreenKeyboardProps) {
  const { value, onChange, onSubmit, onCancel, submitLabel = "Done", onAlternate, alternateLabel, disabled = false } = props;
  const [shift, setShift] = useState(false);
  const [symbols, setSymbols] = useState(false);
  const [row, setRow] = useState(1);
  const [index, setIndex] = useState(0);

  const rows = buildRows(symbols, shift, submitLabel);
  const focusRow = Math.min(row, rows.length - 1);
  const focusIndex = Math.min(index, rows[focusRow].length - 1);

  const press = (key: Key) => {
    if (disabled) return;
    if (key.text !== undefined) {
      Sounds.move();
      onChange(value + key.text);
      if (shift && !symbols) setShift(false); // One capital, like a phone keyboard
      return;
    }
    switch (key.special) {
      case "shift":
        Sounds.move();
        setShift(!shift);
        break;
      case "symbols":
        Sounds.move();
        setSymbols(!symbols);
        break;
      case "backspace":
        if (!value) return Sounds.bump();
        Sounds.back();
        onChange(value.slice(0, -1));
        break;
      case "space":
        Sounds.move();
        onChange(value + " ");
        break;
      case "submit":
        Sounds.select();
        onSubmit();
        break;
    }
  };

  useInputLayer(action => {
    if (action === "left" || action === "right") {
      const next = focusIndex + (action === "left" ? -1 : 1);
      if (next < 0 || next >= rows[focusRow].length) return Sounds.bump();
      Sounds.move();
      setIndex(next);
    }
    else if (action === "up" || action === "down") {
      const nextRow = focusRow + (action === "up" ? -1 : 1);
      if (nextRow < 0 || nextRow >= rows.length) return Sounds.bump();
      Sounds.move();
      setRow(nextRow);
      setIndex(keyAtColumn(rows[nextRow], columnCenter(rows[focusRow], focusIndex)));
    }
    else if (action === "confirm") {
      press(rows[focusRow][focusIndex]);
    }
    else if (action === "options") {
      press({ label: "", special: "backspace", span: 1 });
    }
    else if (action === "next-tab") {
      press({ label: "", special: "shift", span: 1 });
    }
    else if (action === "prev-tab" && onAlternate) {
      Sounds.move();
      onAlternate();
    }
    else if (action === "menu") {
      press({ label: "", special: "submit", span: 1 });
    }
    else if (action === "back") {
      Sounds.back();
      onCancel();
    }
  });

  const hints: [string, string][] = [["A", "Type"], ["X", "Delete"], ["RB", "Shift"]];
  if (onAlternate && alternateLabel) hints.push(["LB", alternateLabel]);
  hints.push(["☰", submitLabel], ["B", "Cancel"]);

  return (
    <div className={`on-screen-keyboard ${disabled ? "is-disabled" : ""}`}>
      {rows.map((keys, r) => (
        <div key={r} className="on-screen-keyboard__row">
          {keys.map((key, i) => (
            <button
              key={`${r}-${i}`}
              className={[
                "on-screen-keyboard__key hub-focusable",
                key.special ? "is-special" : "",
                key.special === "submit" ? "is-submit" : "",
                (key.special === "shift" && shift) || (key.special === "symbols" && symbols) ? "is-active" : "",
                r === focusRow && i === focusIndex ? "is-focused" : "",
              ].join(" ")}
              style={{ flexGrow: key.span }}
              onMouseEnter={() => { setRow(r); setIndex(i); }}
              onMouseDown={event => event.preventDefault()} // Keep focus in the text field
              onClick={() => press(key)}
            >
              {key.label}
            </button>
          ))}
        </div>
      ))}
      <Hints hints={hints} />
    </div>
  );
}

function buildRows(symbols: boolean, shift: boolean, submitLabel: string): Key[][] {
  const textRows = (symbols ? SYMBOL_ROWS : LETTER_ROWS).map(chars => [...chars].map<Key>(char => {
    const text = shift && !symbols ? char.toUpperCase() : char;
    return { label: text, text, span: 1 };
  }));
  // The last letter row is one short, which leaves room for backspace
  textRows[textRows.length - 1].push({ label: "⌫", special: "backspace", span: COLUMNS - textRows[textRows.length - 1].length });
  return [
    ...textRows,
    [
      { label: "⇧", special: "shift", span: 1.5 },
      { label: symbols ? "ABC" : "#+=", special: "symbols", span: 1.5 },
      { label: "Space", special: "space", span: 4 },
      { label: submitLabel, special: "submit", span: 3 },
    ],
  ];
}

/**
 * Column at the middle of a key, so moving up and down lands on the key below it rather than the same index.
 */
function columnCenter(keys: Key[], index: number): number {
  const start = keys.slice(0, index).reduce((sum, key) => sum + key.span, 0);
  return start + keys[index].span / 2;
}

function keyAtColumn(keys: Key[], column: number): number {
  let start = 0;
  for (let i = 0; i < keys.length; i++) {
    if (column < start + keys[i].span) return i;
    start += keys[i].span;
  }
  return keys.length - 1;
}
