/**
 * Base class for controllers: objects that own state and imperative methods, with function components
 * subscribing through `useController` and re-rendering whenever `notify()` is called.
 */
export type ControllerListener = () => void;

export abstract class Controller {
  private _listeners = new Set<ControllerListener>();

  /**
   * Subscribe a listener that runs whenever the controller notifies of a change.
   * @returns An unsubscribe function.
   */
  public subscribe(listener: ControllerListener): () => void {
    this._listeners.add(listener);
    return () => this.unsubscribe(listener);
  }

  public unsubscribe(listener: ControllerListener): void {
    this._listeners.delete(listener);
  }

  /**
   * Tell subscribed views to re-render.
   */
  public notify(): void {
    this._listeners.forEach(listener => listener());
  }
}

export default Controller;
