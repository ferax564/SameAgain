'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '48px 24px' }}>
        <h1>Same Again could not load.</h1>
        <p>Changes you already made are kept on this device. Reload to try again.</p>
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
