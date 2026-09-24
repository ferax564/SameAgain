import { env } from 'cloudflare:workers';
import { identity, member, sameOrigin, fail, responseError, rate } from '@/lib/server';
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const u = await identity();
    await rate('photo:' + u.id, 10);
    if (Number(req.headers.get('content-length')) > 3100000)
      fail('Choose a photo under 3 MB.', 413);
    const reader = req.body?.getReader();
    if (!reader) fail('Choose a photo.');
    let length = 0;
    const chunks: Uint8Array[] = [];
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.length;
      if (length > 3100000) {
        await reader.cancel();
        fail('Choose a photo under 3 MB.', 413);
      }
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    const f = await new Request(req.url, {
        method: 'POST',
        headers: { 'content-type': req.headers.get('content-type') || '' },
        body,
      }).formData(),
      h = String(f.get('household'));
    await member(h, u.id);
    const file = f.get('file');
    if (!(file instanceof File) || file.size > 3000000 || file.size < 24)
      fail('Choose a photo under 3 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const jpg =
        file.type === 'image/jpeg' &&
        bytes[bytes.length - 2] === 255 &&
        bytes[bytes.length - 1] === 217 &&
        bytes[0] === 255 &&
        bytes[1] === 216 &&
        bytes[2] === 255,
      png =
        file.type === 'image/png' &&
        [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) &&
        String.fromCharCode(...bytes.slice(12, 16)) === 'IHDR';
    if (!jpg && !png) fail('Use a JPEG or PNG photo.');
    const key = h + '/' + crypto.randomUUID();
    await env.BUCKET.put(key, bytes, {
      httpMetadata: { contentType: jpg ? 'image/jpeg' : 'image/png' },
    });
    return Response.json({ url: '/api/photo?key=' + encodeURIComponent(key) });
  } catch (e) {
    return responseError(e);
  }
}
export async function GET(req: Request) {
  try {
    const u = await identity(),
      key = new URL(req.url).searchParams.get('key') || '';
    await member(key.split('/')[0], u.id);
    const obj = await env.BUCKET.get(key);
    if (!obj) fail('Photo not found', 404);
    return new Response(obj.body, {
      headers: {
        'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
        'Cache-Control': 'private,no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    return responseError(e);
  }
}
