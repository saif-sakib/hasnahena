# =============================================================================
#  Hasnahena web app (WO-21). Build from the REPOSITORY ROOT (pnpm workspace):
#      docker build -f apps/web/Dockerfile -t hasnahena-web .
#  bookworm-slim on purpose: Prisma's engine must match libc/OpenSSL
#  (debian-openssl-3.0.x). Alpine needs a musl binaryTarget in schema.prisma.
# =============================================================================

ARG NODE_IMAGE=node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03

# --- Stage 1: dependencies ---------------------------------------------------
FROM ${NODE_IMAGE} AS deps
WORKDIR /src

# Without openssl, Prisma guesses openssl-1.1.x and fails at the first query.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@8.15.4 --activate

# Manifests only, so this layer survives every source-only change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
# `postinstall` runs `prisma generate`, which needs the schema present.
COPY apps/web/prisma apps/web/prisma

# prisma generate parses DATABASE_URL but never connects to it — the schema is
# the only input. A placeholder here keeps a real credential out of the build.
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/placeholder
RUN pnpm install --frozen-lockfile

# --- Stage 2: build ----------------------------------------------------------
FROM ${NODE_IMAGE} AS build
WORKDIR /src

RUN corepack enable && corepack prepare pnpm@8.15.4 --activate

COPY --from=deps /src/node_modules ./node_modules
COPY --from=deps /src/apps/web/node_modules ./apps/web/node_modules
COPY . .

# Baked into the client bundle at build time, so it cannot come from the
# runtime environment — a NEXT_PUBLIC_* value read at `docker run` is too late.
ARG NEXT_PUBLIC_API_URL=http://localhost:8081
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ARG NEXT_PUBLIC_SENTRY_DSN=
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_APP_URL=${NEXT_PUBLIC_APP_URL} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_SENTRY_DSN=${NEXT_PUBLIC_SENTRY_DSN} \
    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/placeholder \
    NEXT_TELEMETRY_DISABLED=1

# DOCKER_BUILD=1 is what switches next.config.js to `output: 'standalone'`.
# Without it this stage produces a normal build and the COPY below finds nothing.
ENV DOCKER_BUILD=1
RUN pnpm --filter @hasnahena/web build

# --- Stage 3: runtime --------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app

# Same reason as the deps stage: this is where the query engine is actually
# dlopen'd at runtime, so libssl has to exist here, not only at build time.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# HOSTNAME: standalone binds 127.0.0.1 otherwise (unreachable from outside).
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# node:*-slim ships an unprivileged `node` user (uid 1000). Reused rather than
# creating another, so file ownership below is a single chown.
USER node

# Standalone emits its own minimal node_modules and preserves the workspace
# layout, so server.js lands at apps/web/server.js — not at the root.
COPY --from=build --chown=node:node /src/apps/web/.next/standalone ./
# Neither of these is traced into standalone; both must be copied by hand.
COPY --from=build --chown=node:node /src/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /src/apps/web/public ./apps/web/public

EXPOSE 3000

# node-based probe of the locale root, so a Go API outage does not fail it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/en').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["node", "apps/web/server.js"]
