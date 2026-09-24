'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Upload,
  RotateCw,
  ScanText,
  Plus,
  Check,
  Loader2,
  ArrowLeft,
  ReceiptText,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Choice } from './ui';
import { receiptFingerprint } from '@/lib/receipt-fingerprint';
import {
  parseReceipt,
  receiptListItem,
  validDate,
  type ReceiptDraft,
  type ReceiptItem,
} from '@/lib/receipt';
import {
  fullCrop,
  suggestPaperCrop,
  loadReceiptImage,
  rotatedReceipt,
  cropReceipt,
  type Crop,
} from '@/lib/receipt-image';
import type { RecordData } from '@/lib/domain';
import type { Worker } from 'tesseract.js';
import './receipt-scanner.css';
const languages = {
  deu: 'German',
  eng: 'English',
  fra: 'French',
  ita: 'Italian',
  spa: 'Spanish',
  por: 'Portuguese',
  nld: 'Dutch',
};
const currencies = {
  CHF: 'CHF',
  EUR: 'EUR',
  USD: 'USD',
  GBP: 'GBP',
  DKK: 'DKK',
  SEK: 'SEK',
  NOK: 'NOK',
  PLN: 'PLN',
  CZK: 'CZK',
  HUF: 'HUF',
  RON: 'RON',
  ISK: 'ISK',
};
export default function ReceiptScanner({
  lists,
  active,
  country,
  currency,
  onAdd,
}: {
  lists: RecordData[];
  active: string;
  country: string;
  currency: string;
  onAdd: (items: any[], list: string) => number;
}) {
  const [photo, setPhoto] = useState<HTMLImageElement>(),
    [turns, setTurns] = useState(0),
    [preview, setPreview] = useState(''),
    [crop, setCrop] = useState<Crop>(fullCrop),
    [language, setLanguage] = useState(
      ['CH', 'DE', 'AT'].includes(country)
        ? 'deu'
        : country === 'IT'
          ? 'ita'
          : country === 'FR'
            ? 'fra'
            : country === 'ES'
              ? 'spa'
              : 'eng',
    ),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [error, setError] = useState(''),
    [text, setText] = useState(''),
    [draft, setDraft] = useState<ReceiptDraft>(),
    [fingerprint, setFingerprint] = useState(''),
    [list, setList] = useState(active),
    [finished, setFinished] = useState<number | null>(null),
    [reviewed, setReviewed] = useState(false);
  const worker = useRef<Worker | null>(null),
    serial = useRef(0),
    adding = useRef(false),
    mounted = useRef(true),
    fileInput = useRef<HTMLInputElement>(null),
    cameraInput = useRef<HTMLInputElement>(null),
    canvas = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      serial.current++;
      void worker.current?.terminate();
      worker.current = null;
    };
  }, []);
  useEffect(() => {
    if (!photo) return;
    const c = rotatedReceipt(photo, turns);
    canvas.current = c;
    setPreview(c.toDataURL('image/jpeg', 0.8));
    const probe = document.createElement('canvas');
    probe.width = Math.round((c.width * 200) / Math.max(c.width, c.height));
    probe.height = Math.round((c.height * 200) / Math.max(c.width, c.height));
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(c, 0, 0, probe.width, probe.height);
    setCrop(
      suggestPaperCrop(
        ctx.getImageData(0, 0, probe.width, probe.height).data,
        probe.width,
        probe.height,
      ),
    );
  }, [photo, turns]);
  async function select(file?: File) {
    if (!file) return;
    cancel();
    const n = ++serial.current;
    setError('');
    setDraft(undefined);
    setFinished(null);
    setText('');
    setPhoto(undefined);
    setPreview('');
    setFingerprint('');
    try {
      const img = await loadReceiptImage(file);
      const digest = await receiptFingerprint(await file.arrayBuffer());
      if (!mounted.current || n !== serial.current) return;
      setFingerprint(digest);
      setPhoto(img);
      setTurns(0);
    } catch (e: any) {
      if (n === serial.current) setError(e.message);
    }
  }
  function cancel() {
    serial.current++;
    void worker.current?.terminate();
    worker.current = null;
    setBusy(false);
  }
  function review(t: string) {
    setReviewed(false);
    const parsed = parseReceipt(t);
    if (!parsed.currency) parsed.currency = currency;
    setDraft(parsed);
    setFinished(null);
    adding.current = false;
  }
  async function read() {
    if (!canvas.current) return;
    const n = ++serial.current;
    setBusy(true);
    setError('');
    setProgress('Loading receipt reader…');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let w: Worker | undefined;
    try {
      const result = await Promise.race([
        (async () => {
          const { createWorker, PSM } = await import('tesseract.js');
          w = await createWorker(language, 1, {
            workerPath: '/ocr/v7/worker.min.js',
            corePath: '/ocr/v7/core',
            langPath: '/ocr/v7/lang',
            workerBlobURL: false,
            logger: (m) => {
              if (mounted.current && n === serial.current)
                setProgress(
                  m.status === 'recognizing text'
                    ? `Reading receipt · ${Math.round(m.progress * 100)}%`
                    : 'Preparing receipt reader…',
                );
            },
          });
          if (!mounted.current || n !== serial.current) {
            await w.terminate();
            return null;
          }
          worker.current = w;
          await w.setParameters({
            tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
            preserve_interword_spaces: '1',
          });
          return await w.recognize(cropReceipt(canvas.current!, crop), { rotateAuto: true });
        })(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(
                new Error(
                  'Reading took too long. Crop closer to the item table or paste the receipt text.',
                ),
              ),
            90000,
          );
        }),
      ]);
      if (!mounted.current || n !== serial.current || !result) return;
      setText(result.data.text);
      review(result.data.text);
    } catch (e: any) {
      if (mounted.current && n === serial.current)
        setError(
          e.message || 'Could not read this photo. Try a sharper JPEG or paste the text below.',
        );
    } finally {
      clearTimeout(timeout);
      if (w) void w.terminate();
      if (worker.current === w) worker.current = null;
      if (mounted.current && n === serial.current) {
        setBusy(false);
        serial.current++;
      }
    }
  }
  function edit(key: string, patch: Partial<ReceiptItem>) {
    setReviewed(false);
    setDraft(
      (d) => d && { ...d, items: d.items.map((i) => (i.key === key ? { ...i, ...patch } : i)) },
    );
  }
  function addSelected() {
    if (!draft || adding.current || !reviewed) return;
    setError('');
    try {
      if (!list) throw new Error('Choose an active shopping list first.');
      if (draft.date && !validDate(draft.date)) throw new Error('Check the purchase date.');
      const selected = draft.items.filter((i) => i.selected);
      if (!selected.length) throw new Error('Select at least one item.');
      const id = fingerprint || crypto.randomUUID();
      const items = selected.map((i) =>
        receiptListItem(
          i,
          {
            fingerprint: id,
            store: draft.store.trim(),
            date: draft.date,
            currency: draft.currency,
          },
          list,
        ),
      );
      adding.current = true;
      const count = onAdd(items, list);
      setFinished(count);
    } catch (e: any) {
      adding.current = false;
      setError(e.message);
    }
  }
  const selected = draft?.items.filter((i) => i.selected) || [];
  return (
    <div className="receipt-flow stack">
      {finished !== null ? (
        <div className="receipt-success stack">
          <Check size={40} />
          <h3>{finished ? `${finished} items added` : 'These items are already on the list'}</h3>
          <p>
            The shared list keeps your reviewed names and quantities. You can check them off, edit
            them, and buy them again from shopping history.
          </p>
          <p className="fine">
            Changes use the list’s normal sync queue. When offline, keep this device’s data until
            they have synced.
          </p>
          <button
            className="btn"
            onClick={() => {
              setDraft(undefined);
              setFinished(null);
              setPhoto(undefined);
              setText('');
              setFingerprint('');
              adding.current = false;
            }}
          >
            Scan another receipt
          </button>
        </div>
      ) : (
        <>
          {!draft && (
            <>
              <div className="receipt-intro">
                <ReceiptText size={28} />
                <div>
                  <h3>A past shop. Your next list.</h3>
                  <p className="muted">
                    Photograph the item table in good light. Review every row before adding.
                  </p>
                </div>
              </div>
              <div className="row wrap">
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => cameraInput.current?.click()}
                >
                  <Camera size={18} /> Take a photo
                </button>
                <button className="btn" disabled={busy} onClick={() => fileInput.current?.click()}>
                  <Upload size={18} /> Choose photo
                </button>
              </div>
              <input
                ref={cameraInput}
                className="receipt-file"
                type="file"
                accept="image/*"
                capture="environment"
                aria-label="Take a receipt photo"
                onChange={(e) => {
                  void select(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <input
                ref={fileInput}
                className="receipt-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                aria-label="Upload receipt photo"
                onChange={(e) => {
                  void select(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {photo && (
                <>
                  <div className="receipt-photo-wrap">
                    <div className="receipt-photo">
                      <img src={preview} alt="Your receipt, with the selected reading area" />
                      <div
                        className="receipt-crop"
                        style={{
                          left: crop.left + '%',
                          top: crop.top + '%',
                          right: 100 - crop.right + '%',
                          bottom: 100 - crop.bottom + '%',
                        }}
                      />
                    </div>
                  </div>
                  <div className="row wrap">
                    <button className="btn" disabled={busy} onClick={() => setTurns((t) => t + 1)}>
                      <RotateCw size={17} /> Rotate
                    </button>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => setCrop({ ...fullCrop })}
                    >
                      Use whole photo
                    </button>
                  </div>
                  <details>
                    <summary>Adjust reading area</summary>
                    <p className="fine">
                      Keep the product names, quantities and rightmost prices inside the green
                      border.
                    </p>
                    <div className="formgrid">
                      {(['left', 'right', 'top', 'bottom'] as const).map((k) => (
                        <label key={k}>
                          {k[0].toUpperCase() + k.slice(1)} edge · {crop[k]}%
                          <input
                            type="range"
                            aria-label={k + ' crop edge'}
                            disabled={busy}
                            min={k === 'right' ? crop.left + 5 : k === 'bottom' ? crop.top + 5 : 0}
                            max={
                              k === 'left' ? crop.right - 5 : k === 'top' ? crop.bottom - 5 : 100
                            }
                            value={crop[k]}
                            onChange={(e) =>
                              setCrop((c) => ({ ...c, [k]: Number(e.target.value) }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </details>
                  <label>
                    Receipt language
                    <Choice
                      label="Receipt language"
                      options={languages}
                      value={language}
                      onChange={setLanguage}
                    />
                  </label>
                  {busy ? (
                    <div className="row wrap">
                      <Loader2 className="spin" />
                      <span role="status">{progress}</span>
                      <button className="btn" onClick={cancel}>
                        Cancel reading
                      </button>
                    </div>
                  ) : (
                    <button className="btn primary" onClick={read}>
                      <ScanText size={19} /> Read receipt
                    </button>
                  )}
                </>
              )}
              <details>
                <summary>Paste or type receipt text</summary>
                <label>
                  Item rows
                  <textarea
                    rows={7}
                    maxLength={40000}
                    placeholder={'Milk 1 2.50 2.50\nBread 2 1.80 3.60'}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </label>
                <button
                  className="btn"
                  disabled={busy || !text.trim()}
                  onClick={() => {
                    setFingerprint('');
                    review(text);
                  }}
                >
                  Review text
                </button>
              </details>
              <p className="fine">
                Photos and full receipt text stay on this device and are discarded when this window
                closes. Only approved item details are shared with your household. The first scan
                needs a connection to load the reader. JPEG, PNG and WebP work best; HEIC depends on
                your browser.
              </p>
            </>
          )}
          {draft && (
            <>
              <button className="link row" onClick={() => setDraft(undefined)}>
                <ArrowLeft size={17} /> Back to photo or text
              </button>
              {photo && (
                <details>
                  <summary>View receipt photo while reviewing</summary>
                  <img
                    src={preview}
                    alt="Receipt photo for checking recognised rows"
                    style={{ width: '100%', height: 'auto' }}
                  />
                </details>
              )}
              <div className="notice">
                Receipt abbreviations do not identify exact products. Items are added as generic
                groceries, with no inferred barcode, ingredients or nutrition. Rows with unclear
                quantities start deselected.
              </div>
              {draft.warnings.map((w, i) => (
                <p className="fine" key={i}>
                  {w}
                </p>
              ))}
              <div className="formgrid">
                <label>
                  Store
                  <input
                    maxLength={160}
                    placeholder="Store or branch"
                    value={draft.store}
                    onChange={(e) => setDraft({ ...draft, store: e.target.value })}
                  />
                </label>
                <label>
                  Purchase date (optional)
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                  />
                </label>
                <label>
                  Receipt currency
                  <Choice
                    label="Receipt currency"
                    value={draft.currency}
                    options={currencies}
                    onChange={(v) => setDraft({ ...draft, currency: v })}
                  />
                </label>
                <label>
                  Add to list
                  <Choice
                    label="Receipt destination list"
                    value={list}
                    options={Object.fromEntries(lists.map((l) => [l.id, l.data.name]))}
                    onChange={setList}
                  />
                </label>
              </div>
              <div className="row between wrap">
                <h3>{draft.items.length} rows to review</h3>
                <button
                  className="link"
                  onClick={() => {
                    setReviewed(false);
                    setDraft({
                      ...draft,
                      items: draft.items.map((i) => ({
                        ...i,
                        selected: selected.length !== draft.items.length,
                      })),
                    });
                  }}
                >
                  {selected.length === draft.items.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="receipt-rows">
                {draft.items.map((i, n) => (
                  <article className="receipt-row" key={i.key}>
                    <label className="receipt-select">
                      <Checkbox
                        checked={i.selected}
                        onCheckedChange={(v) => edit(i.key, { selected: !!v })}
                        aria-label={'Buy again ' + i.name}
                      />
                      <span>{n + 1}</span>
                    </label>
                    <div className="stack">
                      <label>
                        Item name
                        <input
                          maxLength={160}
                          value={i.name}
                          onChange={(e) => edit(i.key, { name: e.target.value })}
                        />
                      </label>
                      <div className="receipt-amounts">
                        <label>
                          Quantity
                          <input
                            type="number"
                            min="0.001"
                            max="10000"
                            step="any"
                            value={i.quantity || ''}
                            onChange={(e) => edit(i.key, { quantity: Number(e.target.value) })}
                          />
                        </label>
                        <label>
                          Unit
                          <Choice
                            label={'Unit for row ' + (n + 1)}
                            options={{
                              piece: 'pieces',
                              pack: 'packs',
                              kg: 'kg',
                              g: 'g',
                              l: 'litres',
                              ml: 'ml',
                            }}
                            value={i.unit}
                            onChange={(v) => edit(i.key, { unit: v as ReceiptItem['unit'] })}
                          />
                        </label>
                        <label>
                          Pack size
                          <input
                            maxLength={100}
                            placeholder="Unknown"
                            value={i.pack}
                            onChange={(e) => edit(i.key, { pack: e.target.value })}
                          />
                        </label>
                      </div>
                      {i.warnings.map((w, k) => (
                        <p className="fine" key={k}>
                          Check: {w}
                        </p>
                      ))}
                      <details>
                        <summary>Receipt line & past price</summary>
                        <p className="receipt-raw">{i.raw || 'Manually added row'}</p>
                        <label>
                          Past line total ({draft.currency})
                          <input
                            type="number"
                            min="0"
                            max="100000"
                            step="0.01"
                            value={i.lineTotal ?? ''}
                            onChange={(e) =>
                              edit(i.key, {
                                lineTotal:
                                  e.target.value === '' ? undefined : Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      </details>
                    </div>
                  </article>
                ))}
              </div>
              <button
                className="btn"
                onClick={() =>
                  setDraft({
                    ...draft,
                    items: [
                      ...draft.items,
                      {
                        key: crypto.randomUUID(),
                        name: '',
                        quantity: 1,
                        unit: 'piece',
                        pack: '',
                        raw: '',
                        warnings: [],
                        selected: true,
                      },
                    ],
                  })
                }
                disabled={draft.items.length >= 100}
              >
                <Plus size={18} /> Add a missed item
              </button>
              <details>
                <summary>Check recognised text</summary>
                <pre className="receipt-raw">{text}</pre>
              </details>
              <div className="receipt-summary">
                <p>
                  <strong>{selected.length} selected</strong> ·{' '}
                  {selected.reduce((sum, i) => sum + (i.lineTotal || 0), 0).toFixed(2)}{' '}
                  {draft.currency} in recorded past line totals
                </p>
                <p className="fine">
                  {selected.filter((i) => i.lineTotal === undefined).length} selected rows without a
                  price.{' '}
                  {draft.total !== undefined
                    ? `Printed receipt total: ${draft.total.toFixed(2)} ${draft.currency}. `
                    : ''}
                  Past prices are not estimates for your next shop.
                </p>
                <label className="row">
                  <Checkbox
                    checked={reviewed}
                    onCheckedChange={(v) => setReviewed(!!v)}
                    aria-label="I checked the selected items"
                  />{' '}
                  I checked the selected names, quantities and units.
                </label>
                <button
                  className="btn primary"
                  disabled={!selected.length || !list || busy || !reviewed}
                  onClick={addSelected}
                >
                  <Plus size={18} /> Add {selected.length} to list
                </button>
              </div>
            </>
          )}
        </>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
