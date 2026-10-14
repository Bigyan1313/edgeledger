import { Router } from 'express'
import prisma from '../prisma/client.js'
import { DEFAULT_BROKER_PLATFORM, SCHEMA_VERSION } from '../domain/tradeSchema.js'
import { coerceStageA, coerceStageB } from '../domain/coerce.js'
import { validateStageA, validateStageB, validateAmendment } from '../domain/validation.js'
import { computeDataQualityFlags } from '../domain/dataQuality.js'
import { serializeTrade, serializeTrades } from '../domain/serialize.js'
import { accountAllowed } from './ownership.js'
import { sessionGateFor, sessionRulesResponse, TradeCapRace } from './sessionGate.js'

const router = Router()

// Express 4 does not catch rejected promises from async handlers, so an
// unexpected database error would hang the request instead of answering it.
// Wrapping hands anything unrecognised to the error middleware in index.js.
const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

// Every route below assumes requireAuth has already run and set req.userId.

// One shape for every rejection, so the client can render field-level errors
// without parsing prose.
function rejectInvalid(res, errors) {
  return res.status(400).json({
    error: errors.map(e => e.message).join(' '),
    fieldErrors: errors,
  })
}

// Prisma's unique-constraint violation. The only unique constraint on Trade is
// (userId, brokerPositionId), so this can mean exactly one thing.
function isDuplicatePosition(err) {
  return err?.code === 'P2002'
}

function duplicatePositionResponse(res, brokerPositionId) {
  return res.status(409).json({
    error: `A trade with broker position ID "${brokerPositionId}" already exists in this journal. One position is one entry — if this is a second leg, log it under its own position ID.`,
    fieldErrors: [{ field: 'brokerPositionId', message: 'Already used by another trade.' }],
  })
}

