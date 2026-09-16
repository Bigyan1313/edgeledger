# Stage 1 — Containerizing the backend

Learning notes for the Docker/Kubernetes staircase. This stage puts the
Express + Prisma API into a single container. No database container yet, no
orchestration — just one image, built well.

## Files

| File | What it does |
| --- | --- |
| `Dockerfile` | Two-stage build: install + `prisma generate`, then a lean runtime image |
| `.dockerignore` | Keeps `node_modules/`, `.git/`, and **`.env`** out of the build context |

## Build and run

```sh
cd backend
docker build -t edgeledger-backend:stage1 .
```

The server reads its configuration from the environment. Two variables are
mandatory — the process exits at startup without them:

```sh
docker run --rm -p 3001:3001 \
  -e JWT_SECRET="$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")" \
  -e DATABASE_URL="postgresql://user:pass@host.docker.internal:5432/edgeledger" \
  --name edgeledger-api \
  edgeledger-backend:stage1
```

Then, from another terminal:

```sh
curl localhost:3001/api/health
# {"status":"ok","timestamp":"..."}
```

Note `host.docker.internal` rather than `localhost` in `DATABASE_URL`. Inside
the container, `localhost` is the *container*, not your machine — the single
most common first-day Docker mistake. Stage 2 makes this go away by putting
Postgres in its own container on a shared network, where it is reachable as
`postgres`.

## The decisions in the Dockerfile, and why

**Multi-stage.** The `build` stage installs dependencies and generates the
Prisma client; the `runtime` stage starts from a fresh base and copies in only
`node_modules`, `src/`, and `prisma/`. Anything the build needed but the
running server does not — npm's cache, apt lists, intermediate layers — is left
behind in a stage that never ships.

**Manifests copied before source.** Each instruction is a cached layer, and a
change invalidates every layer after it. `COPY package*.json` sits above
`npm ci` so editing a route file doesn't reinstall 123 packages.

**`npm ci --omit=dev`, not `npm install`.** `ci` installs exactly the lockfile
tree — no silent version drift between your machine and the image. `--omit=dev`
drops typescript/tsx/@types. The `prisma` CLI is a regular dependency, not a
dev one, so it survives the prune and can still generate the client.

**`prisma generate` at build time.** The generated client is written into
`node_modules`, so it must be produced in the build stage and carried across
whole. The engine is a native binary linked against OpenSSL 3, which is why
both stages `apt-get install openssl`.

**`USER node`.** The official Node images ship an unprivileged `node` user
(uid 1000). Containers run as root by default; a process that never needs root
should never have it. If the app is compromised, the attacker lands as a nobody.

**Exec-form `CMD`.** `CMD ["node", "src/index.js"]` — a JSON array, not a
string. Node becomes PID 1 and receives `SIGTERM` directly, so `docker stop`
shuts down cleanly instead of hanging for the 10-second grace period and then
being `SIGKILL`ed.

**`HEALTHCHECK`.** Polls `/api/health` using Node 22's global `fetch()`, so no
`curl` needs to exist in the image. Run `docker ps` and watch the STATUS column
go `health: starting` → `healthy`. This becomes the Kubernetes readiness probe
in Stage 4, so it's worth getting familiar with now.

**No `# syntax=` directive.** Nothing here needs a newer BuildKit frontend than
the built-in one, and omitting it means the build never has to reach the
network for a frontend image.

## Exercises

1. **See the caching work.** Build, then edit a comment in `src/app.js` and
   build again. The second build should skip `npm ci` entirely and finish in
   seconds. Now edit `package.json` and build a third time — and watch the
   install run again.

2. **See what multi-stage bought you.** Build the build stage on its own and
   compare:
   ```sh
   docker build --target build -t edgeledger-backend:buildstage .
   docker images | grep edgeledger-backend
   ```

3. **Prove `.dockerignore` matters.** Comment out the `.env` line, put a fake
   secret in `backend/.env`, rebuild, then go looking for it:
   ```sh
   docker run --rm edgeledger-backend:stage1 ls -la /app
   ```
   (It won't be in `/app` — nothing `COPY`s it — but it *was* shipped to the
   daemon in the build context. Uncomment the line afterwards.)

4. **Break the healthcheck on purpose.** Change the `HEALTHCHECK` path to
   `/api/nope`, rebuild, run, and watch `docker ps` report `unhealthy` after
   three failed attempts.

5. **Watch the signal handling.** `docker stop edgeledger-api` should return
   almost immediately. Change `CMD` to shell form (`CMD node src/index.js`),
   rebuild, and time it again — roughly ten seconds, because `sh` is PID 1 and
   doesn't forward `SIGTERM`.

## Verification status

These were each confirmed to work on Node 22.22.2:

- `npm ci --omit=dev` — installs 123 packages, keeps the `prisma` CLI, drops typescript
- `npx prisma generate` — generates the client successfully
- `node src/index.js` — serves `{"status":"ok",...}` on `/api/health`
- the `HEALTHCHECK` script — exits 0 against a live server
- the `Dockerfile` — parses cleanly through BuildKit

The end-to-end `docker build` has **not** been run: the environment these files
were authored in blocks Docker Hub's blob CDN, so the `node` base image can't
be pulled there. Run the build locally; every step inside it is individually
verified above.

## Next: Stage 2

Add Postgres and Redis as their own containers via `docker compose`, drop the
`host.docker.internal` workaround in favour of service-name DNS, and move
`prisma migrate deploy` into the startup path.
