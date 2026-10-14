import { Router } from 'express'
import prisma from '../prisma/client.js'
import { coerceAccountRules, validateAccountRules, computeStanding, RULE_FIELDS } from '../domain/standing.js'
import { marketSettings } from '../domain/review.js'
import { computeRiskDollars } from '../domain/derived.js'

const router = Router()

// Express 4 does not catch rejected promises from async handlers.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Every route assumes requireAuth has set req.userId.

// GET /api/accounts — list this user's accounts
router.get('/', handle(async (req, res) => {
  const accounts = await prisma.account.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'asc' },
  })
  res.json(accounts)
}))

// POST /api/accounts — create an account
router.post('/', handle(async (req, res) => {
  const { name, mode, propFirm, startingBalance } = req.body

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Account name is required' })
  }
  if (mode !== 'Live' && mode !== 'Demo') {
    return res.status(400).json({ error: 'Mode must be "Live" or "Demo"' })
  }

  const account = await prisma.account.create({
    data: {
      userId: req.userId,
      name: name.trim(),
      mode,
      // propFirm only meaningful for Demo accounts
      propFirm: mode === 'Demo' && propFirm ? propFirm : null,
      startingBalance:
        startingBalance !== undefined && startingBalance !== null && startingBalance !== ''
          ? Number(startingBalance)
          : null,
    },
  })
  res.status(201).json(account)
}))

// DELETE /api/accounts/:id — delete; trades stay (accountId set null)
router.delete('/:id', handle(async (req, res) => {
  const result = await prisma.account.deleteMany({
    where: { id: Number(req.params.id), userId: req.userId },
  })
  if (result.count === 0) return res.status(404).json({ error: 'Account not found' })
  res.status(204).send()
}))

// PUT /api/accounts/:id — the name, and the firm's rules for losing it.
router.put('/:id', handle(async (req, res) => {
  const existing = await prisma.account.findFirst({ where: { id: Number(req.params.id), userId: req.userId } })
  if (!existing) return res.status(404).json({ error: 'Account not found' })

  const changes = coerceAccountRules(req.body)
  const has = (k) => Object.prototype.hasOwnProperty.call(req.body, k)
  if (has('name')) {
    const name = String(req.body.name ?? '').trim()
    if (!name) return res.status(400).json({ error: 'Account name is required', fieldErrors: [{ field: 'name', message: 'Account name is required.' }] })
    changes.name = name
  }
  if (has('mode')) {
    if (req.body.mode !== 'Live' && req.body.mode !== 'Demo') {
      return res.status(400).json({ error: 'Mode must be "Live" or "Demo"', fieldErrors: [{ field: 'mode', message: 'Live or Demo.' }] })
    }
    changes.mode = req.body.mode
  }
  // Same rule as creation: a prop firm is only recorded on a Demo account.
  const mode = changes.mode ?? existing.mode
  if (has('propFirm') || has('mode')) {
    const firm = has('propFirm') ? String(req.body.propFirm ?? '').trim() : existing.propFirm
    changes.propFirm = mode === 'Demo' && firm ? firm : null
  }

  const errors = validateAccountRules({ ...existing, ...changes })
  if (errors.length) {
    return res.status(400).json({ error: errors.map(e => e.message).join(' '), fieldErrors: errors })
  }

  const account = await prisma.account.update({ where: { id: existing.id }, data: changes })
  res.json(account)
}))

// GET /api/accounts/:id/standing — distance to losing the account. With
// ?pair=&entry=&stop=&lots= it also prices the trade being planned, so the
// entry form can say what that trade would leave.
router.get('/:id/standing', handle(async (req, res) => {
  const account = await prisma.account.findFirst({ where: { id: Number(req.params.id), userId: req.userId } })
  if (!account) return res.status(404).json({ error: 'Account not found' })

  const [trades, profile] = await Promise.all([
    prisma.trade.findMany({
      where: { userId: req.userId, accountId: account.id },
      select: { entryStage: true, pnl: true, exitTimeUtc: true, entryTimeUtc: true, pair: true, entryPrice: true, stopLoss: true, lotSize: true },
    }),
    prisma.profile.findUnique({ where: { userId: req.userId } }),
  ])

  const num = (v) => (v === undefined || v === '' ? null : Number(v))
  const plannedRisk = req.query.pair
    ? computeRiskDollars({ pair: String(req.query.pair), entryPrice: num(req.query.entry), stopLoss: num(req.query.stop), lotSize: num(req.query.lots) })
    : null

  const standing = computeStanding({
    account, trades, now: new Date(), timeZone: marketSettings(profile).marketTimezone, plannedRisk,
  })
  res.json({ accountId: account.id, rules: Object.fromEntries(RULE_FIELDS.map(f => [f, account[f]])), ...standing })
}))

export default router
