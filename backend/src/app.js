import express from 'express'
import cors from 'cors'
import healthRouter from './routes/health.js'
import authRouter from './routes/auth.js'
import tradesRouter from './routes/trades.js'
import accountsRouter from './routes/accounts.js'
import chatRouter from './routes/chat.js'
import { requireAuth } from './auth/middleware.js'

const app = express()

// Allowed browser origins for CORS. In production set FRONTEND_ORIGIN to your
// Vercel URL (comma-separated if more than one). Falls back to local dev ports.
const allowedOrigins = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173,http://localhost:5174')
  .split(',')
  .map(o => o.trim())

// Middleware: runs on every request before your route handlers
app.use(cors({ origin: allowedOrigins }))
app.use(express.json({ limit: '12mb' }))             // parse JSON bodies (roomy: trades carry base64 screenshots)

// Public routes (no token needed)
app.use('/api', healthRouter)
app.use('/api/auth', authRouter)

// Protected routes — requireAuth runs first and rejects anyone without a valid token
app.use('/api/trades', requireAuth, tradesRouter)
app.use('/api/accounts', requireAuth, accountsRouter)
app.use('/api/chat', requireAuth, chatRouter)

// Anything a route handler could not answer for itself. Logged in full server
// side, reported as a generic failure to the client — an internal error message
// is not something a browser needs.
// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ error: 'Something went wrong on the server.' })
})

export default app
