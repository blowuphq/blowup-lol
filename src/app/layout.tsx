import type { Metadata } from 'next';
import React from 'react';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Blowup',
  description:
    'A live discovery marketplace for YouTube creators. Bid for placement, compete for attention, blow up your channel.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.variable} bg-zinc-950 font-sans antialiased`}>
        {children}
      </body>
    </html>
  );
}
