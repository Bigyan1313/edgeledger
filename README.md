# EdgeLedger

A personal **trading journal + performance analytics** web app for discretionary traders. Log your trades, and EdgeLedger turns them into the metrics that actually matter — expectancy, profit factor, R-multiples, equity curve, and per-setup breakdowns — with a focus on surfacing the *behavioral* patterns that make or break an account.

**Live app:** https://edgeledger-tau.vercel.app

> Built as a full-stack learning project: real frontend ↔ backend ↔ database, multi-user authentication, and a production deployment — not a toy.

---

## Features

**Journaling**
- Log, edit, and delete trades with full ICT-style metadata (setup, direction, emotion, checklist adherence)
- Trade history table with danger-setup flagging
- CSV export

**Analytics dashboard**
- Net P&L, win rate, profit factor, expectancy per trade, average R
- Equity curve (cumulative P&L over time)
- **Performance-by-setup** table — see which setups carry the account vs. bleed it
- **Discipline mirror** — compares P&L and win rate for *checklist-followed vs. not* and *calm vs. not-calm* entries, putting a dollar figure on indiscipline

**Tools**
- Position-size calculator (risk % → lot size)
- Risk:reward calculator

**Accounts & security**
- Email + password auth (bcrypt-hashed, never stored in plaintext)
- Google sign-in (Google Identity Services)
- JWT-based stateless sessions
- Strict per-user data isolation — every query is scoped to the authenticated user

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | React + Vite + Tailwind CSS | Fast dev loop, component model, utility-first styling |
| Backend | Node.js + Express | Minimal, close-to-HTTP framework — nothing hidden |
| ORM | Prisma | Type-safe queries + versioned schema migrations |
| Database | PostgreSQL | Relational, strongly typed, battle-tested |
| Auth | bcryptjs + jsonwebtoken + Google Identity Services | Password hashing, stateless JWTs, OAuth |
| Hosting | Vercel (frontend) · Render (backend) · Neon (Postgres) | Free-tier, git-based deploys |

---

## Architecture

```
   ┌─────────────┐      ┌──────────────┐      ┌──────────────┐
   │  Frontend   │────▶ │   Backend    │────▶ │  Database    │
   │  React/Vite │ HTTP │ Express API  │ SQL  │  PostgreSQL  │
   │  (Vercel)   │ JSON │  (Render)    │      │   (Neon)     │
   └─────────────┘      └──────────────┘      └──────────────┘
        JWT in              requireAuth            per-user
     Authorization        middleware sets         row scoping
        header             req.userId
```

The frontend is a static SPA that talks to the backend purely over a REST/JSON API. The backend authenticates each request via a JWT bearer token, attaches the user's id, and scopes every database query to that user.

---

## Getting started (local)

### Prerequisites
- Node.js 18+ (22+ recommended)
- PostgreSQL 14+

### 1. Clone & install
```bash
git clone https://github.com/Bigyan1313/edgeledger.git
cd edgeledger
(cd backend && npm install)
(cd frontend && npm install)
```

### 2. Create the database
```bash
createdb edgeledger
```

### 3. Configure environment
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
# then fill in the values (see below)
```

### 4. Run migrations
```bash
cd backend && npx prisma migrate dev
```

### 5. Start both servers (two terminals)
```bash
# terminal 1 — backend (http://localhost:3001)
cd backend && npm run dev

# terminal 2 — frontend (http://localhost:5173)
cd frontend && npm run dev
```

Open http://localhost:5173.

### Environment variables

**`backend/.env`**
| Var | Description |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | Long random string for signing tokens |
| `GOOGLE_CLIENT_ID` | Google OAuth client id (public) |
| `FRONTEND_ORIGIN` | (prod) allowed CORS origin |

**`frontend/.env`**
| Var | Description |
|---|---|
| `VITE_GOOGLE_CLIENT_ID` | Same Google client id |
| `VITE_API_URL` | (prod) backend API base URL |

---

## Core domain logic

The analytics are only as good as their formulas. The ones EdgeLedger holds to:

```
planned R:R   = reward / risk
realized R     long:  (exit - entry) / (entry - stopLoss)
               short: (entry - exit) / (stopLoss - entry)
               fallback: pnl / riskDollars

win rate      = wins / (wins + losses)          // break-evens excluded
expectancy ($)= winRate * avgWin - lossRate * avgLoss
profit factor = grossWin / grossLoss
equity curve  = running cumulative sum of pnl, chronological

position size: riskDollars = balance * riskPct/100
               lotSize     = riskDollars / (stopLossPips * dollarsPerPipPerLot)
```

---

## Project structure

```
edgeledger/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma        # data model
│   │   └── migrations/          # versioned SQL migrations
│   └── src/
│       ├── index.js             # Express app entry
│       ├── auth/                # jwt, middleware
│       └── routes/              # auth, trades, health
├── frontend/
│   └── src/
│       ├── api/                 # API client (token handling)
│       ├── auth/                # AuthContext
│       └── components/          # Dashboard, TradeForm, Calculators, …
└── DEPLOY.md                    # production deploy guide
```

## Deployment

See [`DEPLOY.md`](DEPLOY.md) for the full Neon → Render → Vercel walkthrough.

---

## Roadmap

- [x] Local MVP — trade CRUD + REST API
- [x] Analytics dashboard + calculators + CSV export
- [x] Auth & multi-user (email/password + Google OAuth, per-user isolation)
- [x] Production deployment
- [ ] Per-user daily guardrails (max trades/day, daily loss limit)
- [ ] Chart screenshot uploads
- [ ] Broker CSV import (cTrader / MT5)
- [ ] Calendar / daily P&L view
- [ ] Tagging & filtering
- [ ] Security hardening (httpOnly cookies, rate limiting)

---

## License

MIT
