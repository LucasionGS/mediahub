/**
 * A short vibration on phones that support it, so buttons feel like a real remote.
 */
export function tick(ms = 8) {
  navigator.vibrate?.(ms);
}
