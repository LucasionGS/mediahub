/**
 * Short synthesized UI sounds, in the soft, glassy style of a console menu.
 */
export namespace Sounds {
  let context: AudioContext | null = null;
  let enabled = true;

  /**
   * Turn menu sounds on or off.
   */
  export function setEnabled(value: boolean) {
    enabled = value;
  }

  function tone(frequency: number, duration: number, volume: number, type: OscillatorType = "sine", glideTo?: number) {
    if (!enabled) return;
    context ??= new AudioContext();
    const now = context.currentTime;
    const osc = context.createOscillator();
    const gain = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, now + duration);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain).connect(context.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /**
   * Focus moved.
   */
  export function move() {
    tone(1760, 0.05, 0.035);
  }

  /**
   * Something was activated.
   */
  export function select() {
    tone(880, 0.09, 0.06);
    setTimeout(() => tone(1320, 0.12, 0.05), 45);
  }

  /**
   * Went back or closed something.
   */
  export function back() {
    tone(990, 0.09, 0.05, "sine", 660);
  }

  /**
   * A menu or overlay opened.
   */
  export function open() {
    tone(660, 0.14, 0.05, "sine", 990);
  }

  /**
   * Hit the edge of a list.
   */
  export function bump() {
    tone(220, 0.05, 0.04, "triangle");
  }
}

export default Sounds;
