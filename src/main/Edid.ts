/**
 * Reads what a display says about itself in its EDID: its name, the modes it supports with their refresh rates,
 * and whether it does HDR. Only what the display settings need, not a full decoder.
 */
export namespace Edid {
  export interface Mode {
    width: number;
    height: number;
    refresh: number; // Hz, rounded (59.94 is 60)
  }

  export interface Info {
    name: string | null;
    modes: Mode[];
    hdr: boolean; // Has HDR static metadata with the PQ (HDR10) or HLG transfer function
  }

  const HEADER = [0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00];

  // Progressive CTA-861 video formats by VIC: [width, height, refresh]
  const VICS: Record<number, [number, number, number]> = {
    1: [640, 480, 60], 2: [720, 480, 60], 3: [720, 480, 60], 4: [1280, 720, 60], 14: [1440, 480, 60], 15: [1440, 480, 60],
    16: [1920, 1080, 60], 17: [720, 576, 50], 18: [720, 576, 50], 19: [1280, 720, 50], 29: [1440, 576, 50], 30: [1440, 576, 50],
    31: [1920, 1080, 50], 32: [1920, 1080, 24], 33: [1920, 1080, 25], 34: [1920, 1080, 30], 41: [1280, 720, 100],
    47: [1280, 720, 120], 60: [1280, 720, 24], 61: [1280, 720, 25], 62: [1280, 720, 30], 63: [1920, 1080, 120],
    64: [1920, 1080, 100], 93: [3840, 2160, 24], 94: [3840, 2160, 25], 95: [3840, 2160, 30], 96: [3840, 2160, 50],
    97: [3840, 2160, 60], 98: [4096, 2160, 24], 99: [4096, 2160, 25], 100: [4096, 2160, 30], 101: [4096, 2160, 50],
    102: [4096, 2160, 60], 103: [3840, 2160, 24], 104: [3840, 2160, 25], 105: [3840, 2160, 30], 106: [3840, 2160, 50],
    107: [3840, 2160, 60], 108: [1280, 720, 48], 111: [1920, 1080, 48], 114: [3840, 2160, 48], 115: [4096, 2160, 48],
    116: [3840, 2160, 48], 117: [3840, 2160, 100], 118: [3840, 2160, 120], 119: [3840, 2160, 100], 120: [3840, 2160, 120],
  };

  /**
   * Parse an EDID. Returns `null` when it isn't one.
   */
  export function parse(data: Buffer): Info | null {
    if (data.length < 128 || HEADER.some((byte, i) => data[i] !== byte)) return null;
    const info: Info = { name: null, modes: [], hdr: false };

    // Standard timings. Example: 0xd1 0xc0 is 1920x1080 at 60 Hz.
    for (let i = 38; i < 54; i += 2) {
      if (data[i] === 0x01 && data[i + 1] === 0x01) continue;
      if (data[i] === 0) continue;
      const width = (data[i] + 31) * 8;
      const aspect = [[16, 10], [4, 3], [5, 4], [16, 9]][data[i + 1] >> 6];
      info.modes.push({ width, height: Math.round(width * aspect[1] / aspect[0]), refresh: (data[i + 1] & 0x3f) + 60 });
    }

    // Detailed timings and descriptors
    for (let i = 54; i < 126; i += 18) {
      const descriptor = data.subarray(i, i + 18);
      if (descriptor[0] !== 0 || descriptor[1] !== 0) {
        pushDetailedTiming(info, descriptor);
      }
      else if (descriptor[3] === 0xfc) { // Display name
        info.name = descriptor.subarray(5, 18).toString("latin1").split("\n")[0].trim() || null;
      }
    }

    // CTA-861 extensions, where TVs list most of their modes and HDR support
    const extensions = data[126];
    for (let block = 1; block <= extensions && (block + 1) * 128 <= data.length; block++) {
      const ext = data.subarray(block * 128, (block + 1) * 128);
      if (ext[0] !== 0x02) continue;
      const timingsStart = ext[2];
      let i = 4;
      while (i < timingsStart && i < 127) {
        const tag = ext[i] >> 5;
        const length = ext[i] & 0x1f;
        const payload = ext.subarray(i + 1, i + 1 + length);
        if (tag === 2) { // Video data block
          pushVics(info, payload);
        }
        else if (tag === 7 && payload[0] === 6) { // HDR static metadata
          info.hdr ||= (payload[1] & 0x0c) !== 0; // Bit 2 = SMPTE ST 2084 (PQ), bit 3 = HLG
        }
        else if (tag === 7 && payload[0] === 14) { // Modes that only work with YCbCr 4:2:0, like 4K60 on HDMI 1.4 TVs
          pushVics(info, payload.subarray(1));
        }
        i += 1 + length;
      }
      for (let j = timingsStart; j >= 4 && j + 18 <= 127; j += 18) {
        const descriptor = ext.subarray(j, j + 18);
        if (descriptor[0] === 0 && descriptor[1] === 0) break;
        pushDetailedTiming(info, descriptor);
      }
    }
    return info;
  }

  function pushDetailedTiming(info: Info, d: Buffer) {
    const pixelClock = (d[0] | (d[1] << 8)) * 10000;
    const width = d[2] | ((d[4] & 0xf0) << 4);
    const hBlank = d[3] | ((d[4] & 0x0f) << 8);
    const height = d[5] | ((d[7] & 0xf0) << 4);
    const vBlank = d[6] | ((d[7] & 0x0f) << 8);
    const interlaced = (d[17] & 0x80) !== 0;
    if (interlaced || !width || !height) return;
    info.modes.push({ width, height, refresh: Math.round(pixelClock / ((width + hBlank) * (height + vBlank))) });
  }

  function pushVics(info: Info, payload: Buffer) {
    for (const byte of payload) {
      // VICs 1-64 use the top bit to mark the display's native format
      const vic = byte >= 129 && byte <= 192 ? byte & 0x7f : byte;
      const format = VICS[vic];
      if (format) info.modes.push({ width: format[0], height: format[1], refresh: format[2] });
    }
  }
}

export default Edid;
