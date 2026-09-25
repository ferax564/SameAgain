import Link from 'next/link';
import guide from './guide.json';
export default function Guide() {
  return (
    <main style={{ maxWidth: 900, padding: '40px 24px' }}>
      <Link href="/">← Back to Same Again</Link>
      <h1 style={{ marginTop: 25 }}>Same Again · technical guide</h1>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.8 }}>
        {guide}
      </pre>
    </main>
  );
}
