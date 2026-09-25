import { env } from 'cloudflare:workers';
import foods from '@/lib/swiss-foods.json';
import { identity, responseError } from '@/lib/server';

type Provenance = {
  version: string;
  attribution: string;
  sources: Record<string, unknown>;
  records: Record<string, { synonyms?: string } & Record<string, unknown>>;
};
type Assets = { fetch(request: Request): Promise<Response> };

// The 2.5 MB provenance file is a static asset loaded once per isolate, not
// part of the Worker bundle.
let loaded: Promise<Provenance> | undefined;
function provenance(requestUrl: string) {
  if (!loaded)
    loaded = (async () => {
      const assets = (env as unknown as { ASSETS?: Assets }).ASSETS;
      if (!assets) throw new Error('Static assets unavailable');
      const r = await assets.fetch(
        new Request(new URL('/catalogue/swiss-provenance.json', requestUrl)),
      );
      if (!r.ok) throw new Error('Food provenance asset unavailable');
      return (await r.json()) as Provenance;
    })().catch((e) => {
      loaded = undefined;
      throw e;
    });
  return loaded;
}

export async function GET(req: Request) {
  try {
    await identity();
    const p = new URL(req.url).searchParams,
      q = (p.get('q') || '').trim().toLowerCase().slice(0, 100),
      id = p.get('id');
    const source = await provenance(req.url);
    if (id) {
      const product = foods.find((f) => f.id === id);
      return Response.json(
        {
          product,
          provenance: Object.hasOwn(source.records, id) ? source.records[id] : undefined,
          sources: source.sources,
        },
        { status: product ? 200 : 404 },
      );
    }
    const terms = q.split(/\s+/).filter(Boolean);
    return Response.json(
      {
        products: terms.length
          ? foods
              .filter((f) =>
                terms.every((t) =>
                  (
                    f.name +
                    ' ' +
                    f.categories.join(' ') +
                    ' ' +
                    ((Object.hasOwn(source.records, f.id) && source.records[f.id].synonyms) || '')
                  )
                    .toLowerCase()
                    .includes(t),
                ),
              )
              .slice(0, 30)
          : [],
        total: foods.length,
        source: source.attribution,
        version: source.version,
      },
      { headers: { 'Cache-Control': 'private, max-age=3600' } },
    );
  } catch (e) {
    return responseError(e);
  }
}
