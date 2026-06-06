# EdgeLedger — Complete Project Guide

> The "explain anything about this project" document. Read this and you'll be able to answer *what* each piece is, *where* it lives, *why* we chose it, and *how* it all fits together.

**Table of contents**
1. [What EdgeLedger is](#1-what-edgeledger-is)
2. [The big picture — three-tier architecture](#2-the-big-picture--three-tier-architecture)
3. [Technology choices: what & why](#3-technology-choices-what--why)
4. [Key concepts, explained simply](#4-key-concepts-explained-simply)
5. [The codebase — where everything lives](#5-the-codebase--where-everything-lives)
6. [End-to-end walkthroughs](#6-end-to-end-walkthroughs)
7. [The data model](#7-the-data-model)
8. [Security](#8-security)
9. [Deployment](#9-deployment)
10. [Bugs we hit & what they taught us](#10-bugs-we-hit--what-they-taught-us)
11. [What's next](#11-whats-next)
12. [Glossary](#12-glossary)

---

## 1. What EdgeLedger is

EdgeLedger is a **personal trading journal and analytics web app**. A trader logs each trade (entry, stop, target, result, the setup they traded, their emotional state). The app then computes performance analytics — win rate, expectancy, profit factor, R-multiples, an equity curve, and a per-setup breakdown — and surfaces *behavioral* patterns like "how much does breaking my checklist cost me?"

It's a **full-stack web application**: a browser frontend, a server backend, and a database, with multi-user accounts and a live deployment.

- **Live:** https://edgeledger-tau.vercel.app
- **Backend API:** https://edgeledger-wo99.onrender.com

---

## 2. The big picture — three-tier architecture

Almost every web app is three layers. EdgeLedger is no different:

```
┌──────────────┐     HTTP/JSON      ┌──────────────┐      SQL       ┌──────────────┐
│  FRONTEND    │ ─────────────────▶ │   BACKEND    │ ─────────────▶ │   DATABASE   │
│  (browser)   │ ◀───────────────── │  (server)    │ ◀───────────── │  (Postgres)  │
│  React app   │                    │  Express API │                │              │
└──────────────┘                    └──────────────┘                └──────────────┘
   what the user                     the rules + logic                 the durable
   sees & clicks                     + security                          storage
```

**Why split into three layers?** Separation of concerns:
- The **frontend** only handles presentation and user interaction. It holds no secrets and trusts nothing.
- The **backend** is the single gatekeeper for all logic and security. *Every* rule (auth, validation, who-can-see-what) is enforced here, because the frontend can be tampered with by anyone.
- The **database** just stores data durably and answers queries.

**The golden rule this enforces:** never trust the client. The browser can be manipulated, so the backend re-checks everything.

### The request lifecycle (the heartbeat of the whole app)

Every single feature is a variation of this loop:

1. User does something in the browser (clicks "Log Trade").
2. Frontend sends an **HTTP request** to the backend (`POST /api/trades` with JSON).
3. Backend **middleware** runs first (CORS check, JSON parsing, auth check).
4. The matching **route handler** runs the logic and queries the database via Prisma.
5. Database returns rows; backend shapes them into JSON and sends an **HTTP response**.
6. Frontend receives the JSON and updates the screen.

If you understand this loop, you understand the app.

---

## 3. Technology choices: what & why

This is the section for "why did you use X?" For each, here's what it does, why we picked it, and what we *didn't* pick.

### Frontend

**React** — a UI library that lets you build the interface from reusable *components* (Dashboard, TradeForm, etc.) and automatically re-renders them when data ("state") changes.
- *Why:* industry standard, component model keeps a complex UI manageable, huge ecosystem.
- *Alternatives:* Vue, Svelte, plain HTML/JS. React was chosen for its ubiquity and resume value.

**Vite** — the build tool / dev server. It bundles the code for the browser and gives instant hot-reload during development.
- *Why:* extremely fast, zero-config, the modern default for React.
- *Alternative:* Create React App (now deprecated/slow), Webpack (heavier).

**Tailwind CSS** — utility-first styling: you style elements with classes like `flex`, `text-emerald-400` directly in the markup.
- *Why:* fast to build with, no context-switching to separate CSS files, consistent design.
- *Alternative:* plain CSS, CSS modules, styled-components.

### Backend

**Node.js** — lets us run JavaScript on the server (not just in the browser).
- *Why:* **one language across the whole stack** (JS frontend + JS backend). For a first full-stack project, not switching languages is a huge accelerator.
- *Alternative considered:* **Java + Spring Boot.** The builder already knew Java well, which was tempting — but Spring Boot hides a lot behind "magic" (dependency injection, auto-config) and adds heavy setup. Express keeps HTTP concepts visible, which is better for *learning* the fundamentals. Spring is a great second-backend project.

**Express** — a minimal web framework for Node. It routes incoming requests (`GET /api/trades` → this function) and runs middleware.
- *Why:* tiny and close to raw HTTP — nothing is hidden, which is ideal for learning.
- *Alternatives:* Fastify, NestJS (more structure/magic), Koa.

### Database & data access

**PostgreSQL** — a relational (SQL) database. Data lives in tables with typed columns and relationships (a User *has many* Trades).
- *Why:* relational structure fits the data (users, trades, accounts all relate), strongly typed, rock-solid, free, easy to host.
- *Alternatives:* MySQL (similar), MongoDB (document/NoSQL — rejected because our data is highly relational and benefits from joins and constraints).

**Prisma** — an **ORM** (Object-Relational Mapper). Instead of writing raw SQL, you write `prisma.trade.findMany({ where: { userId } })` and Prisma generates the SQL.
- *Why:* type-safe queries, readable code, and — critically — **migrations** (versioned schema changes). It also generates a typed client from your schema.
- *Alternatives:* raw SQL (more control, more boilerplate, error-prone), Knex (query builder), TypeORM/Sequelize.

### Authentication

**bcryptjs** — hashes passwords with a deliberately slow, salted algorithm before storing them.
- *Why:* you must never store plaintext passwords. bcrypt is slow *by design* (defeats brute-force) and salts automatically (defeats rainbow tables). We used the pure-JS `bcryptjs` over native `bcrypt` to avoid C++ build issues.

**jsonwebtoken (JWT)** — issues a signed token after login so the user stays authenticated across requests without re-sending their password.
- *Why:* stateless sessions — the server doesn't have to store session data; it just verifies the token's signature.
- *Alternative:* server-side sessions (require shared session storage when you scale to multiple servers).

**Google Identity Services (GIS)** — the "Sign in with Google" button.
- *Why:* lets users log in with Google. We chose the GIS button approach (frontend gets an ID token, backend verifies it) over the full OAuth redirect flow because it's less boilerplate and only needs a public Client ID (no client secret).
- *Alternatives:* full hand-rolled OAuth redirect flow, or a library like Passport/Auth.js (more magic).

### Hosting (all free tier, all deploy from GitHub)

| Service | Hosts | Why |
|---|---|---|
| **Vercel** | Frontend | Best-in-class for React/Vite, trivial git-based deploys, free |
| **Render** | Backend | Simple Node hosting, free tier, auto-deploys on push |
| **Neon** | PostgreSQL | Serverless Postgres, generous free tier, doesn't lose data |

---

## 4. Key concepts, explained simply

These are the ideas you'll be asked to explain. Here's how to explain each.

**HTTP & REST** — HTTP is the protocol browsers and servers speak. REST is a convention for designing APIs around *resources* using HTTP *verbs*:
- `GET /api/trades` → read all trades
- `POST /api/trades` → create one
- `PUT /api/trades/:id` → update one
- `DELETE /api/trades/:id` → delete one

The verb says the action; the path says the resource. Every API you'll use (GitHub, Stripe) follows this shape.

**JSON** — the text format for data exchanged between frontend and backend. `{ "pair": "XAUUSD", "pnl": 165 }`. Both JS and every language can read it.

**CORS (Cross-Origin Resource Sharing)** — a browser security rule: JavaScript on `siteA.com` can't call `siteB.com` unless siteB explicitly allows it. Our backend sends an `Access-Control-Allow-Origin` header naming the allowed frontend. Without it, the browser blocks the response even though the server replied. (This bit us in production — see §10.)

**ORM & migrations** — an ORM maps database rows to code objects. A *migration* is a versioned SQL script that evolves the schema (add a table/column). Migrations are *version control for your database* — every change is a numbered file, applied in order, so any fresh database can be brought to the current shape.

**Hashing vs. encryption** — encryption is reversible (you can decrypt). Hashing is **one-way** — you can't get the password back from the hash. We store the hash; at login we hash the attempt and compare. A leak exposes hashes, not passwords.

**JWT (JSON Web Token)** — a signed string with three parts: `header.payload.signature`. The payload carries `{ userId, exp }` (readable by anyone — it's only encoded, not encrypted). The **signature** is computed from the payload + a secret only the server knows. If anyone tampers with the payload, the signature no longer matches. So the server can trust the token without storing anything.

**OAuth (Google sign-in)** — instead of us verifying a password, Google verifies the user and hands us a signed **ID token** proving their identity. Our backend verifies that token, finds-or-creates the user, then issues *our own* JWT. After that, Google sign-in users are identical to password users.

**Environment variables** — configuration and secrets (DB URL, JWT secret, API keys) that live *outside* the code, injected at runtime. Kept out of git (via `.gitignore`) so secrets never leak. Local dev reads them from a `.env` file; production reads them from the host's dashboard.

---

## 5. The codebase — where everything lives

The repo is a **monorepo**: two separate apps (`backend/` and `frontend/`) side by side.

```
edgeledger/
├── README.md                 # project overview (GitHub homepage)
├── PROJECT_GUIDE.md          # this document
├── DEPLOY.md                 # step-by-step deploy guide
├── .gitignore                # what git ignores (node_modules, .env, etc.)
│
├── backend/                  # ───────── THE SERVER ─────────
│   ├── package.json          # dependencies + npm scripts (dev/start/build)
│   ├── .env                  # secrets (NOT in git): DATABASE_URL, JWT_SECRET, …
│   ├── .env.example          # template documenting required vars (in git)
│   ├── prisma/
│   │   ├── schema.prisma      # the data model (User, Trade) — source of truth
│   │   └── migrations/        # versioned SQL scripts, applied in order
│   │       ├── 20260603061400_init/            # creates Trade table
│   │       ├── 20260603221149_add_users/       # creates User + userId FK
│   │       └── 20260603221150_add_google_auth/ # passwordHash nullable + googleId
│   └── src/
│       ├── index.js           # Express app entry: middleware + route mounting
│       ├── prisma/client.js   # single shared Prisma client instance
│       ├── auth/
│       │   ├── jwt.js          # signToken() / verifyToken()
│       │   └── middleware.js   # requireAuth: verifies token, sets req.userId
│       └── routes/
│           ├── health.js       # GET /api/health (is the server up?)
│           ├── auth.js         # POST /signup, /login, /google
│           └── trades.js       # CRUD for trades, all scoped to req.userId
│
└── frontend/                 # ───────── THE BROWSER APP ─────────
    ├── package.json          # dependencies + scripts
    ├── vite.config.js        # Vite + Tailwind plugin config
    ├── index.html            # the single HTML page React mounts into
    ├── .env                  # VITE_GOOGLE_CLIENT_ID, VITE_API_URL (NOT in git)
    └── src/
        ├── main.jsx           # entry: mounts <App> inside <AuthProvider>
        ├── App.jsx            # top-level: tab routing, loads trades, gates on auth
        ├── index.css          # Tailwind import + base styles
        ├── api/
        │   ├── client.js       # fetch wrapper: attaches JWT, handles 401/errors
        │   ├── auth.js         # signup/login/google API calls
        │   └── trades.js       # trade CRUD API calls
        ├── auth/
        │   └── AuthContext.jsx # global auth state (user, login, logout)
        ├── utils/
        │   └── csv.js          # CSV export logic
        └── components/
            ├── Nav.jsx          # top navigation + user/logout
            ├── AuthScreen.jsx   # login/signup form + Google button
            ├── GoogleButton.jsx # renders Google Identity Services button
            ├── TradeForm.jsx    # log/edit a trade
            ├── TradeTable.jsx   # trade history table
            ├── Dashboard.jsx    # analytics: stats, equity curve, discipline mirror
            └── Calculators.jsx  # position-size + R:R calculators
```

**How to reason about it:** backend files answer "what can the server do and who's allowed?"; frontend files answer "what does the user see and how do they interact?". The `api/` folder on the frontend is the bridge — it's the only place the frontend knows the backend's URL.

---

## 6. End-to-end walkthroughs

Tracing real operations is the best way to *prove* you understand the system.

### A) Logging a trade (the core CRUD flow)

1. User fills `TradeForm.jsx` and clicks "Log Trade".
2. The form builds a payload and calls `tradesApi.create(payload)` (`frontend/src/api/trades.js`).
3. That calls `request('/trades', { method: 'POST', body })` in `api/client.js`, which:
   - Prepends the API base URL (`VITE_API_URL` in prod, localhost in dev),
   - Attaches the JWT: `Authorization: Bearer <token>`,
   - Sends the HTTP request.
4. On the backend, `index.js` runs middleware: CORS → JSON parse → **`requireAuth`** (verifies the token, sets `req.userId`).
5. The `POST /` handler in `routes/trades.js` runs `prisma.trade.create({ data: { ...body, userId: req.userId } })` — note the userId is taken from the *token*, not the request body (so you can't create trades for someone else).
6. Prisma generates an `INSERT`, Postgres stores the row, returns it.
7. Backend responds `201 Created` + the new trade as JSON.
8. Frontend adds it to React state; the table and dashboard re-render instantly.

### B) Signing up / logging in

**Signup:** `POST /api/auth/signup` → validate email/password → `bcrypt.hash(password, 12)` → store `{ email, passwordHash }` → `jwt.sign({ userId })` → return token + user. The frontend stores the token in `localStorage` and the user is logged in.

**Login:** `POST /api/auth/login` → look up user by email → `bcrypt.compare(typedPassword, storedHash)` → if it matches, issue a JWT. The error message is deliberately generic ("Invalid email or password") so it never reveals whether an email exists.

**Staying logged in:** every later request carries the JWT. `requireAuth` verifies it and extracts `userId`. On refresh, the frontend reads the token back from `localStorage`, so you stay logged in.

### C) Google sign-in

1. User clicks the Google button (`GoogleButton.jsx`, rendered by Google's script).
2. Google authenticates them and returns a signed **ID token** (a JWT Google made).
3. Frontend POSTs it to `POST /api/auth/google` as `credential`.
4. Backend verifies it with `google-auth-library` (`verifyIdToken`, checking signature + that the audience is *our* Client ID).
5. **Find-or-create with linking:** look up by `googleId` → if none, look up by email → if that exists (a password account), *link* the googleId to it; otherwise create a new Google-only user (no password).
6. Backend issues *our* JWT. From here it's identical to any other login.

### D) How the dashboard computes analytics

The dashboard (`Dashboard.jsx`) holds the array of trades in state and **derives** all metrics on the fly — nothing is precomputed or stored. Win rate, expectancy, profit factor, average R, the equity curve, the per-setup table, and the discipline mirror are all calculated from the raw trades each render. *Why derive instead of store?* Storing computed stats means keeping them in sync on every edit — a classic bug source. Store the facts (trades); compute the views.

---

## 7. The data model

Defined in `backend/prisma/schema.prisma`. Two tables:

**User**
| Field | Type | Notes |
|---|---|---|
| id | Int (PK) | auto-increment |
| email | String, unique | login identity |
| passwordHash | String? | **nullable** — Google-only users have no password |
| googleId | String?, unique | Google's stable user id (the `sub` claim) |
| displayName | String? | |
| createdAt | DateTime | |

**Trade**
| Field | Type | Notes |
|---|---|---|
| id | Int (PK) | |
| userId | Int (FK → User) | **owner**; `onDelete: Cascade` |
| date, pair, direction, setup | | core trade info |
| entryPrice, stopLoss, takeProfit, exitPrice, lotSize, riskDollars | Float? | optional; used for precise R |
| pnl | Float | the one required number for stats |
| outcome | String | Win / Loss / Break-even |
| emotionBefore, followedChecklist, fullPort, notes | | behavioral metadata |
| createdAt | DateTime | |

**The relationship:** one User has many Trades; each Trade belongs to one User via `userId`. This single foreign key is what makes the app multi-user — every trade query filters by it.

---

## 8. Security

What we did, and why:

- **Passwords are hashed** (bcrypt, cost 12) and salted — never stored in plaintext. A database leak exposes uncrackable hashes.
- **JWTs are signed** with a secret only the server holds. Tokens can't be forged or tampered with.
- **Per-user data isolation** — every trade query is scoped by `req.userId` (taken from the verified token). Users physically cannot query each other's data.
- **IDOR prevention** — update/delete use `updateMany`/`deleteMany` with `userId` in the `WHERE` clause, so you can't edit another user's trade by guessing its id.
- **Secrets in environment variables**, never in git (`.env` is gitignored; only `.env.example` templates are committed).
- **Generic auth errors** — login never reveals whether an email exists.

**Deliberately deferred** (documented, not forgotten):
- **Token in `localStorage`** — readable by JavaScript, so vulnerable to XSS. Chosen for learning visibility; the hardening step is `httpOnly` cookies.
- **No rate limiting yet** — the public login endpoint could be brute-forced (bcrypt's slowness mitigates this). Basic rate limiting is a planned fast-follow.

---

## 9. Deployment

Three services, each deploying from the GitHub repo:

```
GitHub repo ──┬──▶ Vercel  (builds frontend/, serves static React)   → edgeledger-tau.vercel.app
              ├──▶ Render  (runs backend/, the Express API)          → edgeledger-wo99.onrender.com
              └──   (Render connects to) ──▶ Neon (managed Postgres)
```

**What changes from local to production:**
- The backend port comes from `process.env.PORT` (Render assigns it, e.g. 10000), not hardcoded 3001.
- CORS allows the real Vercel origin via `FRONTEND_ORIGIN`, not localhost.
- The frontend's API URL comes from `VITE_API_URL` (the Render URL), baked in at build time.
- Secrets live in each host's dashboard, not a `.env` file.
- On deploy, Render runs `npm run build` → `prisma migrate deploy`, applying all migrations to Neon.

Full step-by-step: [`DEPLOY.md`](DEPLOY.md).

---

## 10. Bugs we hit & what they taught us

These are real, and they're excellent interview answers to "tell me about a hard bug."

**1. Migration ordering (`relation "User" does not exist`).** A hand-written migration got a timestamp that sorted it *before* the migration that created the `User` table it depended on. Prisma applies migrations in filename order, so on a fresh database it tried to alter a table that didn't exist yet. Local never caught it because migrations were applied one-at-a-time as written. *Lesson:* migration order is a contract; only a fresh-database apply (i.e., deploying) reveals ordering bugs.

**2. Env var changes don't auto-reload.** Editing `.env` didn't take effect because `node --watch` only watches imported `.js` files, not `.env`. *Lesson:* environment variables are read once at process start; you must restart after changing them.

**3. "Secret Files" vs "Environment Variables" on Render.** Pasting `JWT_SECRET` into Render's *Secret Files* section wrote it to a file on disk instead of setting `process.env.JWT_SECRET`, so the app crashed. Our own startup guard (`if (!SECRET) throw`) caught it loudly. *Lesson:* know the difference between an env var and a mounted file; and defensive startup checks pay off.

**4. Contaminated env var (`invalid_client`).** The Google Client ID pasted into Vercel had a trailing newline + extra text, so the frontend sent a malformed client id. We caught it by inspecting the deployed JS bundle. *Lesson:* `.env` files strip quotes/whitespace; dashboard fields take the value *literally* — paste clean values.

**5. CORS & origin mismatch.** Production login/Google failed until the backend's `FRONTEND_ORIGIN` and Google's *Authorized JavaScript origins* both listed the exact Vercel URL (no trailing slash, `https`). *Lesson:* browser security (CORS, OAuth origins) does exact-string matching; the production origin differs from localhost.

---

## 11. What's next

Planned features and why they matter:

- **Per-user daily guardrails** — let each user set rules (max trades/day, daily loss limit) and warn when breached. Targets the "worst days are the 2nd/3rd trade after a loss" pattern. *Depends on auth, which is why it came after.*
- **Chart screenshot uploads** — attach a chart image to each trade (needs file storage like S3/Cloudflare R2).
- **Broker CSV import** — auto-import trade history from cTrader/MT5 instead of manual entry.
- **Calendar / daily P&L view** — see results by day.
- **Tagging & filtering** — slice analytics by tag, date range, setup.
- **Security hardening** — move the token to `httpOnly` cookies, add login rate limiting.
- **Custom domain** — currently on free Vercel/Render subdomains.

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Frontend** | The browser app the user sees (React) |
| **Backend** | The server that holds logic + security (Express) |
| **API** | The set of URLs the frontend calls to talk to the backend |
| **REST** | Convention for API design using HTTP verbs on resources |
| **HTTP request/response** | The message a client sends / the server replies with |
| **JSON** | Text data format exchanged between frontend and backend |
| **CORS** | Browser rule controlling which sites' JS may call your API |
| **ORM** | Maps DB rows to code objects (Prisma) |
| **Migration** | Versioned SQL script that evolves the DB schema |
| **Schema** | The definition of tables, columns, and relationships |
| **Hashing** | One-way transform; used to store passwords safely |
| **JWT** | Signed token proving who the user is, statelessly |
| **Middleware** | Code that runs on every request before the route handler |
| **OAuth** | Logging in via a third party (Google) that vouches for identity |
| **Environment variable** | Config/secret injected at runtime, kept out of code |
| **Monorepo** | One repository holding multiple apps (frontend + backend) |
| **Deployment** | Putting the app on the internet on hosting providers |
| **IDOR** | Insecure Direct Object Reference — accessing others' data by guessing ids |
```
