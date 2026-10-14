import { Router } from 'express'
import prisma from '../prisma/client.js'
import { readExport, buildTrades, matchTrades } from '../domain/tradovate.js'
import { validateStageB } from '../domain/validation.js'
import { computeDataQualityFlags } from '../domain/dataQuality.js'
import { isValidTimezone } from '../domain/profile.js'
import { parseAccountId, accountAllowed } from './ownership.js'

const router = Router()
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

const MAX_CSV_CHARS = 2_000_000
const DAY_MS = 24 * 60 * 60 * 1000

// Reads the export and matches it against this user's journal. Shared by
// preview and apply, so apply acts on what it works out itself — never on a
// list of closes the browser says it was shown.
async function analyse(userId, body) {
  const timezone = String(body.timezone ?? '').trim()
  if (!isValidTimezone(timezone)) {
    return { status: 400, body: { error: 'Choose the timezone your Tradovate platform shows times in, e.g. America/Chicago.', fieldErrors: [{ field: 'timezone', message: 'Not a valid IANA timezone.' }] } }
  }
  if (typeof body.csv !== 'string' || !body.csv.trim()) {
    return { status: 400, body: { error: 'No file content was sent.' } }
  }
  if (body.csv.length > MAX_CSV_CHARS) {
    return { status: 400, body: { error: 'That file is too large. Export a shorter date range.' } }
  }
  const accountId = parseAccountId(body.accountId)
  if (Number.isNaN(accountId) || !(await accountAllowed(accountId, userId))) {
    return { status: 400, body: { error: 'Invalid account' } }
  }

  const read = readExport(body.csv, { timeZone: timezone })
  if (read.error) return { status: 400, body: read }

  const brokerTrades = buildTrades(read.fills)
  if (!brokerTrades.length) {
    return { status: 200, analysis: { read, brokerTrades, results: [] } }
  }

  // Only journal trades that could plausibly match: entered within a day of
  // the export's span, on the chosen account when one is given.
  const first = brokerTrades[0].entryAt.getTime()
  const last = Math.max(...brokerTrades.map(t => t.entryAt.getTime()))
  const journal = await prisma.trade.findMany({
    where: {
      userId,
      ...(accountId != null ? { accountId } : {}),
      entryTimeUtc: { gte: new Date(first - DAY_MS), lte: new Date(last + DAY_MS) },
    },
  })

  const results = matchTrades(brokerTrades, journal).map(r => {
    if (r.status !== 'will_close') return { ...r, problems: [] }
    const input = { exitTimeUtc: r.broker.exitAt, exitPrice: r.broker.exitPrice, pnl: r.broker.pnl }
    // The same rules a hand-typed close is held to.
    const problems = validateStageB(input, r.trade).map(e => e.message)
    if (r.broker.pnl == null) problems.push('The export has no P&L for this trade and its instrument has no known point value.')
    return { ...r, input, problems }
  })
  return { status: 200, analysis: { read, brokerTrades, results } }
}

function present({ read, brokerTrades, results }) {
  const count = (s) => results.filter(r => r.status === s).length
  return {
    shape: read.shape,
    skippedRows: read.skipped,
    summary: {
      brokerTrades: brokerTrades.length,
      willClose: results.filter(r => r.status === 'will_close' && !r.problems.length).length,
      withProblems: results.filter(r => r.status === 'will_close' && r.problems.length).length,
      alreadyClosed: count('already_closed'),
      ambiguous: count('ambiguous'),
      notInJournal: count('not_in_journal'),
    },
    rows: results.map(r => ({
      status: r.status,
      by: r.by ?? null,
      problems: r.problems,
      candidates: r.candidates,
      broker: r.broker,
      trade: r.trade && {
        id: r.trade.id, pair: r.trade.pair, direction: r.trade.direction, lotSize: r.trade.lotSize,
        entryTimeUtc: r.trade.entryTimeUtc, entryPrice: r.trade.entryPrice, accountId: r.trade.accountId,
      },
    })),
  }
}

// POST /api/imports/tradovate/preview — what an import would do. Writes nothing.
router.post('/tradovate/preview', handle(async (req, res) => {
  const result = await analyse(req.userId, req.body)
  if (!result.analysis) return res.status(result.status).json(result.body)
  res.json(present(result.analysis))
}))

// POST /api/imports/tradovate/apply — close the confirmed trades. Only trades
// that are still open, matched, problem-free, and named in tradeIds are
// touched, all in one transaction.
router.post('/tradovate/apply', handle(async (req, res) => {
  const result = await analyse(req.userId, req.body)
  if (!result.analysis) return res.status(result.status).json(result.body)

  const wanted = new Set((Array.isArray(req.body.tradeIds) ? req.body.tradeIds : []).map(Number))
  const toClose = result.analysis.results.filter(r => r.status === 'will_close' && !r.problems.length && wanted.has(r.trade.id))
  const now = new Date()

  const closed = await prisma.$transaction(async (tx) => {
    const ids = []
    for (const r of toClose) {
      const merged = { ...r.trade, ...r.input, entryStage: 'complete' }
      // Conditional on still being open, so a close typed in another tab
      // meanwhile is not overwritten.
      const { count } = await tx.trade.updateMany({
        where: { id: r.trade.id, userId: req.userId, entryStage: 'pending_exit' },
        data: {
          exitTimeUtc: r.input.exitTimeUtc,
          exitPrice: r.input.exitPrice,
          pnl: r.input.pnl,
          entryStage: 'complete',
          lastEditedAt: now,
          dataQualityFlags: computeDataQualityFlags(merged),
        },
      })
      if (count) ids.push(r.trade.id)
    }
    return ids
  })

  res.json({ closed, ...present(result.analysis) })
}))

export default router
