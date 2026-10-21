import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle: smaller deploys, `node .next/standalone/server.js` also works.
  output: 'standalone',
  // These are only used server-side (ingest pipeline / IMAP); keep them out of the bundler.
  serverExternalPackages: ['pg', 'imapflow', 'mailparser'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
