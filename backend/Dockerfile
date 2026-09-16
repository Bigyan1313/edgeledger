# Pinned to an exact Node version so a build today and a build in six months
# produce the same runtime. `bookworm-slim` is Debian without the extras.
ARG NODE_VERSION=22.22.2

# ---------------------------------------------------------------------------
# Stage 1: build — installs dependencies and generates the Prisma client.
# Nothing from this stage ships except what Stage 2 explicitly copies.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build

# Prisma's query engine is a native binary linked against OpenSSL 3.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests are copied on their own, before the source. Docker caches each
# layer and invalidates everything after the first change, so keeping the slow
# `npm ci` above the fast-changing source means editing a route doesn't
# reinstall node_modules.
COPY package.json package-lock.json ./

# `npm ci` installs exactly what the lockfile pins — no version drift, unlike
# `npm install`. `--omit=dev` drops typescript/tsx/@types, which the running
# server never touches. The prisma CLI is a regular dependency, so it survives
# and can generate the client in the next step.
RUN npm ci --omit=dev

# The generated Prisma client lands inside node_modules, which is why this has
# to happen here in the build stage and be carried across whole.
COPY prisma ./prisma
RUN npx prisma generate

# ---------------------------------------------------------------------------
# Stage 2: runtime — the image that actually ships.
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

# NODE_ENV=production makes Express skip dev-only work (verbose error pages,
# view caching disabled) and is read by parts of the npm ecosystem too.
ENV NODE_ENV=production \
    PORT=3001

WORKDIR /app

# node_modules arrives prebuilt from the build stage. npm's cache, the apt
# lists from that stage, and the dev dependencies never enter this image.
COPY --from=build --chown=node:node /app/node_modules ./node_modules

# `prisma/` carries the schema and migrations — not needed to serve requests,
# but Stage 2 of the exercise runs `prisma migrate deploy` from this image.
COPY --chown=node:node package.json ./
COPY --chown=node:node prisma ./prisma
COPY --chown=node:node src ./src

# The official node images ship an unprivileged `node` user (uid 1000). A
# process that never needs root should never run as root: if the app is
# compromised, the attacker lands as a nobody instead of as root.
USER node

# Documentation only — it publishes nothing by itself. `-p` at run time is
# what actually opens a port.
EXPOSE 3001

# Docker marks the container healthy/unhealthy from this. Node 22 has a global
# fetch(), so this needs no curl in the image.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Exec form (a JSON array), not shell form. node becomes PID 1 and receives
# SIGTERM directly, so `docker stop` shuts down cleanly instead of being
# SIGKILLed after the 10-second grace period.
CMD ["node", "src/index.js"]
