import { useState } from "react";
import CompanionApi from "../../Api/CompanionApi";

export interface PairProps {
  onPaired: () => void;
}

/**
 * First visit: enter the 6-digit code shown on the TV under Settings → Phone remote.
 */
export default function Pair(props: PairProps) {
  const { onPaired } = props;
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await CompanionApi.pair(code.replace(/\s/g, ""));
      onPaired();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
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
