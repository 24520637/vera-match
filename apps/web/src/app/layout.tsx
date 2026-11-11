import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'VERA Match — Project Starter',
  description: 'Private matchmaking with consent-controlled expert video reviews.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="header">
          <a href="/">VERA Match</a>
          <span>Development starter</span>
        </header>
        <main>{children}</main>
        <footer>This repository is an implementation scaffold. Core user journeys are not implemented yet.</footer>
      </body>
    </html>
  );
}
