import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Nodal — Node.js & Python VPS Panel',
  description:
    'Panel manajemen server Node.js dan Python real-time untuk deployment VPS.',
  openGraph: {
    title: 'Nodal — Node.js & Python VPS Panel',
    description:
      'Panel manajemen server Node.js dan Python real-time untuk deployment VPS.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Nodal — Node.js & Python VPS Panel',
    description:
      'Panel manajemen server Node.js dan Python real-time untuk deployment VPS.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="id"
      className={`dark ${plusJakarta.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="font-sans antialiased bg-white text-zinc-950 dark:bg-[#09090B] dark:text-zinc-100 selection:bg-zinc-900 selection:text-white dark:selection:bg-zinc-100 dark:selection:text-zinc-950"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
