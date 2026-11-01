import type { NextConfig } from 'next';
const config: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  typescript: {
    tsconfigPath: process.env.NEXT_TYPESCRIPT_CONFIG ?? 'tsconfig.json',
  },
  output:
    process.env.DD_PLAYWRIGHT_MOCK === 'true' || process.env.DD_CUSTOMER_FULLSTACK === 'true'
      ? undefined
      : 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.dailydosepilates.com',
      },
      {
        protocol: 'https',
        hostname: 'v2.dailydosepilates.com',
      },
      {
        protocol: 'https',
        hostname: 'dailydosepilates.com',
      },
      {
        protocol: 'http',
        hostname: 'localhost',
      },
      {
        protocol: 'http',
        hostname: '127.0.0.1',
      },
    ],
  },
  devIndicators: false,
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${process.env.API_BASE_URL ?? 'http://127.0.0.1:32121'}/api/v1/:path*`,
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/guide',
        destination: '/help?role=customer',
        permanent: true,
      },
      {
        source: '/workspace/guide',
        destination: '/help?role=admin',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/check-in-pass',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store, max-age=0' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
        ],
      },
    ];
  },
};
export default config;
