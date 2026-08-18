/** @type {import('next').NextConfig} */
const createNextIntlPlugin = require('next-intl/plugin');
const { withSentryConfig } = require('@sentry/nextjs');

const withNextIntl = createNextIntlPlugin('./i18n.ts');

const nextConfig = {
  // Enable React strict mode for better development experience
  reactStrictMode: true,

  // WO-27. The compiler memoises components automatically, so the twenty
  // `set-state-in-effect` findings it used to report finally mean something at
  // runtime rather than only in the lint output — that is why they were cleared
  // first, and why turning this on is the last step of that order rather than
  // the first.
  //
  // Top-level, NOT under `experimental`. Next 16 promoted it; on 15 it was
  // `experimental.reactCompiler`, and leaving it there is silently ignored —
  // the build succeeds and nothing is compiled, which looks exactly like
  // success. Requires `babel-plugin-react-compiler` as a devDependency; without
  // it the build fails outright rather than quietly skipping.
  //
  // Next only runs the Babel plugin over files that actually contain JSX or
  // hooks, so the build-time cost is small. Components the compiler cannot
  // analyse — the registration form, which uses react-hook-form's `watch`
  // subscription — are skipped individually and reported by `pnpm lint` as
  // "Compilation Skipped". That is a notice, not a defect.
  reactCompiler: true,

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
    '**': [
      './node_modules/.prisma/client/**',
      // Next 16's require-hook resolves @swc/helpers through the package's
      // `exports` map, which points at ./esm/*. The tracer only follows the
      // CommonJS entry, so it copies cjs/ and package.json and stops — and the
      // container then dies at startup with "Cannot find module
      // .../@swc/helpers/esm/_interop_require_default.js" before it serves a
      // single request. Only reproducible by running the built image; the
      // build itself is perfectly happy.
      '../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**',
    ],
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
