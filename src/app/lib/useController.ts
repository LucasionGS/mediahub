import { useEffect, useReducer } from "react";
import type Controller from "../controllers/Controller";

/**
 * Subscribe a function component to a {@link Controller}, so it re-renders whenever the controller calls `notify()`.
 * @returns The same controller, for convenience.
 */
export function useController<T extends Controller>(controller: T): T {
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => controller.subscribe(forceUpdate), [controller]);

  return controller;
}

export default useController;
