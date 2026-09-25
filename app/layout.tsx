import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Same Again',
  description: 'Your family favourites. One shared list. Find them wherever you are.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: { capable: true, title: 'Same Again', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f8f9f5' },
    { media: '(prefers-color-scheme: dark)', color: '#14241f' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Synchronous and same-origin so it runs before first paint and satisfies a strict CSP. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/theme-init.js" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
