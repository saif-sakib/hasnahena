/** @type {import('next').NextConfig} */
const createNextIntlPlugin = require('next-intl/plugin');
const { withSentryConfig } = require('@sentry/nextjs');

const withNextIntl = createNextIntlPlugin('./i18n.ts');

const nextConfig = {
  // A separate dir lets the test stack run beside `pnpm dev` (Next 16 locks it).
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // WO-27. Top-level since Next 16 — under `experimental` it is silently
  // ignored. Needs babel-plugin-react-compiler. The registration form is skipped
  // (the lint's one "Compilation Skipped" notice).
  reactCompiler: true,

  // Standalone only for the Docker image (DOCKER_BUILD=1); Vercel ignores it.
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,

  // Prisma's engine is loaded by path, invisible to the tracer. Top-level since
  // Next 15 — under `experimental` the image ships without it.
  outputFileTracingIncludes: {
    '**': [
      './node_modules/.prisma/client/**',
      // Next 16 resolves @swc/helpers via its esm/ export, which the tracer
      // misses; the container dies at startup without it.
      '../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**',
    ],
  },

  experimental: {
    serverActions: {
      // Default is 1 MB; raised to 4 MB, under the platform's 4.5 MB cap.
      // Uploaders compress first, so this is a backstop.
      bodySizeLimit: '4mb',
    },
  },

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

// Sentry wraps the config last. Without SENTRY_AUTH_TOKEN it skips source maps.
module.exports = withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet unless something is actually wrong.
  silent: !process.env.CI,

  // Strip Sentry's debug logging (replaces the deprecated disableLogger).
  webpack: {
    treeshake: { removeDebugLogging: true },
  },

  // Uploaded to Sentry, then deleted from the deployed output.
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Through our own domain, so ad blockers cannot drop reports.
  tunnelRoute: '/monitoring',
});
