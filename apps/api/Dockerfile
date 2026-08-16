# =============================================================================
#  Hasnahena Go API  —  WO-20 (PKG-01)
# =============================================================================
#  Build from the REPOSITORY ROOT, not from apps/api:
#      docker build -f apps/api/Dockerfile -t hasnahena-api .
#  The root is the build context so that .dockerignore at the root applies.
#
#  Base images are pinned by digest, not by tag. `golang:1.25-bookworm` is a
#  moving target that can change under you between a green CI run and a deploy;
#  a digest cannot. Refresh them deliberately — see docs/deployment.md.
# =============================================================================

# --- Stage 1: build ----------------------------------------------------------
FROM golang:1.25-bookworm@sha256:e401dae1bf814e29204a8cb7915682e1780951e609ca0dd8865ee1937f510c48 AS build

WORKDIR /src

# Dependencies are copied and downloaded on their own so that this layer is
# cached across every source-only change. go.sum makes the download verified.
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api/ ./

# CGO_ENABLED=0 is what makes the binary runnable on a base image with no libc
# at all. -trimpath keeps build-machine paths out of panics and stack traces.
# -s -w drop the symbol table and DWARF data, which is most of the size saving.
RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath \
      -ldflags="-s -w" \
      -o /out/server ./cmd/server

# --- Stage 2: runtime --------------------------------------------------------
# distroless/static: no shell, no package manager, no busybox — nothing for a
# process that escapes the application to call. It carries CA certificates
# (needed for Neon TLS and the Brevo API) and /etc/passwd, and nothing else.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:1b7b9f0f0e0a1d2155f531db587cc48ec26aaf97ab64364225f5bf18a054e66a

# The :nonroot tag already runs as uid 65532. Stated explicitly so that a base
# image change cannot silently promote this container to root.
USER nonroot:nonroot

COPY --from=build /out/server /server

EXPOSE 8081

# Probes /v1/ready, which pings Postgres — so "healthy" means the API can
# actually serve, not merely that the process is alive. start-period covers
# the pool warm-up; without it the first two checks fail on a cold start.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/server", "-healthcheck"]

ENTRYPOINT ["/server"]
