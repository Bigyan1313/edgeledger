import express from 'express'
import cors from 'cors'
import healthRouter from './routes/health.js'
import authRouter from './routes/auth.js'
import tradesRouter from './routes/trades.js'
import { requireAuth } from './auth/middleware.js'

const app = express()

// Hosts (Render, etc.) inject their own port via process.env.PORT.
const PORT = process.env.PORT || 3001

// Allowed browser origins for CORS. In production set FRONTEND_ORIGIN to your
// Vercel URL (comma-separated if more than one). Falls back to local dev ports.
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map(o => o.trim())

// Middleware: runs on every request before your route handlers
app.use(cors({ origin: allowedOrigins }))
app.use(express.json())                              // parse JSON request bodies

// Public routes (no token needed)
app.use('/api', healthRouter)
app.use('/api/auth', authRouter)

// Protected routes — requireAuth runs first and rejects anyone without a valid token
app.use('/api/trades', requireAuth, tradesRouter)

app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`)
})
