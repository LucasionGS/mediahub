import "./HeroBackground.scss";
import { useEffect, useState, type CSSProperties } from "react";
import { assetUrl } from "../../lib/assets";
import { useAccentColor } from "../../lib/color";
import type { HubApp } from "../../../shared/types";

export interface HeroBackgroundProps {
  app: HubApp | null;
}

interface Layer {
  key: string;
  app: HubApp | null;
}

/**
 * Fullscreen background that crossfades to the focused app's artwork, or a glow in its accent colour.
 */
export default function HeroBackground(props: HeroBackgroundProps) {
  const { app } = props;
  const key = String(app?.appId ?? "none") + (app?.background ?? "");
  const [layers, setLayers] = useState<Layer[]>([{ key, app }]);

  useEffect(() => {
    setLayers(current => {
      if (current.at(-1)?.key === key) return current;
      // Keep the previous layer underneath while the new one fades in
      return [...current.slice(-1), { key, app }];
    });
  }, [key]);

  return (
    <div className="hero-background">
      {layers.map(layer => <HeroLayer key={layer.key} app={layer.app} />)}
      <div className="hero-background__shade" />
    </div>
  );
}

function HeroLayer(props: { app: HubApp | null }) {
  const { app } = props;
  const accent = useAccentColor(app);
  const background = assetUrl(app?.background);
  const icon = assetUrl(app?.icon);
  return (
    <div className="hero-background__layer" style={{ "--hero-accent": accent } as CSSProperties}>
      {background ? (
        <img className="hero-background__image" src={background} alt="" />
      ) : (
        <>
          <div className="hero-background__glow" />
          {icon && <img className="hero-background__icon" src={icon} alt="" />}
        </>
      )}
    </div>
  );
}
