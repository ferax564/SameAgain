import { identity, query, responseError } from '@/lib/server';
export async function GET() {
  try {
    const u = await identity();
    const households = await query(
      'SELECT h.* FROM households h JOIN memberships m ON h.id=m.household WHERE m.user=?',
      u.id,
    );
    const records = await query(
      'SELECT r.* FROM records r JOIN memberships m ON r.household=m.household WHERE m.user=?',
      u.id,
    );
    const profile = await query('SELECT * FROM users WHERE id=?', u.id);
    return Response.json(
      {
        exported: new Date().toISOString(),
        profile,
        households,
        records: records.map((r) => ({ ...r, data: JSON.parse(r.data) })),
        licence:
          'Open Food Facts records: ODbL 1.0; contents DbCL 1.0; images CC BY-SA 3.0. Private household records remain separate.',
      },
      {
        headers: {
          'Content-Disposition': 'attachment; filename="same-again-export.json"',
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (e) {
    return responseError(e);
  }
}
