import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
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

const appUrl = process.env.APP_URL || 'http://localhost:3000';
const siteTitle = 'cmnty — Panel Server Node.js & Python Self-Host';
const siteDescription =
  'Kelola, pantau, dan jalankan server Node.js serta Python secara real-time di VPS self-host dengan konsol dan file manager cmnty.';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#09090B' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  applicationName: 'cmnty',
  title: {
    default: siteTitle,
    template: '%s | cmnty',
  },
  description: siteDescription,
  keywords: [
    'cmnty',
    'panel server',
    'Node.js server panel',
    'Python server manager',
    'VPS self-host',
    'real-time console',
    'process monitor',
    'file manager',
  ],
  authors: [{ name: 'cmnty' }],
  creator: 'cmnty',
  publisher: 'cmnty',
  category: 'Developer Tools',
  alternates: {
    canonical: '/',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-snippet': -1,
      'max-image-preview': 'large',
      'max-video-preview': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'id_ID',
    url: '/',
    siteName: 'cmnty',
    title: siteTitle,
    description: siteDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
  },
};

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: 'cmnty',
  url: appUrl,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Linux',
  inLanguage: 'id',
  description: siteDescription,
  featureList: [
    'Manajemen proses Node.js & Python real-time',
    'Terminal console streaming interaktif',
    'Pemantauan CPU Load dan Memory real-time',
    'File Manager & editor kode terintegrasi',
  ],
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
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
      className={`dark ${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="font-sans antialiased bg-white text-zinc-950 dark:bg-[#09090B] dark:text-zinc-100 selection:bg-zinc-900 selection:text-white dark:selection:bg-zinc-100 dark:selection:text-zinc-950"
        suppressHydrationWarning
      >
        <script type="application/ld+json">{JSON.stringify(structuredData)}</script>
        {children}
      </body>
    </html>
  );
}
