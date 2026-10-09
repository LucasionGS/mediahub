export interface HintsProps {
  hints: [glyph: string, label: string][];
}

/**
 * Button hints along the bottom right, like "Ⓐ Select  Ⓑ Back".
 */
export default function Hints(props: HintsProps) {
  const { hints } = props;
  return (
    <div className="hub-hints">
      {hints.map(([glyph, label]) => (
        <span key={label} className="hub-hints__hint">
          <span className="hub-hints__glyph">{glyph}</span>
          {label}
        </span>
      ))}
    </div>
  );
}
