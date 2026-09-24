'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Scanner from '../scanner';
import { Photo } from '../ui';
import { barcode } from '@/lib/domain';
import '../same-again.css';
export default function DeviceCheck() {
  const [checks, setChecks] = useState<any>(),
    [code, setCode] = useState(''),
    [product, setProduct] = useState<any>(),
    [lookup, setLookup] = useState(''),
    [checking, setChecking] = useState(false);
  async function check(value: string) {
    setCode(value);
    setProduct(undefined);
    setLookup('Looking up the product…');
    try {
      const r = await fetch('/api/catalogue?' + new URLSearchParams({ barcode: value }), {
        signal: AbortSignal.timeout(25000),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Lookup failed');
      setProduct(d.product);
      setLookup(
        d.product
          ? d.notice || 'Product found in the catalogue.'
          : 'Barcode recognised; no catalogue product found. You can create a private product from your household scanner.',
      );
    } catch (e: any) {
      setLookup(e.message || 'Lookup unavailable. Please retry.');
    }
  }
  async function sample() {
    setChecking(true);
    try {
      const { decodePhoto } = await import('@/lib/barcode-reader');
      const response = await fetch('/barcode-check/ean13.png');
      const value = await decodePhoto(
        new File([await response.blob()], 'ean13.png', { type: 'image/png' }),
      );
      await check(barcode(value).code);
    } catch (e: any) {
      setLookup(e.message);
    } finally {
      setChecking(false);
    }
  }
  useEffect(() => {
    const update = () =>
      setChecks({
        secure: window.isSecureContext,
        camera: !!navigator.mediaDevices?.getUserMedia,
        online: navigator.onLine,
        worker: !!navigator.serviceWorker?.controller,
        installed:
          window.matchMedia('(display-mode: standalone)').matches ||
          (navigator as any).standalone === true,
      });
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    navigator.serviceWorker?.addEventListener('controllerchange', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      navigator.serviceWorker?.removeEventListener('controllerchange', update);
    };
  }, []);
  return (
    <main style={{ maxWidth: 760, margin: 'auto', padding: '32px 20px' }} className="stack">
      <Link href="/" className="link">
        ← Back to Same Again
      </Link>
      <span className="eyebrow">DEVICE CHECK</span>
      <h1>Ready for the next shop?</h1>
      <p className="muted">
        Run this on the phone you will shop with. Capability checks do not prove that a physical
        barcode or an offline trip works.
      </p>
      {checks && (
        <section className="card stack" aria-live="polite">
          {[
            [
              'Secure connection',
              checks.secure ? 'Available' : 'Required for camera and offline shell',
            ],
            [
              'Camera API',
              checks.camera
                ? 'Available; permission still needed'
                : 'Use manual entry or photo upload',
            ],
            ['Connection', checks.online ? 'Online' : 'Offline'],
            [
              'Offline shell',
              checks.worker
                ? 'Service worker controls this page'
                : 'Open Same Again online, then reload this page',
            ],
            [
              'Home Screen app',
              checks.installed ? 'Installed view' : 'In Safari: Share → Add to Home Screen',
            ],
          ].map(([name, value]) => (
            <div className="row between" key={name}>
              <strong>{name}</strong>
              <span>{value}</span>
            </div>
          ))}
        </section>
      )}
      <section className="card stack">
        <h2>1. Try a real barcode</h2>
        <p>
          Allow the rear camera, scan an EAN-13, EAN-8 or UPC-A package, then check that the digits
          match. Hold it steady to check for duplicate reads. Close the scanner and confirm the
          camera indicator stops.
        </p>
        {code ? (
          <div className="notice" role="status">
            <strong>Recognised: {code}</strong>
            <p>{lookup}</p>
            {product && (
              <div className="row">
                <Photo product={product} />
                <div>
                  <strong>{product.name}</strong>
                  <p>
                    {product.pack || 'Pack size unknown'} · {product.barcode}
                  </p>
                  <p className="fine">
                    {product.source} · retrieved {new Date(product.retrieved).toLocaleDateString()}
                  </p>
                </div>
              </div>
            )}
            <p>No shopping item was added or published.</p>
            <button className="btn" onClick={() => void check(code)}>
              Retry database lookup
            </button>
            <button className="btn" onClick={() => setCode('')}>
              Scan another
            </button>
          </div>
        ) : (
          <Scanner onCode={check} />
        )}
        <div className="stack">
          {!code && lookup && (
            <p className="notice" role="alert">
              {lookup}
            </p>
          )}
          <button className="btn" disabled={checking} onClick={() => void sample()}>
            {checking ? 'Checking image…' : 'Check the built-in barcode image'}
          </button>
          <p className="fine">
            This decodes a generated EAN-13 image through the same photo reader, then looks up
            7610097171076. It does not test camera hardware. Sign in through the home page for
            catalogue access.
          </p>
        </div>
      </section>
      <section className="card stack">
        <h2>2. Try an offline shop with someone</h2>
        <ol className="device-steps">
          <li>Open your own household online on two signed-in devices. Both should show Synced.</li>
          <li>
            On this phone, enable airplane mode and turn Wi-Fi off. Return to an already loaded
            list.
          </li>
          <li>
            Add “Offline device test”, change its quantity and check it off. The status should say
            Offline. Reload the list to verify the saved change survives.
          </li>
          <li>
            Reconnect. Wait for Synced and confirm the second device sees one purchased item with
            your name.
          </li>
          <li>
            Repeat while the other person edits the same item. Review the conflict; neither person’s
            changes should be silently overwritten.
          </li>
          <li>
            Remove your test item when finished. An undo must not silently reverse another person’s
            later edit.
          </li>
        </ol>
        <p className="notice">
          A test is complete only after checking the second device. This page does not certify
          offline recovery or physical iPhone scanning automatically.
        </p>
      </section>
      <section className="card">
        <h2>3. Check family access</h2>
        <p>
          The Site owner grants each person Site access through ChatGPT’s Site sharing controls.
          Then a household owner or administrator creates a separate, single-use household
          invitation. If the Site itself says Access denied, the household invitation cannot resolve
          it.
        </p>
      </section>
    </main>
  );
}
