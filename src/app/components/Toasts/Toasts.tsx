import "./Toasts.scss";
import MediaHub from "../../MediaHub";
import useController from "../../lib/useController";
import Icon from "../Icon/Icon";

export default function Toasts() {
  const controller = useController(MediaHub.toasts);
  return (
    <div className="toasts">
      {controller.toasts.map(toast => (
        <div key={toast.id} className={`toasts__toast toasts__toast--${toast.type}`}>
          <Icon name={toast.type === "error" ? "info" : "check"} />
          <span>{toast.message}</span>
        </div>
      ))}
    </div>
  );
}
