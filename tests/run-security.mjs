import { build } from 'esbuild';
import { resolve } from 'node:path';
await build({
  entryPoints: [
    'tests/security-entry.ts',
    'tests/extended-entry.ts',
    'tests/meals-entry.ts',
    'tests/barcode-entry.ts',
    'tests/search-entry.ts',
    'tests/receipt-entry.ts',
    'tests/release-entry.ts',
    'tests/domain-fixes-entry.ts',
    'tests/sync-fixes-entry.ts',
    'tests/server-fixes-entry.ts',
    'tests/health-entry.ts',
  ],
  outdir: '.sites-runtime/tests',
  bundle: true,
  external: ['react', 'react-dom', 'tesseract.js', 'lucide-react', 'radix-ui'],
  platform: 'node',
  format: 'esm',
  outExtension: { '.js': '.mjs' },
  alias: {
    '@/app/chatgpt-auth': resolve('tests/auth-shim.ts'),
    'next/headers': resolve('tests/headers-shim.ts'),
    'cloudflare:workers': resolve('tests/cloudflare-shim.ts'),
  },
});
await import('../.sites-runtime/tests/security-entry.mjs');
await import('../.sites-runtime/tests/extended-entry.mjs');

await import('../.sites-runtime/tests/meals-entry.mjs');

await import('../.sites-runtime/tests/barcode-entry.mjs');

await import('../.sites-runtime/tests/search-entry.mjs');

await import('../.sites-runtime/tests/receipt-entry.mjs');

await import('../.sites-runtime/tests/release-entry.mjs');

await import('../.sites-runtime/tests/domain-fixes-entry.mjs');
await import('../.sites-runtime/tests/sync-fixes-entry.mjs');
await import('../.sites-runtime/tests/server-fixes-entry.mjs');
await import('../.sites-runtime/tests/health-entry.mjs');
