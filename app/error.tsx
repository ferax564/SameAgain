'use client';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px' }}>
      <h1>Something went wrong.</h1>
      <p>
        Same Again hit an unexpected problem. Changes you already made are kept on this device and
        will sync when the app opens again.
      </p>
      <button className="btn primary" onClick={() => reset()}>
        Try again
      </button>
    </main>
  );
}
