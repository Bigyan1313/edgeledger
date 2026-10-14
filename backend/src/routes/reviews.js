import { Router } from 'express'
import prisma from '../prisma/client.js'
import { parseId } from './ownership.js'
import {
  marketSettings, reviewWindow, recentWeekdays, reviewDayState, isValidDate, dayRecordStatus,
  coerceReview, validateReview, serializeReview, summarizeReview,
} from '../domain/review.js'

const router = Router()

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function rejectInvalid(res, errors) {
  return res.status(400).json({
    error: errors.map(e => e.message).join(' '),
    fieldErrors: errors,
  })
}

async function settingsFor(userId) {
  return marketSettings(await prisma.profile.findUnique({ where: { userId } }))
}

async function windowFor(userId, now = new Date()) {
  return reviewWindow(now, await settingsFor(userId))
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

const planSummary = (p) => ({
  id: p.id, account: p.account, marketSession: p.marketSession, bias: p.bias, wantToSee: p.wantToSee,
  scenarios: p.scenarios, noTradeIf: p.noTradeIf, tradesLogged: p.tradesLogged, maxTrades: p.maxTrades,
})

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
      where: { userId: req.userId, reviewDate: { in: days }, isBacktest: false },
      select: { reviewDate: true, writtenAt: true, marketTimezone: true, isBacktest: true },
    }),
    prisma.priceActionReview.findFirst({ where: { userId: req.userId }, orderBy: { writtenAt: 'desc' }, select: { symbol: true } }),
  ])

  const recentDays = days.map(date => ({
    date,
    status: dayRecordStatus(date, reviewedDays.filter(r => r.reviewDate === date), { today: window.reviewDate, windowState: window.state }),
  }))

  res.json({
    window,
    reviews: reviews.map(serializeReview),
    plans: plans.map(planSummary),
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
    // ?all=true is the export: every row, not the recent screenful.
    ...(req.query.all === 'true' ? {} : { take: 60 }),
  })
  res.json(reviews.map(summarizeReview))
}))

// GET /api/reviews/day/:date — one trading day: its state, its plans, and
// any reviews already written for it. Used for catching up a missed day and
// for backtesting old ones.
router.get('/day/:date', handle(async (req, res) => {
  const date = req.params.date
  if (!isValidDate(date)) return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' })
  const settings = await settingsFor(req.userId)
  const [plans, reviews] = await Promise.all([
    plansFor(req.userId, date),
    prisma.priceActionReview.findMany({ where: { userId: req.userId, reviewDate: date }, orderBy: { writtenAt: 'asc' } }),
  ])
  res.json({
    date,
    state: reviewDayState(date, new Date(), settings),
    plans: plans.map(planSummary),
    planExists: plans.length > 0,
    reviews: reviews.map(serializeReview),
  })
}))

router.get('/:id', handle(async (req, res) => {
  const review = await prisma.priceActionReview.findFirst({ where: { id: parseId(req.params.id) ?? -1, userId: req.userId } })
  if (!review) return res.status(404).json({ error: 'Review not found' })
  res.json(serializeReview(review))
}))

// POST /api/reviews — a review for one symbol on one trading day. Without a
// reviewDate it is today's, which opens three hours after the open. A past
// weekday can be reviewed at any time: it is stored with when it was written,
// so a late review reads as late, and isBacktest marks practice on an old day
// that never counts toward the daily record.
router.post('/', handle(async (req, res) => {
  const settings = await settingsFor(req.userId)
  const now = new Date()
  const window = reviewWindow(now, settings)
  const reviewDate = req.body.reviewDate ?? window.reviewDate
  if (!isValidDate(reviewDate)) {
    return rejectInvalid(res, [{ field: 'reviewDate', message: 'Date must be YYYY-MM-DD.' }])
  }

  const state = reviewDayState(reviewDate, now, settings)
  if (state === 'future') {
    return res.status(409).json({ error: 'That day has not happened yet.', code: 'REVIEW_WINDOW' })
  }
  if (state === 'weekend' && reviewDate !== window.reviewDate) {
    return res.status(409).json({ error: `${reviewDate} was a weekend — no price action to review.`, code: 'REVIEW_WINDOW' })
  }
  if (state === 'weekend' || state === 'not_yet') return windowRefusal(res, window)

  const isBacktest = req.body.isBacktest === true
  if (isBacktest && state !== 'past') {
    return rejectInvalid(res, [{ field: 'isBacktest', message: "Today's review is a live one. Backtests are for days already gone." }])
  }

  const planExists = (await plansFor(req.userId, reviewDate)).length > 0
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
        reviewDate,
        isBacktest,
        marketTimezone: settings.marketTimezone,
        marketOpenTime: settings.marketOpenTime,
      },
    })
    res.status(201).json(serializeReview(review))
  } catch (err) {
    if (err?.code === 'P2002') {
      return res.status(409).json({
        error: `The ${reviewDate} review for ${input.symbol} is already written. Edit it instead.`,
        fieldErrors: [{ field: 'symbol', message: 'Already reviewed for that day.' }],
      })
    }
    throw err
  }
}))

// PUT /api/reviews/:id — corrections at any time. Each one moves
// lastEditedAt, and an edit after the review's day closed reads as "edited
// later" with its time. The day, the backtest mark and writtenAt never change.
router.put('/:id', handle(async (req, res) => {
  const existing = await prisma.priceActionReview.findFirst({ where: { id: parseId(req.params.id) ?? -1, userId: req.userId } })
  if (!existing) return res.status(404).json({ error: 'Review not found' })

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
    res.json(serializeReview(review))
  } catch (err) {
    if (err?.code === 'P2002') {
      return res.status(409).json({ error: `The ${existing.reviewDate} review for ${input.symbol} already exists.` })
    }
    throw err
  }
}))

export default router
