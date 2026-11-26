import type { MetadataRoute } from 'next';

function resolveBaseUrl(): string {
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

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = resolveBaseUrl();
  return [
    {
      url: `${baseUrl}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1,
    },
  ];
}
