FROM node:24-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable \
    && corepack prepare pnpm@11.7.0 --activate

# Layer caching: copy workspace manifest and package definitions first
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY packages/config/package.json ./packages/config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/notification-core/package.json ./packages/notification-core/
COPY packages/test-utils/package.json ./packages/test-utils/

# Cache unduhan paket pnpm di luar layer image: instalasi ulang (mis. lockfile berubah) tidak mengunduh semuanya lagi,
# dan store tidak ikut membesarkan image.
RUN --mount=type=cache,id=dailydose-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# Generate Prisma Client before copying all source code to leverage caching
COPY apps/api/prisma ./apps/api/prisma
RUN pnpm --filter @dailydose/api exec prisma generate --schema prisma/schema.prisma

ARG NEXT_PUBLIC_GOOGLE_CLIENT_ID=""
ARG API_BASE_URL="http://127.0.0.1:32121"
ARG TURBO_CONCURRENCY=1
ENV NEXT_PUBLIC_GOOGLE_CLIENT_ID=$NEXT_PUBLIC_GOOGLE_CLIENT_ID
ENV NEXT_PUBLIC_AUTH_SYNTHETIC_ENABLED=false
ENV API_BASE_URL=$API_BASE_URL
ENV NODE_OPTIONS="--max-old-space-size=2048"
ENV NEXT_TELEMETRY_DISABLED=1

# Copy remaining project source code
COPY . .

# Concurrency build dapat diatur via build-arg (default 1 untuk menekan RAM di server bersama, atau 2+ di CI).
# Cache turbo dan .next/cache disimpan pada BuildKit cache mount agar build berikutnya incremental tanpa memperbesar image.
RUN --mount=type=cache,id=dailydose-turbo-cache-v2,target=/app/.turbo \
    --mount=type=cache,id=dailydose-next-cache-v2,target=/app/apps/web/.next/cache \
    pnpm exec turbo run build --concurrency=${TURBO_CONCURRENCY:-1} \
    && install -d apps/web/.next/standalone/apps/web/.next/static \
    && install -d apps/web/.next/standalone/apps/web/public \
    && cp -a apps/web/.next/static/. apps/web/.next/standalone/apps/web/.next/static/ \
    && cp -a apps/web/public/. apps/web/.next/standalone/apps/web/public/ \
    && rm -rf /root/.local/share/pnpm/store /pnpm/store \
    && chmod +x docker-entrypoint.sh

# Buang paket yang tidak terjangkau dari API (alat uji, paket khusus web) sebelum disalin ke image runtime.
RUN node scripts/docker-prune-node-modules.cjs /app

FROM node:24-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates wget \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 dailydose \
    && useradd --system --uid 1001 --gid dailydose dailydose

# Hanya yang dibutuhkan saat berjalan: API (dist, prisma, dependensi), paket workspace, dan server Next.js standalone
# (sudah membawa node_modules sendiri). Kode sumber web, cache, dan artefak build ganda tidak ikut.
COPY --from=builder --chown=dailydose:dailydose /app/package.json /app/package.json
COPY --from=builder --chown=dailydose:dailydose /app/node_modules /app/node_modules
COPY --from=builder --chown=dailydose:dailydose /app/packages /app/packages
COPY --from=builder --chown=dailydose:dailydose /app/apps/api /app/apps/api
COPY --from=builder --chown=dailydose:dailydose /app/apps/web/package.json /app/apps/web/package.json
COPY --from=builder --chown=dailydose:dailydose /app/apps/web/.next/standalone /app/apps/web/.next/standalone
COPY --from=builder --chown=dailydose:dailydose /app/docker-entrypoint.sh /app/docker-entrypoint.sh

RUN mkdir -p /app/.local-data/public-uploads /app/data/private /app/data/public-uploads \
    && chown -R dailydose:dailydose /app/.local-data /app/data

USER dailydose

EXPOSE 32120

CMD ["/app/docker-entrypoint.sh"]
