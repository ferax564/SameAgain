import { barcode } from './domain';
export type ScanControls = { stop: () => void };
// Owns the asynchronous camera session even when a result arrives before startup resolves.
export class ScanSession {
  private epoch = 0;
  private controls?: ScanControls;
  private busy = false;
  stop() {
    this.epoch++;
    this.busy = false;
    this.controls?.stop();
    this.controls = undefined;
  }
  async run(
    start: (accept: (raw: string) => void) => Promise<ScanControls>,
    accepted: (code: string) => void,
    invalid: (message: string) => void,
  ) {
    if (this.busy) return;
    this.busy = true;
    const token = ++this.epoch;
    let found = false;
    try {
      const controls = await start((raw) => {
        if (token !== this.epoch || found) return;
        const b = barcode(raw);
        if (!b.valid) {
          invalid(b.error || 'Invalid barcode');
          return;
        }
        found = true;
        this.stop();
        accepted(b.code);
      });
      if (token !== this.epoch) {
        controls.stop();
        return;
      }
      this.controls = controls;
    } catch (e) {
      if (token === this.epoch) {
        this.stop();
        throw e;
      }
    }
  }
}
export function cameraError(e: any) {
  return e?.name === 'NotAllowedError'
    ? 'Camera permission was denied. On iPhone, allow Camera access in Safari’s website settings, then try again. Manual entry and photo upload are always available.'
    : e?.name === 'NotFoundError'
      ? 'No camera was found. Enter the barcode or upload a photo.'
      : 'Could not start the camera. Close other apps using it and retry, or enter the barcode below.';
}
