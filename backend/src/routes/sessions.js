import { Router } from 'express'
import prisma from '../prisma/client.js'
import {
  localDate, nextDate, resolveTimezone, effectiveMinSleep,
  readinessVerdict, validateReadiness, coerceReadiness,
  validatePlan, coercePlan, validateClose, serializeSession,
} from '../domain/session.js'
import { validateCharts, MAX_CHARTS } from '../domain/charts.js'
import { accountAllowed, parseAccountId, parseId } from './ownership.js'

const router = Router()

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function rejectInvalid(res, errors) {
  return res.status(400).json({
    error: errors.map(e => e.message).join(' '),
    fieldErrors: errors,
  })
}

const withAccount = { account: { select: { id: true, name: true } } }

// The day a request is about, in the trader's zone. The profile's pinned zone
// wins over the browser's, for the same reason it does on trades: a trader who
// travels decides which clock their journal is read in.
async function dayContext(userId, browserTimezone) {
  const profile = await prisma.profile.findUnique({ where: { userId } })
  const timezone = resolveTimezone(profile?.timezone, browserTimezone)
  const today = localDate(new Date(), timezone)
  return { profile, timezone, today }
}

// Readiness belongs to the person, not the account. If any account was ruled
// a no-trade day, that answer stands for the others.
async function blockedElsewhere(userId, sessionDate) {
  const blocked = await prisma.tradingSession.findFirst({
    where: { userId, sessionDate, status: 'blocked' },
    include: withAccount,
  })
  if (!blocked) return null
  return blocked.account?.name ?? 'another account'
}

// GET /api/sessions/today?accountId=&timezone= — today's plan for one account,
// plus what the entry screen needs to decide what to show.
router.get('/today', handle(async (req, res) => {
  const accountId = parseAccountId(req.query.accountId)
  if (Number.isNaN(accountId)) return res.status(400).json({ error: 'Invalid account' })
  if (!(await accountAllowed(accountId, req.userId))) return res.status(400).json({ error: 'Invalid account' })

  const { profile, timezone, today } = await dayContext(req.userId, req.query.timezone)
  const [session, anyEarlier, elsewhere] = await Promise.all([
    prisma.tradingSession.findFirst({ where: { userId: req.userId, accountId, sessionDate: today }, include: withAccount }),
    prisma.tradingSession.findFirst({ where: { userId: req.userId, sessionDate: { lte: today } }, select: { id: true } }),
    blockedElsewhere(req.userId, today),
  ])

  res.json({
    today,
    timezone,
    session: serializeSession(session),
    // Whether today's trades are checked at all. False until the first plan
    // is ever written — see evaluateTrade.
    gateActive: Boolean(anyEarlier),
    minSleepHours: effectiveMinSleep(profile),
    blockedElsewhere: elsewhere,
  })
}))

// GET /api/sessions — recent days, newest first.
router.get('/', handle(async (req, res) => {
  const sessions = await prisma.tradingSession.findMany({
    where: { userId: req.userId },
    include: withAccount,
    orderBy: [{ sessionDate: 'desc' }, { openedAt: 'desc' }],
    // ?all=true is the export: every row, not the recent screenful.
    ...(req.query.all === 'true' ? {} : { take: 90 }),
  })
  res.json(sessions.map(s => serializeSession(s, { summary: true })))
}))

