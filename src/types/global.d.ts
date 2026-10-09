import type { MediaHubApi } from "../shared/types";

declare global {
  interface Window {
    mediahub: MediaHubApi;
  }
}

declare module "*.scss";
