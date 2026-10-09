import "./SideMenu.scss";
import { useState } from "react";
import useInputLayer from "../../lib/useInputLayer";
import Sounds from "../../lib/sounds";
import Icon, { type IconName } from "../Icon/Icon";
import Hints from "../Hints/Hints";

export interface SideMenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  onSelect: () => void;
}

export interface SideMenuProps {
  title: string;
  subtitle?: string;
  items: SideMenuItem[];
  footer?: string;
  onClose: () => void;
}

/**
 * A menu panel that slides in from the right, like a console's options menu.
 */
export default function SideMenu(props: SideMenuProps) {
  const { title, subtitle, items, footer, onClose } = props;
  const [index, setIndex] = useState(0);

  useInputLayer(action => {
    if (action === "up" || action === "down") {
      const next = index + (action === "up" ? -1 : 1);
      if (next < 0 || next >= items.length) return Sounds.bump();
      Sounds.move();
      setIndex(next);
    }
    else if (action === "confirm") {
      Sounds.select();
      items[index]?.onSelect();
    }
    else if (action === "back" || action === "options") {
      Sounds.back();
      onClose();
    }
  });

  return (
    <div className="side-menu" onClick={onClose}>
      <div className="side-menu__panel" onClick={event => event.stopPropagation()}>
        <div className="side-menu__title">{title}</div>
        {subtitle && <div className="side-menu__subtitle">{subtitle}</div>}
        <div className="side-menu__items">
          {items.map((item, i) => (
            <button
              key={item.label}
              className={`side-menu__item hub-focusable ${i === index ? "is-focused" : ""} ${item.danger ? "side-menu__item--danger" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => item.onSelect()}
            >
              {item.icon && <Icon name={item.icon} />}
              {item.label}
            </button>
          ))}
        </div>
        {footer && <div className="side-menu__footer">{footer}</div>}
      </div>
      <Hints hints={[["A", "Select"], ["B", "Back"]]} />
    </div>
  );
}
