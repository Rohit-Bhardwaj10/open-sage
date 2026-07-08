# ── Workers Dockerfile ──────────────────────────────────────────────
# Runs from the monorepo root (context: .)
# Handles: clone-worker, index-worker, embedding-worker

FROM node:22-alpine AS base
WORKDIR /app

# Install git (clone-worker needs it) + system deps
RUN apk add --no-cache git python3 make g++

# ── Install dependencies ─────────────────────────────────────────────
FROM base AS deps
# Copy root workspace manifests
COPY package.json package-lock.json ./
# Copy workspace manifests that workers need
COPY workers/package.json ./workers/
COPY frontend/package.json ./frontend/
# Minimal install — only what workers need
RUN npm ci --workspace=workers --include-workspace-root

# ── Runtime ──────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/workers/node_modules ./workers/node_modules

# Copy worker source and shared lib
COPY workers/ ./workers/
COPY frontend/lib/ ./frontend/lib/
COPY frontend/app/generated/ ./frontend/app/generated/
COPY prisma/ ./prisma/
COPY tsconfig.json ./

# Clones mount point
VOLUME ["/app/.clones"]

# Default command — overridden per-service in docker-compose
CMD ["tsx", "workers/clone-worker.ts"]
