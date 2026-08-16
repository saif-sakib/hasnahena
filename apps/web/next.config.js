/** @type {import('next').NextConfig} */
const createNextIntlPlugin = require('next-intl/plugin');
const { withSentryConfig } = require('@sentry/nextjs');

const withNextIntl = createNextIntlPlugin('./i18n.ts');

const nextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // Standalone output is for the Docker image only (apps/web/Dockerfile), which
  // sets DOCKER_BUILD=1. Vercel builds its own serverless output and ignores
  // this setting, but leaving it on unconditionally changes what `pnpm build`
  // emits for everyone — and two Vercel builds have already been broken by a
  // build-config change this month. Opt in, do not opt out.
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,

  // Standalone traces the files each route actually imports and copies only
  // those. Prisma's query engine is loaded by path at runtime, not imported, so
  // the tracer cannot see it and the container starts and then fails on the
  // first query. Naming it here is what puts it in the output.
  //
  // Top-level, not under `experimental` — Next 15 promoted it. On 14 it was
  // `experimental.outputFileTracingIncludes`, and Next 15 warns rather than
  // errors if you leave it there, so this is silently ignorable and worth
  // stating: if it moves back under experimental, the Docker image ships
  // without a Prisma engine and dies on the first query.
  outputFileTracingIncludes: {
    '**': ['./node_modules/.prisma/client/**'],
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

// Sentry wraps the config last so it can see the fully-built webpack setup.
// With no SENTRY_AUTH_TOKEN it skips source-map upload and warns — a build
// must never fail because error tracking is unconfigured.
module.exports = withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Quiet unless something is actually wrong.
  silent: !process.env.CI,

  // Strips the Sentry SDK's own debug logging from the browser bundle. This
  // replaces the deprecated top-level `disableLogger`, which @sentry/nextjs 10
  // warns about on every build.
  webpack: {
    treeshake: { removeDebugLogging: true },
  },

  // Source maps are uploaded to Sentry and then deleted from the deployed
  // output, so a stack trace is readable in Sentry without publishing the
  // application's source to anyone who opens devtools.
  sourcemaps: { deleteSourcemapsAfterUpload: true },

  // Routes browser error reports through this app's own domain, so an ad
  // blocker cannot silently drop them.
  tunnelRoute: '/monitoring',
});
