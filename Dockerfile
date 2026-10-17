ARG NODE_VERSION=24.14.0
ARG RUST_VERSION=1.99.0
ARG BASE_REGISTRY=docker.io/library

FROM ${BASE_REGISTRY}/node:${NODE_VERSION}-bookworm-slim AS web
WORKDIR /build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
RUN npm run build

FROM ${BASE_REGISTRY}/rust:${RUST_VERSION}-bookworm AS server
WORKDIR /build
ARG BUILD_JOBS=2
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY --from=web /build/dist ./dist
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/build/target \
    cargo test --locked --jobs ${BUILD_JOBS} && \
    cargo build --locked --release --jobs ${BUILD_JOBS} -p easy-erp-server && \
    install -D target/release/easy-erp-server /out/easy-erp-server

# Export build products without requiring local-only browser tests.
FROM scratch AS artifacts
COPY --from=server /out/easy-erp-server /linux/easy-erp-server
COPY --from=web /build/dist /web

FROM ${BASE_REGISTRY}/debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 inventory \
    && useradd --uid 10001 --gid inventory --no-create-home inventory \
    && mkdir /data && chown inventory:inventory /data
COPY --from=server /out/easy-erp-server /usr/local/bin/easy-erp-server
ENV ERP_DATA_DIR=/data ERP_BIND=0.0.0.0:4280 ERP_SERVER_MODE=true
USER 10001:10001
VOLUME ["/data"]
EXPOSE 4280
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl --fail --silent http://127.0.0.1:4280/api/status || exit 1
ENTRYPOINT ["/usr/local/bin/easy-erp-server"]
