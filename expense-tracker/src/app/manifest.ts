import type { MetadataRoute } from 'next';
import { APP_NAME } from '@/lib/theme';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${APP_NAME} — expense tracker`,
    short_name: APP_NAME,
    description: 'Automatic expense tracking from bank SMS & email, with a daily safe-to-spend budget.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d0d0d',
    theme_color: '#0d0d0d',
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Add transaction', short_name: 'Add', url: '/add', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
      { name: 'Review inbox', short_name: 'Review', url: '/review' },
    ],
  };
}
