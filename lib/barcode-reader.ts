import {
  BarcodeFormat,
  DecodeHintType,
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
  MultiFormatReader,
} from '@zxing/library';
export function groceryHints() {
  return new Map<DecodeHintType, unknown>([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.ITF,
      ],
    ],
    [DecodeHintType.TRY_HARDER, true],
  ]);
}
// Shared by uploaded photos and regression fixtures. RGBLuminanceSource cannot rotate;
// explicitly rotate pixel planes so portrait barcodes get the same scan coverage.
export function decodePixels(rgba: Uint8ClampedArray, width: number, height: number) {
  let pixels = new Uint8ClampedArray(width * height);
  for (let i = 0; i < pixels.length; i++)
    pixels[i] =
      ((rgba[i * 4] + 2 * rgba[i * 4 + 1] + rgba[i * 4 + 2]) / 4) * (rgba[i * 4 + 3] / 255) +
      255 * (1 - rgba[i * 4 + 3] / 255);
  const reader = new MultiFormatReader();
  reader.setHints(groceryHints());
  for (let turn = 0; turn < 2; turn++) {
    try {
      return reader
        .decodeWithState(
          new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height))),
        )
        .getText();
    } catch {}
    const rotated = new Uint8ClampedArray(pixels.length);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        rotated[x * height + (height - 1 - y)] = pixels[y * width + x];
    pixels = rotated;
    [width, height] = [height, width];
  }
  throw new Error(
    'No readable barcode found. Try a close, sharp photo showing the full barcode and white space at both ends, or enter the digits.',
  );
}
export async function decodePhoto(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error(
        'This browser cannot open that image. Export it as JPEG or PNG, or enter the barcode digits.',
      );
    }
    if (!img.naturalWidth || img.naturalWidth * img.naturalHeight > 60000000)
      throw new Error('Choose a smaller image, under 60 megapixels.');
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Photo scanning is unavailable. Enter the barcode digits.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return decodePixels(
      ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      canvas.width,
      canvas.height,
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
