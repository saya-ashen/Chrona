FROM oven/bun:1.4.2-slim AS runner
WORKDIR /app

ENV HOST=0.0.0.0
ENV PORT=3101
ENV DATABASE_URL="file:/data/chrona.db"
ENV CHRONA_DATA_DIR=/data

# Workspace manifests must exist before install; module checks need TypeScript at runtime.
COPY bun.lock package.json prisma.config.ts tsconfig.json ./
COPY apps/server apps/server
COPY packages packages
COPY prisma prisma
COPY external-plugins/pi-steward-agent external-plugins/pi-steward-agent
COPY scripts/docker-entrypoint.sh scripts/docker-entrypoint.sh
RUN bun install --frozen-lockfile --ignore-scripts \
    && bun run db:generate
ENV NODE_ENV=production

RUN mkdir -p /data && chmod 700 /data && chown -R bun:bun /app /data
USER bun

EXPOSE 3101
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD bun -e "const response = await fetch('http://localhost:' + (process.env.PORT || '3101') + '/health'); process.exit(response.ok ? 0 : 1)"

ENTRYPOINT ["sh", "/app/scripts/docker-entrypoint.sh"]
CMD ["bun", "run", "apps/server/src/index.bun.ts"]
