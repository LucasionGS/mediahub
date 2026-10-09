/**
 * URL for a local image (artwork or icon), served by the main process.
 */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `hub-asset://file/${encodeURIComponent(path)}`;
}
