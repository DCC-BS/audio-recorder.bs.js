export interface Mp4Box {
  type: string;
  size: number;
  start: number;  // offset of box header
  headerSize: number;
  end: number;    // offset after box
  children?: Mp4Box[];
}

export interface M4aHeaderInfo {
  ftyp?: {
    majorBrand: string;
    minorVersion: number;
    compatibleBrands: string[];
  };
  durationSeconds?: number;
  timescale?: number;
  audioTrackId?: number;
  rawBoxes: Mp4Box[];
}

/**
 * Read big‑endian 32‑bit unsigned int
 */
function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

/**
 * Read 4‑char type
 */
function readType(view: DataView, offset: number): string {
  let s = "";
  for (let i = 0; i < 4; i++) {
    s += String.fromCharCode(view.getUint8(offset + i));
  }
  return s;
}

/**
 * Parse MP4/M4A style boxes from a buffer.
 * Recursively parses children for container boxes like 'moov', 'trak', 'mdia', etc.
 */
function parseBoxes(
  view: DataView,
  start: number,
  end: number
): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = start;

  while (offset + 8 <= end) {
    const size = readUint32(view, offset);
    const type = readType(view, offset + 4);

    if (size === 0) {
      // box goes to end of file
      const box: Mp4Box = {
        type,
        size: end - offset,
        start: offset,
        headerSize: 8,
        end,
      };
      boxes.push(box);
      break;
    }

    let boxSize = size;
    let headerSize = 8;

    if (size === 1) {
      // 64‑bit largesize
      if (offset + 16 > end) break;
      const high = view.getUint32(offset + 8, false);
      const low = view.getUint32(offset + 12, false);
      boxSize = high * 2 ** 32 + low;
      headerSize = 16;
    }

    const boxEnd = offset + boxSize;
    if (boxEnd > end || boxSize < headerSize) {
      // corrupt, abort
      break;
    }

    const box: Mp4Box = {
      type,
      size: boxSize,
      start: offset,
      headerSize,
      end: boxEnd,
    };

    // Known container boxes that can have children
    if (["moov", "trak", "mdia", "minf", "stbl"].includes(type)) {
      box.children = parseBoxes(view, offset + headerSize, boxEnd);
    }

    boxes.push(box);
    offset = boxEnd;
  }

  return boxes;
}

/**
 * Extract 'ftyp' data (brands) from top‑level boxes.
 */
function parseFtyp(view: DataView, box: Mp4Box) {
  const offset = box.start + box.headerSize;
  const majorBrand = readType(view, offset);
  const minorVersion = readUint32(view, offset + 4);
  const compatibleBrands: string[] = [];

  let pos = offset + 8;
  while (pos + 4 <= box.end) {
    compatibleBrands.push(readType(view, pos));
    pos += 4;
  }

  return { majorBrand, minorVersion, compatibleBrands };
}

/**
 * Find first child with given type in a tree of boxes.
 */
function findChild(box: Mp4Box, type: string): Mp4Box | undefined {
  if (!box.children) return undefined;
  return box.children.find((c) => c.type === type);
}

/**
 * Parse 'mvhd' for timescale & duration (movie header).
 * In MP4 this is under moov.mvhd; duration in timescale units. [web:6][web:9]
 */
function parseMvhd(view: DataView, mvhd: Mp4Box) {
  const base = mvhd.start + mvhd.headerSize;
  const version = view.getUint8(base);
  let offset = base + 4; // version (1) + flags (3)

  if (version === 1) {
    // 64‑bit creation / modification times
    offset += 8 + 8;
    const timescale = readUint32(view, offset);
    const high = readUint32(view, offset + 4);
    const low = readUint32(view, offset + 8);
    const duration = high * 2 ** 32 + low;
    return { timescale, duration };
  }
    // version 0
    offset += 4 + 4;
    const timescale = readUint32(view, offset);
    const duration = readUint32(view, offset + 4);
    return { timescale, duration };
}

/**
 * Parse 'tkhd' for track id.
 */
function parseTkhd(view: DataView, tkhd: Mp4Box): number | undefined {
  const base = tkhd.start + tkhd.headerSize;
  const version = view.getUint8(base);
  let offset = base + 4; // version + flags

  if (version === 1) {
    offset += 8 + 8; // creation, modification (64‑bit)
  } else {
    offset += 4 + 4; // creation, modification (32‑bit)
  }

  const trackId = readUint32(view, offset);
  return trackId;
}

/**
 * Parse a M4A/MP4 buffer and return basic header info.
 *
 * @param buffer ArrayBuffer or Uint8Array containing the full file.
 */
export function parseM4aHeader(input: ArrayBuffer | Uint8Array): M4aHeaderInfo {
  const arrayBuffer =
    input instanceof Uint8Array ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) : input;
  const view = new DataView(arrayBuffer);
  const fileSize = view.byteLength;

  const topLevel = parseBoxes(view, 0, fileSize);

  const result: M4aHeaderInfo = {
    rawBoxes: topLevel,
  };

  // FTYP
  const ftyp = topLevel.find((b) => b.type === "ftyp");
  if (ftyp) {
    result.ftyp = parseFtyp(view, ftyp);
  }

  // MOOV → mvhd for duration
  const moov = topLevel.find((b) => b.type === "moov");
  if (moov && moov.children) {
    const mvhd = moov.children.find((b) => b.type === "mvhd");
    if (mvhd) {
      const mv = parseMvhd(view, mvhd);
      if (mv) {
        result.timescale = mv.timescale;
        if (mv.timescale > 0) {
          result.durationSeconds = mv.duration / mv.timescale;
        }
      }
    }

    // First trak as "audio" candidate (for real classification you'd scan mdia.hdlr)
    const trak = moov.children.find((b) => b.type === "trak");
    if (trak && trak.children) {
      const tkhd = trak.children.find((b) => b.type === "tkhd");
      if (tkhd) {
        result.audioTrackId = parseTkhd(view, tkhd);
      }
    }
  }

  return result;
}
