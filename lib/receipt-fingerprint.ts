// Deduplication only. The same photo gets the same SHA-256 across browsers.
// Native SubtleCrypto is absent on some embedded/non-secure preview origins.
export async function receiptFingerprint(
  bytes: ArrayBuffer,
  subtle: Pick<SubtleCrypto, 'digest'> | null = globalThis.crypto?.subtle || null,
) {
  const digest = subtle
    ? new Uint8Array(await subtle.digest('SHA-256', bytes))
    : (await import('@noble/hashes/sha256')).sha256(new Uint8Array(bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
/**
 * Normalises pasted or OCR'd receipt text so trivial differences (line endings,
 * spacing, blank lines, case, Unicode forms) do not change the fingerprint.
 */
export function normaliseReceiptText(text: string) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .split(/\r?\n|\r/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}
// Deterministic fingerprint (SHA-256 hex, 64 chars) of receipt text for re-import detection.
export async function receiptTextFingerprint(
  text: string,
  subtle: Pick<SubtleCrypto, 'digest'> | null = globalThis.crypto?.subtle || null,
) {
  const bytes = new TextEncoder().encode(normaliseReceiptText(text));
  return receiptFingerprint(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    subtle,
  );
}
