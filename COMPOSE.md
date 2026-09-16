# Stage 2 — The API and its database, orchestrated

Stage 1 produced one container that needed you to supply a database. Stage 2
runs the database as a container too, on a network where the two find each
other by name, with migrations applied automatically and data that survives a
teardown.

Files: `compose.yaml`, `.env.example`. Stage 1's notes are in
[`backend/DOCKER.md`](backend/DOCKER.md).

## Run it

```sh
cp .env.example .env          # then edit POSTGRES_PASSWORD and JWT_SECRET
docker compose up --build
```

First boot takes a minute: it builds the backend image, initializes the
Postgres data directory, waits for the database to genuinely accept
connections, applies seven migrations, then starts the API.

```sh
curl localhost:3001/api/health
# {"status":"ok","timestamp":"..."}
```

Useful commands:

```sh
docker compose ps                    # STATUS column shows the healthchecks
docker compose logs -f api           # follow one service
docker compose exec postgres psql -U edgeledger -d edgeledger
docker compose down                  # stop; data survives
docker compose down -v               # stop and DELETE the volume
docker compose --profile tools up -d # add Adminer at localhost:8080
```

The frontend still runs on your machine (`cd frontend && npm run dev`). It
defaults to `http://localhost:3001/api`, which is exactly what the stack
publishes, so it works with no changes.

## What each piece teaches

**Service-name DNS.** The API's `DATABASE_URL` points at host `postgres` — the
service name. Compose puts every service on a shared network where names
resolve to container IPs. This is why Stage 1's `host.docker.internal`
workaround disappears, and it's the same mechanism as a Kubernetes `Service`
later.

**A named volume.** `postgres-data:/var/lib/postgresql/data` is the line
standing between you and losing every trade on the next `docker compose down`.
Containers are disposable; volumes are not. Worth proving to yourself — see
exercise 2.

**A healthcheck that means something.** `pg_isready`, not "is the process
running". Postgres accepts connections a few seconds after boot, and that gap
is the race that makes cold starts flaky. `condition: service_healthy` makes
dependents wait for the real thing.

**Migrations as a one-shot job.** `migrate` runs `prisma migrate deploy`, exits
0, and stays exited. It's a separate service rather than part of the API's
startup for one reason: migrations must run exactly once regardless of how many
API replicas exist. Put them in the API's boot path and `--scale api=3` races
three processes against the same schema. This is also why Kubernetes will run
it as a `Job` rather than in an init container on every pod.

**`service_completed_successfully`.** The API waits for migrate to exit *zero*.
A failed migration stops the deploy instead of serving requests against a
half-applied schema.

**A YAML anchor.** `x-db-env: &db-env` is defined once and merged into both
`migrate` and `api` with `<<: *db-env`. Two copies of a connection string is one
copy that eventually goes stale.

**Required vs. optional variables.** `${JWT_SECRET:?message}` fails the whole
command with your message; `${GOOGLE_CLIENT_ID:-}` quietly defaults to empty.
The rule of thumb: if the app can't start without it, use `:?` and fail at
`compose up` rather than in a crash-looping container.

**Loopback port bindings.** `127.0.0.1:5432:5432` reaches your machine only,
not your network. Nothing in the stack needs Postgres published at all — it's
there for you to inspect.

**Profiles.** Adminer is under `profiles: ["tools"]`, so it's defined but
excluded from a plain `up`. That's how you add development conveniences without
making them part of the stack everyone runs.

**No healthcheck on `api`.** The image carries its own `HEALTHCHECK` from the
Dockerfile and Compose honours it. Defining it twice is drift waiting to happen.

## Why there's no Redis

The roadmap sketched Postgres *and* Redis. EdgeLedger has no cache layer and no
session store — its JWTs are stateless — so a Redis container here would sit
idle, teaching nothing beyond "here is another service block." Everything Stage
2 is meant to teach (service DNS, volumes, healthchecks, dependency ordering)
is already covered by Postgres against real code.

If you want the multi-service reps anyway, start Adminer with
`--profile tools`: it's a second container that reaches Postgres over the same
service-name DNS, and it's actually useful for eyeballing your trade rows.

## Exercises

1. **Watch the ordering work.** `docker compose up` and read the interleaved
   logs: postgres boots, `migrate` waits, applies migrations, exits, and only
   then does `api` start. Then run `docker compose up` a second time — the
   migrations report "No pending migrations" and it's near-instant.

2. **Prove the volume matters.** Sign up a user, then:
   ```sh
   docker compose down && docker compose up -d
   docker compose exec postgres psql -U edgeledger -d edgeledger -c 'SELECT email FROM "User";'
   ```
   Your user is still there. Now `docker compose down -v`, start again, and
   look: gone. That `-v` is the difference.

3. **Break the database on purpose.** `docker compose stop postgres`, then hit
   `/api/health` (still fine — it doesn't touch the DB) and then `/api/trades`
   with a token (fails). A liveness check that doesn't test the dependency is a
   deliberate choice, and Stage 4 revisits it.

4. **Make a migration fail.** Add a deliberately broken `.sql` to a new folder
   in `backend/prisma/migrations/`, then `docker compose up`. The API never
   starts. That's `service_completed_successfully` doing its job.

5. **Scale the API.** `docker compose up -d --scale api=3` — but first remove
   the `ports` mapping from `api`, since three containers can't share host port
   3001. That collision is precisely the problem a Kubernetes `Service` solves,
   and it's the natural bridge into Stage 3.

6. **Find the DNS.** `docker compose exec api getent hosts postgres` prints the
   container IP the name resolves to. Restart the stack and check again — the IP
   usually changes, the name never does.

## Verification status

Confirmed here:

- `docker compose config` resolves the whole file — valid schema, correct
  interpolation
- `DATABASE_URL` resolves to `postgresql://edgeledger:***@postgres:5432/edgeledger`
- dependency graph is `api → {postgres: healthy, migrate: completed_successfully}`,
  `migrate → {postgres: healthy}`
- a missing `POSTGRES_PASSWORD` or `JWT_SECRET` aborts the command with the
  intended message
- `docker compose config --services` lists three by default, four with
  `--profile tools`
- `pg_isready -U edgeledger -d edgeledger` exits 0 against a live Postgres 16
  and non-zero against a dead one
- against a real Postgres 16: `prisma migrate deploy` applies all seven
  migrations, and the API then serves `/api/health`, accepts a signup, returns
  `[]` for an authenticated `GET /api/trades`, and rejects an unauthenticated one

Not confirmed: `docker compose up` end to end. The environment these files were
authored in blocks Docker Hub's blob CDN, so neither the `node` nor the
`postgres` base image could be pulled. Every step the stack performs is verified
above against real software; the orchestration that ties them together is
verified structurally.

## Next: Stage 3

Install `kind`, and translate this file by hand into a `Deployment` plus a
`Service` for the API, the same for Postgres, a `ConfigMap` for the non-secret
settings, a `Secret` for `JWT_SECRET` and the database password, and a `Job` for
the migrations.
