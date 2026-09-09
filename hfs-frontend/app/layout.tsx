import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'Hidden Force Studio',
  description: 'Pick a kid hero with a hidden power. The studio writes the story, checks it against real guidance on how to show that kid right, then draws and films it. If a script gets the kid wrong, it says no.',
};

export const viewport: Viewport = { themeColor: '#0a0d12', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
