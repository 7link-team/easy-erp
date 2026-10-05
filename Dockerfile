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
