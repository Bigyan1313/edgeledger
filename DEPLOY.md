# Deploying EdgeLedger

Architecture: **Vercel** (frontend) → **Render** (backend API) → **Neon** (Postgres).
All three have free tiers and deploy from your GitHub repo.

> Order matters because of dependencies: Database → Backend → Frontend → wire-up.

---

## 0. Push to GitHub

```bash
git init
git add .
git commit -m "EdgeLedger: ready for deploy"
```

Create a new repo on github.com (e.g. `edgeledger`), then:

```bash
git remote add origin https://github.com/<you>/edgeledger.git
git branch -M main
git push -u origin main
```

---

## 1. Database — Neon

1. Sign in at [neon.tech](https://neon.tech) with GitHub.
2. Create a project (e.g. `edgeledger`). Region: pick one near you.
3. Copy the **connection string** (looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).
4. Keep it handy — it's the `DATABASE_URL` for Render. The schema gets created automatically when Render runs `prisma migrate deploy` during its build.

---

## 2. Backend — Render

1. Sign in at [render.com](https://render.com) with GitHub.
2. **New → Web Service** → connect your `edgeledger` repo.
3. Settings:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. **Environment Variables** (Advanced → Add):
   - `DATABASE_URL` = your Neon connection string
   - `JWT_SECRET` = a FRESH long random string (generate a new one, don't reuse local)
   - `GOOGLE_CLIENT_ID` = your Google client id
   - (we'll add `FRONTEND_ORIGIN` in step 4, once we know the Vercel URL)
5. Create the service. Wait for the build. Note the URL, e.g. `https://edgeledger-api.onrender.com`.
6. Sanity check: visit `https://<your-render-url>/api/health` — should return `{"status":"ok",...}`.

---

## 3. Frontend — Vercel

1. Sign in at [vercel.com](https://vercel.com) with GitHub.
2. **Add New → Project** → import the `edgeledger` repo.
3. Settings:
   - **Root Directory:** `frontend`
   - Framework preset: **Vite** (auto-detected)
4. **Environment Variables:**
   - `VITE_API_URL` = `https://<your-render-url>/api`  (note the `/api` suffix)
   - `VITE_GOOGLE_CLIENT_ID` = your Google client id
5. Deploy. Note the URL, e.g. `https://edgeledger.vercel.app`.

---

## 4. Wire up CORS + Google

Now that the frontend URL exists, connect the last two ends:

1. **Render** → your service → Environment → add:
   - `FRONTEND_ORIGIN` = `https://edgeledger.vercel.app`
   - Save (Render auto-redeploys).
2. **Google Cloud Console** → Auth Platform → Clients → your Web client → **Authorized JavaScript origins** → add:
   - `https://edgeledger.vercel.app`
   - Save (can take a few minutes to propagate).

---

## 5. Verify in production

- Open your Vercel URL.
- Sign up / log in with email+password.
- Sign in with Google.
- Log a trade, refresh — it persists (proving the full chain frontend → Render → Neon).

> **Free-tier note:** Render's free backend sleeps after ~15 min idle. The first request after that takes ~50s to wake up (you'll see a slow initial load). Paid tier removes this.
