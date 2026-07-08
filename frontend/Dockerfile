# ── Frontend Dockerfile ──────────────────────────────────────────────
# Runs from the monorepo root (context: .)
# Next.js app with standalone output

FROM node:22-alpine AS base
WORKDIR /app

# ── Install dependencies ─────────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY workers/package.json ./workers/
RUN npm ci --workspace=frontend --include-workspace-root

# ── Build ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules

COPY frontend/ ./frontend/
COPY prisma/ ./prisma/
COPY package.json ./

# Generate Prisma client then build Next.js
RUN cd frontend && npx prisma generate --schema=../prisma/schema.prisma
RUN cd frontend && npm run build

# ── Runtime (standalone) ─────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Standalone output
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/frontend/public ./frontend/public

USER nextjs
EXPOSE 3000

CMD ["node", "frontend/server.js"]
