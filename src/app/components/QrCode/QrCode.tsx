import { useMemo } from "react";
import { encode } from "uqr";

export interface QrCodeProps {
  value: string;
  className?: string;
}

/**
 * A QR code as a crisp SVG. Dark modules on a light background with a quiet zone, which phone cameras need to read it.
 */
export default function QrCode(props: QrCodeProps) {
  const { value, className } = props;
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: "M", border: 2 });
    // One path for all dark modules keeps the DOM small
    let d = "";
    qr.data.forEach((row, y) => row.forEach((dark, x) => {
      if (dark) d += `M${x} ${y}h1v1h-1z`;
    }));
    return { size: qr.size, path: d };
  }, [value]);

  return (
    <svg className={className} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={`QR code for ${value}`}>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
