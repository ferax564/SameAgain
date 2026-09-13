import {build} from 'esbuild';
import {resolve} from 'node:path';
await build({entryPoints:['tests/live-search-entry.ts'],outfile:'.sites-runtime/tests/live-search.mjs',bundle:true,platform:'node',format:'esm',alias:{'@/app/chatgpt-auth':resolve('tests/auth-shim.ts'),'next/headers':resolve('tests/headers-shim.ts'),'cloudflare:workers':resolve('tests/cloudflare-shim.ts')}});
await import('../.sites-runtime/tests/live-search.mjs');
