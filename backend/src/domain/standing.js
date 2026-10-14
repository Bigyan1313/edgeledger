// How far an account is from being lost, by the firm's own rules.
//
// This is the number to have in front of you at entry. The two-trade cap
// limits how often you can be wrong; this limits how much — and on a funded
// account, one oversized loss ends it as surely as five small ones.
//
// Everything is computed from the journal: the starting balance plus the P&L
// of closed trades. That is only as accurate as the journal, and the honest
// gaps are reported alongside the numbers rather than papered over:
// - P&L is whatever the trade carries — usually before commissions, which the
//   firm deducts.
// - An intraday trailing floor follows open profit the journal never sees, so
//   the real floor can be higher than the one computed here.

import { localDate } from './session.js'
import { computeRiskDollars } from './derived.js'

export const DRAWDOWN_TYPES = ['static', 'eod_trailing', 'intraday_trailing']

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const round2 = (v) => Math.round(v * 100) / 100
const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

// --- the rules ---------------------------------------------------------------------

export const RULE_FIELDS = ['startingBalance', 'dailyLossLimit', 'maxDrawdown', 'drawdownType', 'drawdownLockBalance']

export function coerceAccountRules(body) {
  const out = {}
  for (const field of RULE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    const v = body[field]
    if (blank(v)) out[field] = null
    else out[field] = field === 'drawdownType' ? String(v).trim() : Number(v)
  }
  return out
}

// `merged` is the account as it would be after the change, so a pair rule
// (size and type together) is judged on the result, not on the request alone.
export function validateAccountRules(merged) {
  const errors = []
  const add = (field, message) => errors.push({ field, message })
  const positive = (field, label) => {
    const v = merged[field]
    if (v === null || v === undefined) return
    if (!isNum(v) || v <= 0) add(field, `${label} must be a positive dollar amount.`)
  }

  positive('startingBalance', 'Starting balance')
  positive('dailyLossLimit', 'Daily loss limit')
  positive('maxDrawdown', 'Max drawdown')
  positive('drawdownLockBalance', 'Trail lock balance')

  const hasSize = merged.maxDrawdown != null
  const hasType = merged.drawdownType != null
  if (hasType && !DRAWDOWN_TYPES.includes(merged.drawdownType)) {
    add('drawdownType', 'Drawdown type must be static, end-of-day trailing, or intraday trailing.')
  } else if (hasSize !== hasType) {
    add(hasSize ? 'drawdownType' : 'maxDrawdown', 'A drawdown needs both a size and a type.')
  }

  if (merged.drawdownLockBalance != null && merged.drawdownType === 'static') {
    add('drawdownLockBalance', 'A static drawdown does not trail, so it has nothing to lock.')
  }
  return errors
}

// --- the standing --------------------------------------------------------------------

// `trades` are the account's trades, any stage. `now` and `timeZone` decide
// which closed trades count toward "today" — the market's day, not the
// trader's, since that is the day the firm's daily limit follows.
export function computeStanding({ account, trades, now, timeZone, plannedRisk = null }) {
  const notes = []
  const start = account.startingBalance
  if (!isNum(start)) {
    return { configured: false, missing: ['startingBalance'], notes }
  }

  const closed = trades
    .filter(t => isNum(t.pnl) && t.entryStage !== 'pending_exit')
    .map(t => ({ at: new Date(t.exitTimeUtc ?? t.entryTimeUtc), pnl: t.pnl }))
    .sort((a, b) => a.at - b.at)

  const today = localDate(now, timeZone)
  let balance = start
  let todayPnl = 0
  let peakIntraday = start
  const eodBalance = new Map()
  for (const c of closed) {
    balance += c.pnl
    peakIntraday = Math.max(peakIntraday, balance)
    const day = localDate(c.at, timeZone)
    eodBalance.set(day, balance) // trades are sorted, so the last write is the day's close
    if (day === today) todayPnl += c.pnl
  }

  // An end-of-day trail only moves on days that have finished.
  let peakEod = start
  for (const [day, b] of eodBalance) if (day < today) peakEod = Math.max(peakEod, b)

  let floor = null
  if (isNum(account.maxDrawdown) && DRAWDOWN_TYPES.includes(account.drawdownType)) {
    const reference = account.drawdownType === 'static' ? start
      : account.drawdownType === 'eod_trailing' ? peakEod
      : peakIntraday
    floor = reference - account.maxDrawdown
    if (account.drawdownType !== 'static' && isNum(account.drawdownLockBalance)) {
      floor = Math.min(floor, account.drawdownLockBalance)
    }
    if (account.drawdownType === 'intraday_trailing') {
      notes.push('Intraday trailing is estimated from closed trades. The firm also trails open profit, which the journal never sees — the real floor may be higher.')
    }
  }

  const distanceToFloor = floor == null ? null : balance - floor
  const dailyRemaining = isNum(account.dailyLossLimit) ? account.dailyLossLimit + todayPnl : null

  // The binding limit is whichever is closer.
  const limits = [
    distanceToFloor != null && { kind: 'drawdown', room: distanceToFloor },
    dailyRemaining != null && { kind: 'daily', room: dailyRemaining },
  ].filter(Boolean)
  const binding = limits.length ? limits.reduce((a, b) => (b.room < a.room ? b : a)) : null

  const open = trades.filter(t => t.entryStage === 'pending_exit')
  const openRisks = open.map(computeRiskDollars)
  const openRisk = openRisks.filter(isNum).reduce((a, b) => a + b, 0)
  const openRiskUnknown = openRisks.filter(r => !isNum(r)).length
  if (openRiskUnknown) {
    notes.push(`${openRiskUnknown} open trade${openRiskUnknown === 1 ? ' has' : 's have'} no computable risk — the room after stops does not include ${openRiskUnknown === 1 ? 'it' : 'them'}.`)
  }

  const room = binding ? binding.room : null
  const roomIfStopsHit = room == null ? null : room - openRisk
  const roomAfterPlanned = roomIfStopsHit == null || !isNum(plannedRisk) ? null : roomIfStopsHit - plannedRisk

  let status = 'ok'
  if (room == null) status = 'no_rules'
  else if (room <= 0) status = 'breached'
  else if (roomIfStopsHit <= 0 || (roomAfterPlanned != null && roomAfterPlanned <= 0)) status = 'danger'

  notes.push('P&L is the journal\'s, usually before commissions — the firm counts after.')

  const r = (v) => (v == null ? null : round2(v))
  return {
    configured: true,
    status,
    balance: r(balance),
    floor: r(floor),
    distanceToFloor: r(distanceToFloor),
    todayPnl: r(todayPnl),
    dailyLossLimit: account.dailyLossLimit ?? null,
    dailyRemaining: r(dailyRemaining),
    binding: binding?.kind ?? null,
    room: r(room),
    openRisk: r(openRisk),
    openRiskUnknown,
    roomIfStopsHit: r(roomIfStopsHit),
    plannedRisk: r(plannedRisk),
    roomAfterPlanned: r(roomAfterPlanned),
    today,
    notes,
  }
}
