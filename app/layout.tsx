import type { Metadata, Viewport } from 'next';
import './globals.css';

function resolveAppUrl(): string {
  const candidate =
    process.env.APP_URL?.trim() ||
    (process.env.RAILWAY_PUBLIC_DOMAIN?.trim()
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.trim()}`
      : '') ||
    'http://localhost:3000';
  const normalized = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  try {
    return new URL(normalized).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

const appUrl = resolveAppUrl();
const siteTitle = 'cmnty — Node.js & Python Server Management Panel';
const siteDescription =
  'Panel manajemen server mandiri untuk mengelola aplikasi Node.js dan Python secara real-time di server maupun Railway.';

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
    'server panel',
    'Node.js manager',
    'Python server',
    'host dashboard',
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
  '@type': 'SoftwareApplication',
  name: 'cmnty',
  url: appUrl,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Linux',
  inLanguage: 'id',
  description: siteDescription,
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
    <html lang="id" className="dark" suppressHydrationWarning>
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
