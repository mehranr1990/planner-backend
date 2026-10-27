# Future deployment artifact. Local development does not use Docker.
FROM node:24.22.1-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm db:generate && pnpm build
RUN pnpm --filter @mehran/api deploy --prod --legacy /prod/api

FROM node:24.22.1-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /prod/api /app
RUN mkdir -p /var/lib/mehran/files && chown node:node /var/lib/mehran/files && chmod 700 /var/lib/mehran/files
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
