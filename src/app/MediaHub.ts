import HubStateController from "./controllers/HubStateController";
import InputController from "./controllers/InputController";
import ToastController from "./controllers/ToastController";

/**
 * Global access to the renderer's controllers and the main-process API.
 */
export class MediaHub {
  private constructor() { }

  public static readonly api = window.mediahub;
  public static readonly view = window.mediahub.view;
  public static readonly hub = new HubStateController();
  public static readonly input = new InputController();
  public static readonly toasts = new ToastController();

  /**
   * Run an API call, showing its error as a toast instead of throwing.
   */
  public static async run<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (error) {
      MediaHub.toasts.add((error as Error).message, "error");
      return undefined;
    }
  }
}

export default MediaHub;
