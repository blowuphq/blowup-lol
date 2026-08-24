import type { Metadata } from 'next';
import React from 'react';

export const metadata: Metadata = {
  title: 'Blowup.io',
  description: 'Pay to rank. Watch the board move.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
