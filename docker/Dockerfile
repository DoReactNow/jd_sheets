# JD Sheets images (Decision 34). Targets:
#   migrator  one-shot: prisma migrate deploy
#   app       the Next.js app (standalone output) with the built GridCraft editor in public/editor
#   worker    background jobs (node dist/worker.js)
#   collab    the Rust engine and collaboration service
# Runtime images contain no compilers and run as a non-root user (P0-DOCKER-02).
# Keep NODE_VERSION in step with .nvmrc and RUST_VERSION with services/collab/rust-toolchain.toml.
ARG NODE_VERSION=22
ARG RUST_VERSION=1.95.0

# --- Build tools that need a newer compiler than GridCraft's minimum --------------------------
FROM rust:1.99.1-bookworm AS tools
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true
RUN cargo install trunk --locked --version 0.22.1 \
 && cargo install wasm-bindgen-cli --locked --version 0.2.129

# --- Rust: the editor (WebAssembly) and the collab service -------------------------------------
FROM rust:${RUST_VERSION}-bookworm AS rust-build
# GridCraft has git dependencies (egui, craft-libs); the git CLI is more reliable than cargo's
# built-in client behind Docker networking.
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true
RUN rustup target add wasm32-unknown-unknown \
 && apt-get update \
 && apt-get install -y --no-install-recommends nodejs rsync binaryen \
 && rm -rf /var/lib/apt/lists/*
COPY --from=tools /usr/local/cargo/bin/trunk /usr/local/cargo/bin/wasm-bindgen /usr/local/cargo/bin/
WORKDIR /src
COPY vendor ./vendor
COPY patches ./patches
COPY scripts/editor-build.mjs ./scripts/editor-build.mjs
COPY scripts/lib ./scripts/lib
COPY services/collab ./services/collab
RUN node scripts/editor-build.mjs
RUN cd services/collab && cargo build --release --locked

# --- Node ----------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# The Prisma CLI's migration engine needs OpenSSL, which slim images do not include.
FROM base AS base-openssl
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

FROM base-openssl AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# The worker bundle needs none of the web framework.
RUN rm -rf node_modules/next node_modules/@next node_modules/@img node_modules/sharp \
    node_modules/react node_modules/react-dom

FROM deps AS builder
COPY . .
COPY --from=rust-build /src/public/editor ./public/editor
RUN npm run db:generate && npm run build && npm run build:worker

FROM base-openssl AS migrator
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.ts ./
COPY prisma ./prisma
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=47320
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Writable at runtime: the workbook storage volume and Next's cache.
RUN mkdir -p /data/workbooks /app/.next/cache && chown node:node /data/workbooks /app/.next/cache
USER node
EXPOSE 47320
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]

FROM base AS worker
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist/worker.js ./dist/worker.js
COPY --from=builder /app/src/generated ./src/generated
COPY package.json ./
RUN mkdir -p /data/workbooks && chown node:node /data/workbooks
USER node
CMD ["node", "dist/worker.js"]

FROM debian:bookworm-slim AS collab
RUN useradd --system --uid 10001 --no-create-home collab
COPY --from=rust-build /src/services/collab/target/release/jd-collab /usr/local/bin/jd-collab
USER collab
EXPOSE 47321
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD ["/usr/local/bin/jd-collab", "--healthcheck"]
CMD ["/usr/local/bin/jd-collab"]
