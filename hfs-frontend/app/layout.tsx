import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Archivo } from 'next/font/google';
import './globals.css';

const archivo = Archivo({ subsets: ['latin'], variable: '--font-sans', display: 'swap', axes: ['wdth'] });

export const metadata: Metadata = {
  title: 'Hidden Force Studio',
  description: 'A film where a kid like yours saves the day. Pick a hero, and half an hour later their ADHD, autism, deafness, anxiety, dyslexia or wheelchair is the reason they win. A script that gets the kid wrong never gets made.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = { themeColor: '#F6F2EA', width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>{children}</body>
    </html>
  );
}
