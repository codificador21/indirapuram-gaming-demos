import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Toaster } from '@/components/toaster';
import { ServiceWorker } from '@/components/service-worker';
import { APP_NAME, THEME_COLORS } from '@/lib/theme';
import { currentTheme } from '@/lib/theme-server';
import './globals.css';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: 'Personal expense tracker with automatic SMS & email capture and a daily safe-to-spend budget.',
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false, email: false, address: false },
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export async function generateViewport(): Promise<Viewport> {
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: THEME_COLORS[await currentTheme()],
  };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = await currentTheme();
  return (
    <html lang="en-IN" data-theme={theme} suppressHydrationWarning>
      <body className="antialiased">
        {children}
        <Toaster />
        <ServiceWorker />
      </body>
    </html>
  );
}
