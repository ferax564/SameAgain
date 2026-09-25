export type Crop = { left: number; top: number; right: number; bottom: number };
export const fullCrop: Crop = { left: 0, top: 0, right: 100, bottom: 100 };
// A conservative paper suggestion. It is always shown and adjustable before recognition.
export function suggestPaperCrop(data: Uint8ClampedArray, width: number, height: number): Crop {
  const xs = new Array(width).fill(0),
    ys = new Array(height).fill(0);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const light = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (light > 150) {
        xs[x]++;
        ys[y]++;
      }
    }
  const x = xs.map((n, i) => (n > height * 0.38 ? i : -1)).filter((i) => i >= 0),
    y = ys.map((n, i) => (n > width * 0.12 ? i : -1)).filter((i) => i >= 0);
  if (x.length < width * 0.15 || y.length < height * 0.3) return { ...fullCrop };
  return {
    left: Math.max(0, Math.floor((x[0] / width) * 100) - 2),
    right: Math.min(100, Math.ceil((x.at(-1)! / width) * 100) + 2),
    top: Math.max(0, Math.floor((y[0] / height) * 100) - 2),
    bottom: Math.min(100, Math.ceil((y.at(-1)! / height) * 100) + 2),
  };
}
export async function loadReceiptImage(file: File) {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose an image smaller than 20 MB.');
  if (
    !/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) &&
    !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
  )
    throw new Error('Choose a JPEG, PNG or WebP photo.');
  const url = URL.createObjectURL(file),
    img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () =>
        reject(
          new Error(
            'This image format could not be opened. Export HEIC photos as JPEG, or paste receipt text.',
          ),
        );
      img.src = url;
    });
    if (img.naturalWidth * img.naturalHeight > 60000000)
      throw new Error('The image is too large. Use a smaller photo.');
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function rotatedReceipt(img: HTMLImageElement, turns: number) {
  const angle = ((turns % 4) + 4) % 4,
    scale = Math.min(1, 2800 / Math.max(img.naturalWidth, img.naturalHeight)),
    w = Math.round(img.naturalWidth * scale),
    h = Math.round(img.naturalHeight * scale),
    canvas = document.createElement('canvas');
  canvas.width = angle % 2 ? h : w;
  canvas.height = angle % 2 ? w : h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((angle * Math.PI) / 2);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return canvas;
}
export function cropReceipt(canvas: HTMLCanvasElement, crop: Crop) {
  const x = (canvas.width * crop.left) / 100,
    y = (canvas.height * crop.top) / 100,
    w = (canvas.width * (crop.right - crop.left)) / 100,
    h = (canvas.height * (crop.bottom - crop.top)) / 100;
  if (w < 20 || h < 20) throw new Error('Select a larger area of the receipt.');
  const scale = Math.min(2, 3200 / Math.max(w, h)),
    out = document.createElement('canvas');
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}
