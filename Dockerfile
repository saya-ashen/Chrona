# Stage 1: Build SPA
FROM oven/bun:1 AS spa-builder
WORKDIR /app

COPY bun.lock package.json ./
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --ignore-scripts

COPY apps/web apps/web
COPY apps/server apps/server
COPY packages packages
COPY prisma prisma
COPY tsconfig.json .
RUN bunx prisma generate
RUN bun run --cwd apps/web build

# Stage 2: Production runtime
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3101
ENV CHROMA_WEB_DIST=apps/web/dist
ENV DATABASE_URL="file:./prisma/chrona.db"

COPY --from=spa-builder /app/apps/web/dist apps/web/dist
COPY bun.lock package.json ./
COPY apps/server/package.json apps/server/
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY apps/server apps/server
COPY packages packages
COPY prisma/schema.prisma prisma/
COPY tsconfig.json .

RUN bunx prisma generate
RUN bunx prisma migrate deploy

EXPOSE 3101

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3101/health || exit 1

CMD ["bun", "run", "apps/server/src/index.bun.ts"]
