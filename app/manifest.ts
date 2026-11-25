import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'cmnty — Panel Server Node.js & Python Self-Host',
    short_name: 'cmnty',
    description:
      'Kelola, pantau, dan jalankan server Node.js serta Python secara real-time secara self-host.',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090B',
    theme_color: '#09090B',
    lang: 'id',
  };
}
