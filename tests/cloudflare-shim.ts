import { readFile } from 'node:fs/promises';
import { database } from './runtime-harness';
const objects = new Map<string, { body: Uint8Array; httpMetadata: any }>();
export const env = {
  ASSETS: {
    async fetch(req: Request) {
      const path = new URL(req.url).pathname;
      if (
        !['/catalogue/swiss-retailer-products.json', '/catalogue/swiss-provenance.json'].includes(
          path,
        )
      )
        return new Response('', { status: 404 });
      return new Response(await readFile('public' + path));
    },
  },
  DB: database,
  BUCKET: {
    async put(key: string, body: Uint8Array, options: any) {
      objects.set(key, { body, httpMetadata: options.httpMetadata });
    },
    async get(key: string) {
      return objects.get(key);
    },
    async list(options?: any) {
      return {
        objects: [...objects.keys()]
          .filter((k) => !options?.prefix || k.startsWith(options.prefix))
          .map((key) => ({ key })),
        truncated: false,
      };
    },
    async delete(key: string) {
      objects.delete(key);
    },
  },
};
