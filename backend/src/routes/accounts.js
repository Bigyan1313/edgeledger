import { Router } from 'express'
import prisma from '../prisma/client.js'

const router = Router()

// Every route assumes requireAuth has set req.userId.

// GET /api/accounts — list this user's accounts
router.get('/', async (req, res) => {
  const accounts = await prisma.account.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'asc' },
  })
  res.json(accounts)
})

// POST /api/accounts — create an account
router.post('/', async (req, res) => {
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
})

// DELETE /api/accounts/:id — delete; trades stay (accountId set null)
router.delete('/:id', async (req, res) => {
  const result = await prisma.account.deleteMany({
    where: { id: Number(req.params.id), userId: req.userId },
  })
  if (result.count === 0) return res.status(404).json({ error: 'Account not found' })
  res.status(204).send()
})

export default router
