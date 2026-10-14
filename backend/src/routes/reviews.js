import { Router } from 'express'
import prisma from '../prisma/client.js'
import {
  marketSettings, reviewWindow, isEditable, recentWeekdays,
  coerceReview, validateReview, summarizeReview,
} from '../domain/review.js'

const router = Router()

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function rejectInvalid(res, errors) {
  return res.status(400).json({
    error: errors.map(e => e.message).join(' '),
    fieldErrors: errors,
  })
}

async function windowFor(userId, now = new Date()) {
  const profile = await prisma.profile.findUnique({ where: { userId } })
  return reviewWindow(now, marketSettings(profile))
}

// The day's plans that actually opened. A blocked day had no plan to compare
// against. Sessions are dated in the trader's zone and reviews in the
// market's; for anyone whose open falls on the same calendar date in both —
// the New York open from the Americas, Europe, Africa or most of Asia — they
// line up exactly.
function plansFor(userId, reviewDate) {
  return prisma.tradingSession.findMany({
    where: { userId, sessionDate: reviewDate, status: { not: 'blocked' } },
    include: { account: { select: { id: true, name: true } } },
    orderBy: { openedAt: 'asc' },
  })
}

const clock = (instant, timeZone) =>
  new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(instant)

function windowRefusal(res, window) {
  const error = window.state === 'weekend'
    ? 'Markets are closed today — there is no price action to review.'
    : `The review opens at ${clock(window.opensAt, window.marketTimezone)} — three hours after the open, once the morning has played out.`
  return res.status(409).json({ error, code: 'REVIEW_WINDOW', window })
}

// GET /api/reviews/today — everything the review screen needs in one call.
router.get('/today', handle(async (req, res) => {
  const window = await windowFor(req.userId)
  const days = recentWeekdays(window.reviewDate, 10)

  const [reviews, plans, reviewedDays, last] = await Promise.all([
    prisma.priceActionReview.findMany({ where: { userId: req.userId, reviewDate: window.reviewDate }, orderBy: { writtenAt: 'asc' } }),
    plansFor(req.userId, window.reviewDate),
    prisma.priceActionReview.findMany({
      where: { userId: req.userId, reviewDate: { in: days } },
      select: { reviewDate: true },
      distinct: ['reviewDate'],
    }),
    prisma.priceActionReview.findFirst({ where: { userId: req.userId }, orderBy: { writtenAt: 'desc' }, select: { symbol: true } }),
  ])

  const reviewed = new Set(reviewedDays.map(r => r.reviewDate))
  const recentDays = days.map(date => {
    if (reviewed.has(date)) return { date, status: 'reviewed' }
    if (date !== window.reviewDate) return { date, status: 'missed' }
    return { date, status: window.state === 'open' ? 'due' : 'pending' }
  })

  res.json({
    window,
    reviews,
    plans: plans.map(p => ({
      id: p.id, account: p.account, bias: p.bias, wantToSee: p.wantToSee,
      scenarios: p.scenarios, noTradeIf: p.noTradeIf, tradesLogged: p.tradesLogged, maxTrades: p.maxTrades,
    })),
    planExists: plans.length > 0,
    recentDays,
    lastSymbol: last?.symbol ?? null,
  })
}))

// GET /api/reviews — recent reviews, newest first, without the images.
router.get('/', handle(async (req, res) => {
  const reviews = await prisma.priceActionReview.findMany({
    where: { userId: req.userId },
    orderBy: [{ reviewDate: 'desc' }, { writtenAt: 'desc' }],
    take: 60,
  })
  res.json(reviews.map(summarizeReview))
}))

router.get('/:id', handle(async (req, res) => {
  const review = await prisma.priceActionReview.findFirst({ where: { id: Number(req.params.id), userId: req.userId } })
  if (!review) return res.status(404).json({ error: 'Review not found' })
  res.json(review)
}))

// POST /api/reviews — today's review for one symbol. The day is the server's
// to decide, from the market's clock: there is no field for writing one for
// another date.
router.post('/', handle(async (req, res) => {
  const window = await windowFor(req.userId)
  if (window.state !== 'open') return windowRefusal(res, window)

  const planExists = (await plansFor(req.userId, window.reviewDate)).length > 0
  const input = coerceReview(req.body)
  // With no plan there is nothing to have played out; whatever was sent is
  // not a comparison, so it is not stored as one.
  if (!planExists) input.planPlayedOut = null

  const errors = validateReview(input, { planExists })
  if (errors.length) return rejectInvalid(res, errors)

  try {
    const review = await prisma.priceActionReview.create({
      data: {
        ...input,
        userId: req.userId,
        reviewDate: window.reviewDate,
        marketTimezone: window.marketTimezone,
        marketOpenTime: window.marketOpenTime,
      },
    })
    res.status(201).json(review)
  } catch (err) {
    if (err?.code === 'P2002') {
      return res.status(409).json({
        error: `Today's review for ${input.symbol} is already written. Edit it instead.`,
        fieldErrors: [{ field: 'symbol', message: 'Already reviewed today.' }],
      })
    }
    throw err
  }
}))

// PUT /api/reviews/:id — corrections on the day it was written, not after.
router.put('/:id', handle(async (req, res) => {
  const existing = await prisma.priceActionReview.findFirst({ where: { id: Number(req.params.id), userId: req.userId } })
  if (!existing) return res.status(404).json({ error: 'Review not found' })
  if (!isEditable(existing, new Date())) {
    return res.status(409).json({
      error: `The review for ${existing.reviewDate} is closed. A review is written on its own day — after that it would be written with hindsight.`,
    })
  }

  const planExists = (await plansFor(req.userId, existing.reviewDate)).length > 0
  const input = coerceReview(req.body)
  if (!planExists) input.planPlayedOut = null
  const errors = validateReview(input, { planExists })
  if (errors.length) return rejectInvalid(res, errors)

  try {
    const review = await prisma.priceActionReview.update({
      where: { id: existing.id },
      data: { ...input, lastEditedAt: new Date() },
    })
    res.json(review)
  } catch (err) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: `Today's review for ${input.symbol} already exists.` })
    }
    throw err
  }
}))

export default router
