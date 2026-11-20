# Deployment artifact. Local development does not use Docker.
#   runtime: API (dist/main.js) and pg-boss worker (dist/worker.js).
#   ops:     one-shot migrations and operator tooling (needs the full workspace).
FROM node:24.22.1-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm build
RUN pnpm --filter @mehran/api deploy --prod --legacy /prod/api

# Private roots: planner files and the two independent control namespaces.
# Named volumes inherit this node-owned 0700 layout on first mount.
FROM build AS ops
ENV NODE_ENV=production
RUN mkdir -p /var/lib/mehran/files /var/lib/mehran/erasure-control /var/lib/mehran/shared-control /backup \
  && chown node:node /var/lib/mehran/files /var/lib/mehran/erasure-control /var/lib/mehran/shared-control /backup \
  && chmod 700 /var/lib/mehran/files /var/lib/mehran/erasure-control /var/lib/mehran/shared-control /backup
USER node
CMD ["node", "tooling/scripts/config-check.ts"]

FROM node:24.22.1-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /prod/api /app
RUN mkdir -p /var/lib/mehran/files /var/lib/mehran/erasure-control /var/lib/mehran/shared-control \
  && chown node:node /var/lib/mehran/files /var/lib/mehran/erasure-control /var/lib/mehran/shared-control \
  && chmod 700 /var/lib/mehran/files /var/lib/mehran/erasure-control /var/lib/mehran/shared-control
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
