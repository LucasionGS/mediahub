import Controller from "./Controller";

export interface Toast {
  id: number;
  message: string;
  type: "info" | "error" | "success";
}

const TOAST_DURATION_MS = 4500;

/**
 * Notifications shown in the corner of the screen.
 */
export class ToastController extends Controller {
  private _toasts: Toast[] = [];
  private _nextId = 1;

  public get toasts() {
    return this._toasts;
  }

  public add(message: string, type: Toast["type"] = "info") {
    const toast = { id: this._nextId++, message, type };
    this._toasts = [...this._toasts.slice(-2), toast];
    this.notify();
    setTimeout(() => this.remove(toast.id), TOAST_DURATION_MS);
  }

  public remove(id: number) {
    this._toasts = this._toasts.filter(t => t.id !== id);
    this.notify();
  }
}

export default ToastController;
