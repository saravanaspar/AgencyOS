FROM docker.io/library/node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM docker.io/library/node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM docker.io/library/node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime
ARG AGENCYOS_REVISION=unknown
ARG AGENCYOS_SOURCE=https://github.com/REPLACE_ME/AgencyOS
LABEL org.opencontainers.image.title="AgencyOS" \
      org.opencontainers.image.revision="$AGENCYOS_REVISION" \
      org.opencontainers.image.source="$AGENCYOS_SOURCE"
WORKDIR /app
ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV AGENCYOS_REVISION=$AGENCYOS_REVISION
RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    libexpat1 \
    libnspr4 \
    libnss3 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts/workers ./scripts/workers
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
