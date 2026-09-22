# syntax=docker/dockerfile:1

# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build

# better-sqlite3 falls back to compiling from source if no prebuilt binary
# matches; these are only needed here, never in the runtime image.
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci

COPY shared/ shared/
COPY backend/ backend/
COPY frontend/ frontend/

# shared must be built first: backend and frontend both compile against its .d.ts
RUN npm run build

# Production dependency tree for the runtime stage.
RUN npm prune --omit=dev

# ---- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/shared/package.json ./shared/package.json
COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/drizzle ./backend/drizzle
COPY --from=build /app/frontend/dist ./frontend/dist

# SQLite lives on a Coolify persistent volume mounted here.
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 3000
# The Postgres TLS gateway, when PG_GATEWAY_HOST is set. Publish it bound to
# localhost only — Traefik is the only thing that should reach it.
EXPOSE 5433

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/index.js"]
