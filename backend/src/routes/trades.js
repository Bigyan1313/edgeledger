import { Router } from 'express'
import prisma from '../prisma/client.js'

const router = Router()

// Every route below assumes requireAuth has already run and set req.userId.

// Guard: if a trade references an account, it must be one THIS user owns.
// (null/undefined account is allowed — trades can be untagged.)
async function accountAllowed(accountId, userId) {
  if (accountId == null) return true
  const acct = await prisma.account.findFirst({
    where: { id: Number(accountId), userId },
  })
  return Boolean(acct)
}

// GET /api/trades — list THIS user's trades, newest first
router.get('/', async (req, res) => {
  const trades = await prisma.trade.findMany({
    where: { userId: req.userId },
    orderBy: { date: 'desc' },
  })
  res.json(trades)
})

// POST /api/trades — create a trade owned by this user
router.post('/', async (req, res) => {
  // Strip any userId the client might try to send; we set it from the token.
  const { userId, id, ...data } = req.body
  if (!(await accountAllowed(data.accountId, req.userId))) {
    return res.status(400).json({ error: 'Invalid account' })
  }
  const trade = await prisma.trade.create({
    data: { ...data, userId: req.userId },
  })
  res.status(201).json(trade)
})

// GET /api/trades/:id — only if it belongs to this user
router.get('/:id', async (req, res) => {
  const trade = await prisma.trade.findFirst({
    where: { id: Number(req.params.id), userId: req.userId },
  })
  if (!trade) return res.status(404).json({ error: 'Trade not found' })
  res.json(trade)
})

// PUT /api/trades/:id — update only if owned by this user
router.put('/:id', async (req, res) => {
  const { userId, id, ...data } = req.body
  if (!(await accountAllowed(data.accountId, req.userId))) {
    return res.status(400).json({ error: 'Invalid account' })
  }
  // updateMany returns a count; it won't touch rows owned by someone else.
  const result = await prisma.trade.updateMany({
    where: { id: Number(req.params.id), userId: req.userId },
    data,
  })
  if (result.count === 0) return res.status(404).json({ error: 'Trade not found' })
  const trade = await prisma.trade.findUnique({ where: { id: Number(req.params.id) } })
  res.json(trade)
})

// DELETE /api/trades/:id — delete only if owned by this user
router.delete('/:id', async (req, res) => {
  const result = await prisma.trade.deleteMany({
    where: { id: Number(req.params.id), userId: req.userId },
  })
  if (result.count === 0) return res.status(404).json({ error: 'Trade not found' })
  res.status(204).send()
})

export default router
