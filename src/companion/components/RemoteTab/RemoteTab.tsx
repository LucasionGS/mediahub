import type RemoteConnection from "../../Api/RemoteConnection";
import useController from "../../../app/lib/useController";
import Icon, { type IconName } from "../../../app/components/Icon/Icon";
import { tick } from "../../haptics";
import type { RemoteKey, RemoteMessage } from "../../../shared/types";

export interface RemoteTabProps {
  connection: RemoteConnection;
}

/**
 * A TV remote: D-pad with OK, back/home/menu, media keys and volume.
 */
export default function RemoteTab(props: RemoteTabProps) {
  const connection = useController(props.connection);
  const state = connection.state;

  const key = (k: RemoteKey) => {
    tick();
    connection.send({ type: "key", key: k });
  };
  const action = (a: Extract<RemoteMessage, { type: "action" }>["action"]) => {
    tick();
    connection.send({ type: "action", action: a });
  };

  const volume = state ? Math.round(state.volume.volume * 100) : 0;
  return (
    <div className="remote">
      <div className="remote__row">
        <RoundButton icon="back" label="Back" onPress={() => key("escape")} />
        <RoundButton icon="home" label="Home" onPress={() => action("home")} />
        <RoundButton icon="more" label="Quick menu" onPress={() => action("menu")} />
      </div>

      <div className="remote__dpad">
        <button className="remote__arrow remote__arrow--up" onClick={() => key("up")} aria-label="Up"><Icon name="chevronUp" size="2rem" /></button>
        <button className="remote__arrow remote__arrow--left" onClick={() => key("left")} aria-label="Left"><Icon name="chevronLeft" size="2rem" /></button>
        <button className="remote__ok" onClick={() => key("enter")}>OK</button>
        <button className="remote__arrow remote__arrow--right" onClick={() => key("right")} aria-label="Right"><Icon name="chevronRight" size="2rem" /></button>
        <button className="remote__arrow remote__arrow--down" onClick={() => key("down")} aria-label="Down"><Icon name="chevronDown" size="2rem" /></button>
      </div>

      <div className="remote__row">
        <RoundButton icon="previous" label="Previous" onPress={() => key("previous")} />
        <RoundButton icon="play" label="Play/pause" onPress={() => key("playpause")} big />
        <RoundButton icon="next" label="Next" onPress={() => key("next")} />
      </div>

      <div className="remote__volume">
        <RoundButton icon="minus" label="Volume down" onPress={() => action("volume-down")} />
        <button className="remote__level" onClick={() => action("mute")}>
          <Icon name={state?.volume.muted ? "volumeMute" : "volume"} />
          <span className="remote__bar"><span style={{ width: `${state?.volume.muted ? 0 : volume}%` }} /></span>
          <span>{state?.volume.muted ? "Muted" : `${volume}%`}</span>
        </button>
        <RoundButton icon="plus" label="Volume up" onPress={() => action("volume-up")} />
      </div>
    </div>
  );
}

function RoundButton(props: { icon: IconName; label: string; big?: boolean; onPress: () => void }) {
  const { icon, label, big = false, onPress } = props;
  return (
    <button className={`remote__round ${big ? "is-big" : ""}`} onClick={onPress} aria-label={label}>
      <Icon name={icon} size={big ? "1.8rem" : "1.4rem"} />
    </button>
  );
}
