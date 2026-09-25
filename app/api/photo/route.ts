import { env } from 'cloudflare:workers';
import {
  identity,
  member,
  sameOrigin,
  fail,
  responseError,
  rate,
  one,
  run,
  DAY,
} from '@/lib/server';
import { cleanPhoto, HOUSEHOLD_PHOTO_QUOTA } from '@/lib/photo-files';

async function acceptingUploads(h: string) {
  const house = await one('SELECT deleting FROM households WHERE id=?', h);
  return Boolean(house && !house.deleting);
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const u = await identity();
    await rate('photo:' + u.id, 10);
    await rate('photo-day:' + u.id, 100, DAY);
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
    if (!(await acceptingUploads(h))) fail('This household is being deleted.', 410);
    // Metadata (EXIF GPS, text chunks) is stripped here as well as on the
    // device, so direct API uploads cannot keep location details.
    const photo = cleanPhoto(new Uint8Array(await file.arrayBuffer()), file.type);
    const used = await one(
      'SELECT COALESCE(SUM(bytes),0) AS total FROM photos WHERE household=?',
      h,
    );
    if (Number(used?.total || 0) + photo.bytes.length > HOUSEHOLD_PHOTO_QUOTA)
      fail(
        'This household has reached its 200 MB photo storage limit. Delete old photos first.',
        413,
      );
    const key = h + '/' + crypto.randomUUID();
    await env.BUCKET.put(key, photo.bytes, { httpMetadata: { contentType: photo.type } });
    await run(
      'INSERT INTO photos(key,household,bytes,created) VALUES(?,?,?,?)',
      key,
      h,
      photo.bytes.length,
      Date.now(),
    );
    // The household may have been deleted while the upload was in flight.
    if (!(await acceptingUploads(h))) {
      await env.BUCKET.delete(key);
      await run('DELETE FROM photos WHERE key=?', key);
      fail('This household is being deleted.', 410);
    }
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
