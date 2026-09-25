'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Upload, ScanBarcode } from 'lucide-react';
import { barcode } from '@/lib/domain';
import { ScanSession, cameraError } from '@/lib/scan-session';
import { errorMessage } from '@/lib/utils';
export default function Scanner({
  onCode,
  onPrivate,
}: {
  onCode: (s: string) => void | Promise<void>;
  onPrivate?: (code: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    session = useRef(new ScanSession()),
    alive = useRef(true),
    uploadSerial = useRef(0);
  const [manual, setManual] = useState(''),
    [error, setError] = useState(''),
    [running, setRunning] = useState(false),
    [uploading, setUploading] = useState(false),
    [looking, setLooking] = useState(false),
    [recognised, setRecognised] = useState(''),
    [authRequired, setAuthRequired] = useState(false);
  const submitting = useRef(false);
  function stop() {
    session.current.stop();
    const stream = video.current?.srcObject as MediaStream;
    stream?.getTracks().forEach((t) => t.stop());
    setRunning(false);
  }
  useEffect(() => {
    alive.current = true;
    // Both refs are created once; capture them so cleanup acts on the same objects.
    const uploads = uploadSerial,
      scan = session.current;
    const hidden = () => {
      if (document.hidden) stop();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      uploads.current++;
      scan.stop();
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  function accept(code: string) {
    if (!alive.current || submitting.current) return;
    submitting.current = true;
    uploadSerial.current++;
    stop();
    setRecognised(code);
    setLooking(true);
    setError('');
    setAuthRequired(false);
    try {
      navigator.vibrate?.(50);
    } catch {}
    Promise.resolve()
      .then(() => onCode(code))
      .catch((e) => {
        if (alive.current) {
          setError(e.message || 'Product lookup failed. Please retry.');
          setAuthRequired(e.status === 401);
        }
      })
      .finally(() => {
        submitting.current = false;
        if (alive.current) setLooking(false);
      });
  }
  async function start() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'Camera scanning needs HTTPS and a supported browser. Enter the barcode or upload a photo.',
      );
      return;
    }
    setRunning(true);
    try {
      await session.current.run(
        async (found) => {
          const [{ BrowserMultiFormatReader }, { groceryHints }] = await Promise.all([
            import('@zxing/browser'),
            import('@/lib/barcode-reader'),
          ]);
          return new BrowserMultiFormatReader(groceryHints()).decodeFromConstraints(
            {
              video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
              audio: false,
            },
            video.current!,
            (result) => {
              if (result) found(result.getText());
            },
          );
        },
        accept,
        setError,
      );
    } catch (e) {
      if (alive.current) {
        setRunning(false);
        setError(cameraError(e));
      }
    }
  }
  async function uploaded(file?: File) {
    if (!file) return;
    stop();
    setError('');
    if (file.size > 10000000 || !file.type.startsWith('image/')) {
      setError('Choose an image under 10 MB.');
      return;
    }
    const attempt = ++uploadSerial.current;
    setUploading(true);
    try {
      const { decodePhoto } = await import('@/lib/barcode-reader');
      const result = await decodePhoto(file);
      if (!alive.current || attempt !== uploadSerial.current) return;
      const b = barcode(result);
      if (!b.valid) throw new Error();
      accept(b.code);
    } catch (e) {
      if (alive.current && attempt === uploadSerial.current)
        setError(
          errorMessage(e) ||
            'No readable barcode found. Try a sharp JPEG or PNG photo, or enter the digits.',
        );
    } finally {
      if (alive.current) setUploading(false);
    }
  }
  return (
    <div className="stack">
      <div className="camera">
        <video ref={video} muted playsInline autoPlay aria-label="Live barcode camera" />
        {!running && (
          <div className="camera-label">
            <ScanBarcode size={54} strokeWidth={1} />
            <p>Bring your usual back.</p>
            <button className="btn primary" disabled={uploading || looking} onClick={start}>
              <Camera size={18} /> Open camera
            </button>
          </div>
        )}
      </div>
      {running && (
        <button className="btn" onClick={stop}>
          Stop camera
        </button>
      )}
      <p className="muted">
        Centre the barcode in the camera. EAN-8, EAN-13 and UPC-A are supported. The camera stops
        when you leave this screen.
      </p>
      {recognised && (
        <p className="notice" role="status">
          Barcode recognised: <strong>{recognised}</strong>
          {looking ? ' · Looking up the product…' : ''}
        </p>
      )}
      {error && (
        <div className="stack">
          <p className="notice" role="alert">
            {error}
          </p>
          {authRequired ? (
            <a className="btn primary" href="/signin-with-chatgpt?return_to=%2F" target="_top">
              Sign in again
            </a>
          ) : (
            recognised && (
              <div className="row wrap">
                <button className="btn" disabled={looking} onClick={() => accept(recognised)}>
                  Retry {recognised}
                </button>
                {onPrivate && (
                  <button className="btn" onClick={() => onPrivate(recognised)}>
                    Add a private product
                  </button>
                )}
              </div>
            )
          )}
        </div>
      )}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const b = barcode(manual);
          if (b.valid) accept(b.code);
          else setError(b.error || 'Invalid barcode');
        }}
      >
        <input
          aria-label="Barcode number"
          inputMode="numeric"
          autoComplete="off"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Or enter barcode digits"
        />
        <button className="btn primary" type="submit" disabled={looking || uploading}>
          {looking ? 'Looking up…' : 'Look up'}
        </button>
      </form>
      <label className="btn">
        <Upload size={18} />
        {uploading ? 'Reading photo…' : 'Read barcode from photo'}
        <input
          type="file"
          accept="image/*"
          disabled={uploading || looking}
          className="sr-only"
          onChange={(e) => {
            void uploaded(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}
