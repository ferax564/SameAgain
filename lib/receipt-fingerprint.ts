// Deduplication only. The same photo gets the same SHA-256 across browsers.
// Native SubtleCrypto is absent on some embedded/non-secure preview origins.
export async function receiptFingerprint(bytes:ArrayBuffer,subtle:Pick<SubtleCrypto,'digest'>|null=globalThis.crypto?.subtle||null){
 const digest=subtle?new Uint8Array(await subtle.digest('SHA-256',bytes)):(await import('@noble/hashes/sha256')).sha256(new Uint8Array(bytes));
 return Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('');
}