// Values render into the audit trail as text: an amendment record has to stay
// readable long after the field's type has been forgotten.
function renderForAudit(value) {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

// Dates compare by instant, everything else by value.
function fieldChanged(before, after) {
  if (before instanceof Date || after instanceof Date) {
    const b = before instanceof Date ? before.getTime() : null
    const a = after instanceof Date ? after.getTime() : null
    return b !== a
  }
  return before !== after
}

// GET /api/trades — list THIS user's trades, newest first.
//
// Task 8: v1 rows are excluded by default. They are real trades but they carry
// no broker linkage and cannot meet the v2 contract, so they must not drift
// into analysis as if they had. `?includeLegacy=true` is the explicit opt-in.
// `?stage=pending_exit` surfaces trades still awaiting their Stage B close.
router.get('/', handle(async (req, res) => {
  const includeLegacy = req.query.includeLegacy === 'true'
  const where = { userId: req.userId }
  if (!includeLegacy) where.schemaVersion = SCHEMA_VERSION
  if (req.query.stage) where.entryStage = String(req.query.stage)

  const trades = await prisma.trade.findMany({
    where,
    orderBy: { entryTimeUtc: 'desc' },
  })
  // Screenshots are base64 data URLs (can be ~1MB/trade), so the list drops the
  // images themselves; `screenshotCount` comes from the serializer either way.
  // The full images come back from GET /api/trades/:id.
  // eslint-disable-next-line no-unused-vars -- destructured to omit
  res.json(serializeTrades(trades).map(({ screenshots, ...rest }) => rest))
}))

// POST /api/trades — Stage A: the pre-trade record.
//
// Task 7: this is everything knowable before or at entry. Once saved, these
// fields lock; changing one requires POST /:id/amend, which leaves an audit
// record. That is what makes "the intent was recorded before the outcome" a
// property of the data rather than a promise about the user's habits.
router.post('/', handle(async (req, res) => {
  const input = coerceStageA(req.body)
  // A platform is the one Stage A value with a sensible default, because it is
  // a property of the account rather than a judgement about the trade.
  if (input.brokerPlatform == null) input.brokerPlatform = DEFAULT_BROKER_PLATFORM

  const errors = validateStageA(input)
  if (errors.length) return rejectInvalid(res, errors)

  const accountId = req.body.accountId ?? null
  if (!(await accountAllowed(accountId, req.userId))) {
    return res.status(400).json({ error: 'Invalid account' })
  }

  // The session gate. A trade that breaks the day's plan is refused — unless
  // the request says, explicitly, that the trade was already taken and is
  // being logged as a rule break. Refusing that case outright would not stop
  // the trade (it already happened at the broker); it would only keep it out
  // of the journal, and the trades taken against the plan are precisely the
  // ones the journal most needs to see.
  const gate = await sessionGateFor({
    userId: req.userId,
    accountId: accountId == null ? null : Number(accountId),
    entryTimeUtc: input.entryTimeUtc,
    captureTimezone: input.captureTimezone,
  })
  const acknowledged = req.body.acknowledgeRuleBreak === true
  if (gate.violations.length && !acknowledged) return sessionRulesResponse(res, gate)

  // Task 2: journaledAt is set here, server-side, and never written again.
  // A client-supplied value would defeat the entire point of the field.
  const journaledAt = new Date()
  const draft = {
    ...input,
    screenshots: Array.isArray(req.body.screenshots) ? req.body.screenshots : [],
    accountId: accountId == null ? null : Number(accountId),
    userId: req.userId,
    schemaVersion: SCHEMA_VERSION,
    entryStage: 'pending_exit',
    journaledAt,
    sessionId: gate.session?.id ?? null,
    ruleViolations: gate.violations,
  }

  try {
    const trade = await prisma.$transaction(async (tx) => {
      if (gate.session) {
        if (gate.violations.length === 0) {
          // Conditional, so two simultaneous saves cannot both take the last
          // slot. maxTrades is immutable, so the value read above is safe to
          // compare against.
          const { count } = await tx.tradingSession.updateMany({
            where: { id: gate.session.id, status: 'open', tradesLogged: { lt: gate.session.maxTrades } },
            data: { tradesLogged: { increment: 1 } },
          })
          if (count === 0) throw new TradeCapRace()
        } else {
          await tx.tradingSession.update({
            where: { id: gate.session.id },
            data: { tradesLogged: { increment: 1 } },
          })
        }
      }
      return tx.trade.create({
        data: { ...draft, dataQualityFlags: computeDataQualityFlags(draft) },
      })
    })
    res.status(201).json(serializeTrade(trade))
  } catch (err) {
    if (err instanceof TradeCapRace) {
      return sessionRulesResponse(res, { session: gate.session, violations: ['over_trade_cap'] })
    }
    if (isDuplicatePosition(err)) return duplicatePositionResponse(res, input.brokerPositionId)
    throw err
  }
}))

// GET /api/trades/:id — only if it belongs to this user
router.get('/:id', handle(async (req, res) => {
  const trade = await prisma.trade.findFirst({
    where: { id: Number(req.params.id), userId: req.userId },
  })
  if (!trade) return res.status(404).json({ error: 'Trade not found' })
  res.json(serializeTrade(trade))
}))

// GET /api/trades/:id/amendments — the audit trail for one trade
router.get('/:id/amendments', handle(async (req, res) => {
  const trade = await prisma.trade.findFirst({
    where: { id: Number(req.params.id), userId: req.userId },
    select: { id: true },
  })
  if (!trade) return res.status(404).json({ error: 'Trade not found' })

  const amendments = await prisma.tradeAmendment.findMany({
    where: { tradeId: trade.id },
    orderBy: { amendedAt: 'asc' },
  })
  res.json(amendments)
}))

// POST /api/trades/:id/close — Stage B: the post-trade record.
//
// Separate from Stage A on purpose. Schema alone cannot stop someone filling in
// intent after seeing the outcome; a workflow that takes the outcome through a
// different door can.
router.post('/:id/close', handle(async (req, res) => {
  const existing = await prisma.trade.findFirst({
    where: { id: Number(req.params.id), userId: req.userId },
  })
  if (!existing) return res.status(404).json({ error: 'Trade not found' })

  const input = coerceStageB(req.body)
  const errors = validateStageB(input, existing)
  if (errors.length) return rejectInvalid(res, errors)

  const merged = { ...existing, ...input, entryStage: 'complete' }
  const trade = await prisma.trade.update({
    where: { id: existing.id },
    data: {
      ...input,
      entryStage: 'complete',
      lastEditedAt: new Date(),
      dataQualityFlags: computeDataQualityFlags(merged),
    },
  })
  res.json(serializeTrade(trade))
}))

// PUT /api/trades/:id — edit the unlocked fields only.
//
// Stage B values and the EdgeLedger account tag are freely editable: there is no
// intent to protect in a result. A request that would change a locked Stage A
// field is refused here and pointed at the amend route rather than being
// silently applied or silently dropped.
router.put('/:id', handle(async (req, res) => {
  const existing = await prisma.trade.findFirst({
    where: { id: Number(req.params.id), userId: req.userId },
  })
  if (!existing) return res.status(404).json({ error: 'Trade not found' })

  const attemptedLocked = coerceStageA(req.body)
  const lockedChanges = Object.keys(attemptedLocked)
    .filter(field => fieldChanged(existing[field], attemptedLocked[field]))
  if (lockedChanges.length) {
    return res.status(409).json({
      error: `${lockedChanges.join(', ')} ${lockedChanges.length === 1 ? 'is' : 'are'} locked once the pre-trade entry is saved. Use the amend action, which records what changed and preserves the original values.`,
      lockedFields: lockedChanges,
    })
  }

  const input = coerceStageB(req.body)

  if (Object.prototype.hasOwnProperty.call(req.body, 'accountId')) {
    if (!(await accountAllowed(req.body.accountId, req.userId))) {
      return res.status(400).json({ error: 'Invalid account' })
    }
    const nextAccountId = req.body.accountId == null ? null : Number(req.body.accountId)

    // A trade logged under a session was counted against that account's plan
    // for the day. Moving it would leave the slot spent on one account and the
    // trade appearing on another whose plan never counted it — which is also
    // exactly how a capped account could be quietly topped up.
    if (existing.sessionId != null && nextAccountId !== existing.accountId) {
      return res.status(409).json({
        error: "This trade was counted against its account's session plan, so it stays on that account.",
        lockedFields: ['accountId'],
      })
    }
    input.accountId = nextAccountId
  }

  if (Array.isArray(req.body.screenshots)) {
    input.screenshots = req.body.screenshots
  }

  // Re-validate a closed trade against the Stage B rules, so it cannot be edited
  // into a state it could never have been closed in. An open trade has no result
  // to check yet — it reaches Stage B through /close.
  if (existing.entryStage === 'complete') {
    const errors = validateStageB({ ...existing, ...input }, existing)
    if (errors.length) return rejectInvalid(res, errors)
  }

  const merged = { ...existing, ...input }
  const trade = await prisma.trade.update({
    where: { id: existing.id },
    // Task 2: lastEditedAt moves on every save after the first; journaledAt
    // is not in this payload and never will be.
    data: { ...input, lastEditedAt: new Date(), dataQualityFlags: computeDataQualityFlags(merged) },
  })
  res.json(serializeTrade(trade))
}))

// POST /api/trades/:id/amend — change locked Stage A fields, on the record.
//
// Task 7: the point is not to forbid corrections — a fat-fingered stop is worth
// fixing. The point is that the correction is visible. Every changed field
// writes a TradeAmendment row holding its original value, and the trade is
// stamped amendedAt so the analysis pipeline can filter to trades whose
// recorded intent is provably original.
router.post('/:id/amend', handle(async (req, res) => {
  const existing = await prisma.trade.findFirst({
    where: { id: Number(req.params.id), userId: req.userId },
  })
  if (!existing) return res.status(404).json({ error: 'Trade not found' })

  const changes = coerceStageA(req.body.fields ?? req.body)
  const reason = typeof req.body.reason === 'string' ? req.body.reason.trim() : ''
  if (!reason) {
    return res.status(400).json({
      error: 'An amendment needs a reason — that is the part of the record worth keeping.',
      fieldErrors: [{ field: 'reason', message: 'Reason is required.' }],
    })
  }

  const changedFields = Object.keys(changes)
    .filter(field => fieldChanged(existing[field], changes[field]))
  if (!changedFields.length) {
    return res.status(400).json({ error: 'Nothing to amend — the submitted values match the current ones.' })
  }

  const merged = { ...existing, ...changes }
  const errors = validateAmendment(merged)
  if (errors.length) return rejectInvalid(res, errors)

  const amendedAt = new Date()
  try {
    // One transaction: a trade must never end up amended without its audit
    // rows, or carrying audit rows for a change that did not land.
    const trade = await prisma.$transaction(async (tx) => {
      await tx.tradeAmendment.createMany({
        data: changedFields.map(field => ({
          tradeId: existing.id,
          field,
          oldValue: renderForAudit(existing[field]),
          newValue: renderForAudit(changes[field]),
          reason,
          amendedAt,
        })),
      })
      return tx.trade.update({
        where: { id: existing.id },
        data: {
          ...Object.fromEntries(changedFields.map(f => [f, changes[f]])),
          amendedAt,
          lastEditedAt: amendedAt,
          dataQualityFlags: computeDataQualityFlags({ ...merged, amendedAt }),
        },
      })
    })
    res.json(serializeTrade(trade))
  } catch (err) {
    if (isDuplicatePosition(err)) return duplicatePositionResponse(res, changes.brokerPositionId)
    throw err
  }
}))

// DELETE /api/trades/:id — delete only if owned by this user
router.delete('/:id', handle(async (req, res) => {
  const result = await prisma.trade.deleteMany({
    where: { id: Number(req.params.id), userId: req.userId },
  })
  if (result.count === 0) return res.status(404).json({ error: 'Trade not found' })
  res.status(204).send()
}))

export default router
