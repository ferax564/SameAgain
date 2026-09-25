// Server-side photo sanitising: strips metadata that can carry location or
// device details, and reads image dimensions from the headers.
export const MAX_PHOTO_DIMENSION = 8000;
export const HOUSEHOLD_PHOTO_QUOTA = 200 * 1024 * 1024;

export type CleanPhoto = {
  bytes: Uint8Array;
  type: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
};

class PhotoError extends Error {
  status = 400;
}
const reject = (message = 'Use a JPEG or PNG photo.'): never => {
  throw new PhotoError(message);
};

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
// Ancillary chunks that carry text or EXIF metadata.
const PNG_METADATA = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'tIME']);

export function cleanPng(bytes: Uint8Array): CleanPhoto {
  if (bytes.length < 33 || !PNG_SIGNATURE.every((v, i) => bytes[i] === v)) reject();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8,
    width = 0,
    height = 0,
    ended = false;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const end = offset + 12 + length;
    if (end > bytes.length) reject();
    if (offset === 8) {
      if (type !== 'IHDR' || length < 8) reject();
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
    }
    if (!PNG_METADATA.has(type)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (type === 'IEND') {
      ended = true;
      break;
    }
  }
  if (!ended || !width || !height) reject();
  if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION)
    reject('Choose a photo no larger than 8000 × 8000 pixels.');
  return { bytes: concat(parts), type: 'image/png', width, height };
}

const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

export function cleanJpeg(bytes: Uint8Array): CleanPhoto {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  )
    reject();
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2,
    width = 0,
    height = 0,
    scan = false;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) reject();
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset++;
      continue;
    }
    // Standalone markers without a length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) reject();
    if (isStartOfFrame(marker)) {
      if (length < 7) reject();
      height = (bytes[offset + 5] << 8) | bytes[offset + 6];
      width = (bytes[offset + 7] << 8) | bytes[offset + 8];
    }
    // APP1 carries EXIF (including GPS) and XMP; APP13 carries IPTC; COM is free text.
    if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe)
      parts.push(bytes.subarray(offset, end));
    offset = end;
    if (marker === 0xda) {
      scan = true;
      parts.push(bytes.subarray(offset));
      break;
    }
  }
  if (!scan || !width || !height) reject();
  if (width > MAX_PHOTO_DIMENSION || height > MAX_PHOTO_DIMENSION)
    reject('Choose a photo no larger than 8000 × 8000 pixels.');
  return { bytes: concat(parts), type: 'image/jpeg', width, height };
}

export function cleanPhoto(bytes: Uint8Array, declaredType: string): CleanPhoto {
  if (declaredType === 'image/jpeg') return cleanJpeg(bytes);
  if (declaredType === 'image/png') return cleanPng(bytes);
  return reject();
}

/** R2 keys of household photos referenced anywhere inside a record's data. */
export function photoKeys(data: unknown, household: string): string[] {
  const keys = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      if (!value.startsWith('/api/photo?')) return;
      try {
        const key = new URL(value, 'https://same.test').searchParams.get('key') || '';
        if (key.split('/')[0] === household && key.length > household.length + 1) keys.add(key);
      } catch {
        // Not a photo link.
      }
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(data);
  return [...keys];
}
