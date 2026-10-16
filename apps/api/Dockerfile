# =============================================================================
#  Hasnahena Go API (WO-20). Build from the REPOSITORY ROOT:
#      docker build -f apps/api/Dockerfile -t hasnahena-api .
#  Base images are pinned by digest; refresh deliberately (docs/deployment.md).
# =============================================================================

# --- Stage 1: build ----------------------------------------------------------
FROM golang:1.25-bookworm@sha256:e401dae1bf814e29204a8cb7915682e1780951e609ca0dd8865ee1937f510c48 AS build

WORKDIR /src

# Dependencies are copied and downloaded on their own so that this layer is
# cached across every source-only change. go.sum makes the download verified.
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api/ ./

# CGO_ENABLED=0 for a libc-free base; -trimpath and -s -w for clean, small binaries.
RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath \
      -ldflags="-s -w" \
      -o /out/server ./cmd/server

# --- Stage 2: runtime --------------------------------------------------------
# distroless/static: no shell or package manager; CA certificates and /etc/passwd only.
FROM gcr.io/distroless/static-debian12:nonroot@sha256:1b7b9f0f0e0a1d2155f531db587cc48ec26aaf97ab64364225f5bf18a054e66a

# The :nonroot tag already runs as uid 65532. Stated explicitly so that a base
# image change cannot silently promote this container to root.
USER nonroot:nonroot

COPY --from=build /out/server /server

EXPOSE 8081

# /v1/ready pings Postgres, so healthy means able to serve; start-period covers warm-up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/server", "-healthcheck"]

ENTRYPOINT ["/server"]
