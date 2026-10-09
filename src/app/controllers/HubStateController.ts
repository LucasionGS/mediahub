import Controller from "./Controller";
import type { HubApp, HubState, RunningApp } from "../../shared/types";

/**
 * Holds the latest {@link HubState} pushed by the main process.
 */
export class HubStateController extends Controller {
  private _state: HubState | null = null;

  /**
   * Fetch the initial state and follow updates.
   */
  public async init() {
    window.mediahub.onState(state => {
      this._state = state;
      this.notify();
    });
    this._state = await window.mediahub.getState();
    this.notify();
  }

  public get state() {
    return this._state;
  }

  public getRunning(appId: number): RunningApp | null {
    return this._state?.running.find(r => r.appId === appId) ?? null;
  }

  /**
   * Library apps followed by temporary apps opened from the phone that are still running.
   */
  public getTiles(): HubApp[] {
    if (!this._state) return [];
    const temporary = this._state.running.filter(r => r.app.temporary).map(r => r.app);
    return [...this._state.apps, ...temporary];
  }
}

export default HubStateController;
