import prisma from '../prisma/client.js'
import { localDate, resolveTimezone, evaluateTrade, describeViolations, serializeSession } from '../domain/session.js'

// Finds the session a new trade belongs to and works out which rules logging
// it would break. The rules themselves live in evaluateTrade; this only
// gathers what they need from the database.
//
// The trade's day is read in the zone it was captured in, falling back to the
// profile's — the same clock the trader was looking at when they took it.
export async function sessionGateFor({ userId, accountId, entryTimeUtc, captureTimezone }) {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { timezone: true } })
  const timezone = resolveTimezone(captureTimezone, profile?.timezone)
  const sessionDate = localDate(new Date(entryTimeUtc), timezone)

  const [session, anyEarlier] = await Promise.all([
    prisma.tradingSession.findFirst({ where: { userId, accountId: accountId ?? null, sessionDate } }),
    prisma.tradingSession.findFirst({ where: { userId, sessionDate: { lte: sessionDate } }, select: { id: true } }),
  ])

  const violations = evaluateTrade({ gateActive: Boolean(anyEarlier), session, entryTimeUtc })
  return { session, sessionDate, violations }
}

// The refusal. It says what was broken, and carries the plan the trader wrote
// while calm — the no-trade condition in their own words is the most useful
// thing to put in front of them at this moment.
export function sessionRulesResponse(res, { session, violations }) {
  const described = describeViolations(violations)
  return res.status(409).json({
    error: `Not logged: ${described.map(v => v.message).join(' ')} If you already took this trade, log it as a rule break — it will be recorded as one.`,
    code: 'SESSION_RULES',
    violations: described,
    session: serializeSession(session),
  })
}

// Thrown inside the create transaction when the cap was reached between the
// check and the write — two tabs, or a double-click.
export class TradeCapRace extends Error {}
