import Link from 'next/link';
import guide from './guide.json';

type Section = { heading: string; paragraphs?: string[]; bullets?: string[] };

/** User guide: how the app works and what its data can and cannot tell you. */
export default function Guide() {
  return (
    <main className="guide-page" style={{ maxWidth: 820, margin: '0 auto', padding: '40px 20px' }}>
      <Link href="/">← Back to Same Again</Link>
      <h1 style={{ marginTop: 24 }}>How Same Again works</h1>
      <p className="muted">Updated {guide.updated}.</p>
      <nav aria-label="Guide sections">
        <ul style={{ lineHeight: 1.8, listStyle: 'disc', paddingLeft: 24 }}>
          {(guide.sections as Section[]).map((s) => (
            <li key={s.heading}>
              <a href={'#' + anchor(s.heading)}>{s.heading}</a>
            </li>
          ))}
        </ul>
      </nav>
      {(guide.sections as Section[]).map((s) => (
        <section key={s.heading} id={anchor(s.heading)} style={{ marginTop: 32 }}>
          <h2>{s.heading}</h2>
          {s.paragraphs?.map((p) => (
            <p key={p} style={{ lineHeight: 1.7 }}>
              {p}
            </p>
          ))}
          {s.bullets && (
            <ul style={{ lineHeight: 1.7, listStyle: 'disc', paddingLeft: 24 }}>
              {s.bullets.map((b) => (
                <li key={b} style={{ marginBottom: 6 }}>
                  {b}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="muted" style={{ marginTop: 40 }}>
        Product data: Open Food Facts contributors (ODbL 1.0, images CC BY-SA 3.0). Generic foods:
        Swiss Food Composition Database, FSVO. Maps: OpenStreetMap contributors (ODbL).
      </p>
    </main>
  );
}
const anchor = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