// POST /api/sessions — write the day's plan. Readiness first: if it fails, the
// day is recorded as blocked and no plan is asked for. If it passes, the full
// plan is required. Either way the row is final.
router.post('/', handle(async (req, res) => {
  const accountId = parseAccountId(req.body.accountId)
  if (Number.isNaN(accountId)) return res.status(400).json({ error: 'Invalid account' })
  if (!(await accountAllowed(accountId, req.userId))) return res.status(400).json({ error: 'Invalid account' })

  const { profile, timezone, today } = await dayContext(req.userId, req.body.timezone)

  // A plan can be written the night before. It cannot be written for a day
  // that has already gone — that is a diary entry, not a plan.
  const sessionDate = req.body.sessionDate ?? today
  if (sessionDate !== today && sessionDate !== nextDate(today)) {
    return rejectInvalid(res, [{
      field: 'sessionDate',
      message: `A plan is written for today (${today}) or tomorrow. Not for a day that has already happened.`,
    }])
  }

  const readiness = coerceReadiness(req.body)
  const readinessErrors = validateReadiness(readiness)
  if (readinessErrors.length) return rejectInvalid(res, readinessErrors)

  // One plan per account per day, and NULL accounts are distinct to the
  // unique index — so check here as well as relying on it.
  const existing = await prisma.tradingSession.findFirst({
    where: { userId: req.userId, accountId, sessionDate },
    select: { id: true },
  })
  if (existing) return alreadyWritten(res, sessionDate)

  const minSleepHoursApplied = effectiveMinSleep(profile)
  const verdict = readinessVerdict(readiness, minSleepHoursApplied, {
    blockedElsewhere: await blockedElsewhere(req.userId, sessionDate),
  })

  let plan = { marketSession: null, bias: null, wantToSee: null, noTradeIf: null, scenarios: null, maxTrades: null }
  if (verdict.status === 'open') {
    plan = coercePlan(req.body)
    const planErrors = validatePlan(plan)
    if (planErrors.length) return rejectInvalid(res, planErrors)
  }

  try {
    const session = await prisma.tradingSession.create({
      data: {
        userId: req.userId,
        accountId,
        sessionDate,
        timezone,
        ...readiness,
        minSleepHoursApplied,
        ...plan,
        status: verdict.status,
        blockedReasons: verdict.reasons,
      },
      include: withAccount,
    })
    res.status(201).json(serializeSession(session))
  } catch (err) {
    if (err?.code === 'P2002') return alreadyWritten(res, sessionDate)
    throw err
  }
}))

function alreadyWritten(res, sessionDate) {
  return res.status(409).json({
    error: `The plan for ${sessionDate} on this account is already written, and a plan is locked once written.`,
  })
}

// POST /api/sessions/:id/screenshots — add charts to an open day's plan. Add
// only: the text of a plan is locked, and the evidence behind it can grow but
// not shrink.
router.post('/:id/screenshots', handle(async (req, res) => {
  const session = await prisma.tradingSession.findFirst({ where: { id: parseId(req.params.id) ?? -1, userId: req.userId } })
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (session.status !== 'open') {
    return res.status(409).json({ error: `Charts can be added while the day is open. This session is ${session.status}.` })
  }
  const added = Array.isArray(req.body.screenshots) ? req.body.screenshots : []
  if (!added.length) return rejectInvalid(res, [{ field: 'screenshots', message: 'No chart was sent.' }])
  const errors = validateCharts([...session.screenshots, ...added])
  if (errors.length) {
    return rejectInvalid(res, session.screenshots.length + added.length > MAX_CHARTS
      ? [{ field: 'screenshots', message: `A plan holds at most ${MAX_CHARTS} charts; this one has ${session.screenshots.length}.` }]
      : errors)
  }
  const updated = await prisma.tradingSession.update({
    where: { id: session.id },
    data: { screenshots: { push: added } },
    include: withAccount,
  })
  res.json(serializeSession(updated))
}))

// POST /api/sessions/:id/close — the post-session review. Only an open day can
// be closed; a blocked day was never open, and it is already its own outcome.
router.post('/:id/close', handle(async (req, res) => {
  const session = await prisma.tradingSession.findFirst({
    where: { id: parseId(req.params.id) ?? -1, userId: req.userId },
  })
  if (!session) return res.status(404).json({ error: 'Session not found' })
  if (session.status !== 'open') {
    return res.status(409).json({ error: `This session is ${session.status} and cannot be closed.` })
  }

  const errors = validateClose(req.body)
  if (errors.length) return rejectInvalid(res, errors)

  const review = typeof req.body.review === 'string' && req.body.review.trim() ? req.body.review.trim() : null
  const closed = await prisma.tradingSession.update({
    where: { id: session.id },
    data: { status: 'closed', closedAt: new Date(), followedPlan: req.body.followedPlan, review },
    include: withAccount,
  })
  res.json(serializeSession(closed))
}))

export default router
