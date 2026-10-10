import { useEffect, useRef, useState } from "react";
import CompanionApi from "../../Api/CompanionApi";

export interface PairProps {
  initialCode?: string | null; // From the hub's QR code. Pairs straight away
  onPaired: () => void;
}

/**
 * First visit: enter the 6-digit code shown on the TV under Settings → Phone remote, or scan its QR code.
 */
export default function Pair(props: PairProps) {
  const { initialCode = null, onPaired } = props;
  const [code, setCode] = useState(initialCode ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const triedInitial = useRef(false);

  const pairWith = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await CompanionApi.pair(value.replace(/\s/g, ""));
      onPaired();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // The ref keeps React's development double-run from spending the single-use code twice
    if (!initialCode || triedInitial.current) return;
    triedInitial.current = true;
    pairWith(initialCode);
  }, [initialCode]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    pairWith(code);
  };

  return (
    <form className="pair" onSubmit={submit}>
      <div className="pair__title">Connect to MediaHub</div>
      <div className="pair__text">On the TV, open <b>Settings → Phone remote</b> and enter the pairing code shown there.</div>
      <input
        className="pair__input"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123 456"
        maxLength={7}
        value={code}
        onChange={event => setCode(event.target.value)}
        autoFocus
      />
      {error && <div className="pair__error">{error}</div>}
      <button className="c-button c-button--primary" disabled={busy || code.replace(/\s/g, "").length !== 6}>
        {busy ? "Pairing…" : "Pair"}
      </button>
    </form>
  );
}
