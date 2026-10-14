// Trading sessions: the plan written before the first trade, and the rules a
// trade is checked against when it is logged.
//
// The failure this exists to catch is specific. Evaluations pass; funded
// accounts are lost on their first or second day. That is not a strategy
// problem — the evaluations prove the strategy — it is what happens when the
// stakes change and there is nothing between the impulse and the order. So the
// rules here are deliberately blunt: a number of hours, a yes/no, a ceiling of
// two. Anything that needs judgement at 9:29 will be judged in favour of
// trading.
//
// What this cannot do is stop an order at the broker. It gates the journal,
// and the journal is where the trade is planned (Stage A) — so the gate sits
// at the moment of decision for anyone using the workflow. A trade taken
// around it can still be logged, but only by saying so explicitly, and the
// broken rule is then stored on the trade permanently.

import { isValidTimezone } from './profile.js'
import { validateCharts } from './charts.js'

// "Max 2 trades an account, no matter what." Lowering it is allowed; raising
// it is not, in the API or in the database (a CHECK constraint backs this).
export const MAX_TRADES_CEILING = 2

// Used when the trader has not set their own floor. Each session records the
// floor it was actually judged against, so changing this later does not
// rewrite what an old day meant.
export const DEFAULT_MIN_SLEEP_HOURS = 6

export const BIASES = ['long', 'short', 'neutral']

// The market session a plan is for. A label on the day's one plan, not a
// separate plan with its own cap: three sessions with two trades each would
// be six trades, and the limit is two per account per day.
export const MARKET_SESSIONS = ['asia', 'london', 'new_york']
export const MAX_SCENARIOS = 5

// Long enough that "x" or "idk" does not count as a plan; short enough that a
// real one-line condition ("15m BOS above Asia high") clears it.
export const MIN_PLAN_TEXT = 10
const MAX_PLAN_TEXT = 1000
const MAX_SCENARIO_TEXT = 300
const MAX_REVIEW_TEXT = 2000

// A manually typed entry time is usually rounded to the minute, and a plan
// saved at 9:25:40 should not make a 9:25 entry look like it came first.
export const BEFORE_PLAN_TOLERANCE_MS = 2 * 60 * 1000

// Every way a trade can be logged against the rules. The messages are what
// the trader reads at the moment the journal refuses — so they say what
// happened, not what to feel about it.
export const VIOLATIONS = {
  no_session_plan: 'No session plan was written for this account today.',
  trading_while_blocked: 'Today was recorded as a no-trade day by the readiness check.',
  after_session_closed: "Today's session was already closed out.",
  over_trade_cap: "This exceeds the plan's trade limit for the day.",
  before_plan: 'This trade was entered before the session plan was written.',
}

const blank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')
const text = (v) => (typeof v === 'string' ? v.trim() : '')

// The calendar date of an instant in a zone, as YYYY-MM-DD. en-CA formats
// dates in exactly that order, which saves assembling it from parts.
export function localDate(instant, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant)
}

// The day after a YYYY-MM-DD, computed on the date itself rather than by
// adding 24 hours to an instant — which is wrong twice a year.
export function nextDate(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// The zone a request should be read in: the profile's pinned zone if there is
// one, then what the browser reported, then UTC. Anything unrecognisable
// falls through rather than throwing inside Intl later.
export function resolveTimezone(...candidates) {
  for (const tz of candidates) {
    if (!blank(tz) && isValidTimezone(tz)) return String(tz).trim()
  }
  return 'UTC'
}

export function effectiveMinSleep(profile) {
  const v = profile?.minSleepHours
  return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_MIN_SLEEP_HOURS
}

// --- readiness ---------------------------------------------------------------

// Pure: the same answers always get the same verdict. A blocked day elsewhere
// is passed in, because readiness belongs to the person rather than the
// account — four hours of sleep on one account is four hours on all of them,
// and a "no" on one account must not be dodged by asking again on another.
export function readinessVerdict({ sleepHours, fitToTrade }, minSleepHours, { blockedElsewhere = null } = {}) {
  const reasons = []
  if (sleepHours < minSleepHours) {
    reasons.push(`Slept ${sleepHours}h — the floor is ${minSleepHours}h.`)
  }
  if (fitToTrade !== true) {
    reasons.push('You said you are not fit to trade today.')
  }
  if (blockedElsewhere) {
    reasons.push(`Already recorded as a no-trade day on ${blockedElsewhere}.`)
  }
  return { status: reasons.length ? 'blocked' : 'open', reasons }
}

export function validateReadiness(input) {
  const errors = []
  const add = (field, message) => errors.push({ field, message })

  if (blank(input.sleepHours)) {
    add('sleepHours', 'How many hours did you sleep? This is required.')
  } else {
    const h = Number(input.sleepHours)
    if (!Number.isFinite(h) || h < 0 || h > 24) add('sleepHours', 'Sleep must be between 0 and 24 hours.')
  }

  // Explicitly answered, not merely "not ticked". A missing answer and a "no"
  // are different, and only one of them was a decision.
  if (typeof input.fitToTrade !== 'boolean') {
    add('fitToTrade', 'Answer whether you are fit to trade today — yes or no.')
  }
  return errors
}

// --- the plan ------------------------------------------------------------------

export function validatePlan(input) {
  const errors = []
  const add = (field, message) => errors.push({ field, message })

  if (!MARKET_SESSIONS.includes(input.marketSession)) {
    add('marketSession', 'Which session is this plan for — Asia, London or New York?')
  }

  if (!blank(input.bias) && !BIASES.includes(input.bias)) {
    add('bias', `Bias must be one of: ${BIASES.join(', ')}.`)
  }

  errors.push(...validateCharts(input.screenshots ?? []))

  const wantToSee = text(input.wantToSee)
  if (wantToSee.length < MIN_PLAN_TEXT) {
    add('wantToSee', `Write what has to appear before you take a trade — at least ${MIN_PLAN_TEXT} characters.`)
  } else if (wantToSee.length > MAX_PLAN_TEXT) {
    add('wantToSee', `Keep it under ${MAX_PLAN_TEXT} characters.`)
  }

  const noTradeIf = text(input.noTradeIf)
  if (noTradeIf.length < MIN_PLAN_TEXT) {
    add('noTradeIf', `Write the condition that means no trade today — at least ${MIN_PLAN_TEXT} characters.`)
  } else if (noTradeIf.length > MAX_PLAN_TEXT) {
    add('noTradeIf', `Keep it under ${MAX_PLAN_TEXT} characters.`)
  }

  const scenarios = input.scenarios
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    add('scenarios', 'Write at least one if/then scenario.')
  } else if (scenarios.length > MAX_SCENARIOS) {
    add('scenarios', `At most ${MAX_SCENARIOS} scenarios. A plan with more branches than that is not a plan.`)
  } else {
    scenarios.forEach((sc, i) => {
      const ifText = text(sc?.if)
      const thenText = text(sc?.then)
      if (!ifText || !thenText) {
        add(`scenarios.${i}`, `Scenario ${i + 1} needs both an "if" and a "then".`)
      } else if (ifText.length > MAX_SCENARIO_TEXT || thenText.length > MAX_SCENARIO_TEXT) {
        add(`scenarios.${i}`, `Scenario ${i + 1} is too long — keep each side under ${MAX_SCENARIO_TEXT} characters.`)
      }
    })
  }

  const max = Number(input.maxTrades)
  if (blank(input.maxTrades) || !Number.isInteger(max)) {
    add('maxTrades', `Set the most trades you will take today: 1 or ${MAX_TRADES_CEILING}.`)
  } else if (max > MAX_TRADES_CEILING) {
    add('maxTrades', `The limit is ${MAX_TRADES_CEILING} trades per account per day. It does not go higher.`)
  } else if (max < 1) {
    add('maxTrades', 'At least 1. A day with no trades planned is a day off — do not open a session.')
  }

  return errors
}

export function coercePlan(body) {
  return {
    marketSession: blank(body.marketSession) ? null : String(body.marketSession).trim(),
    screenshots: Array.isArray(body.screenshots) ? body.screenshots : [],
    bias: blank(body.bias) ? null : String(body.bias).trim(),
    wantToSee: text(body.wantToSee),
    noTradeIf: text(body.noTradeIf),
    scenarios: Array.isArray(body.scenarios)
      ? body.scenarios.map(sc => ({ if: text(sc?.if), then: text(sc?.then) }))
      : body.scenarios,
    maxTrades: blank(body.maxTrades) ? null : Number(body.maxTrades),
  }
}

export function coerceReadiness(body) {
  return {
    sleepHours: blank(body.sleepHours) ? null : Number(body.sleepHours),
    fitToTrade: body.fitToTrade,
  }
}

// --- the post-session review ---------------------------------------------------

export function validateClose(input) {
  const errors = []
  if (typeof input.followedPlan !== 'boolean') {
    errors.push({ field: 'followedPlan', message: 'Did you follow the plan today? Yes or no.' })
  }
  if (!blank(input.review) && String(input.review).trim().length > MAX_REVIEW_TEXT) {
    errors.push({ field: 'review', message: `Keep the review under ${MAX_REVIEW_TEXT} characters.` })
  }
  return errors
}

// --- the gate --------------------------------------------------------------------

// Which rules a trade breaks if it is logged now. Pure, so the whole policy is
// testable without a database.
//
// `gateActive` is false until the trader writes their first plan: the rules
// start when they are adopted, so a journal full of trades from before this
// existed is not retroactively marked as rule-breaking.
//
// `blockedElsewhere` matters for an account with no plan of its own: if the
// trader was ruled out on another account today, the honest reason this trade
// is refused is that it is a no-trade day — not merely that a plan is missing.
export function evaluateTrade({ gateActive, session, entryTimeUtc, blockedElsewhere = false }) {
  if (!gateActive) return []
  if (!session) return blockedElsewhere ? ['trading_while_blocked'] : ['no_session_plan']
  if (session.status === 'blocked') return ['trading_while_blocked']
  if (session.status === 'closed') return ['after_session_closed']

  const violations = []
  if (session.tradesLogged >= session.maxTrades) violations.push('over_trade_cap')

  const entry = new Date(entryTimeUtc).getTime()
  const opened = new Date(session.openedAt).getTime()
  if (Number.isFinite(entry) && entry < opened - BEFORE_PLAN_TOLERANCE_MS) violations.push('before_plan')

  return violations
}

export function describeViolations(codes) {
  return codes.map(code => ({ code, message: VIOLATIONS[code] ?? code }))
}

// What the client needs to render a session, beyond its columns. Lists pass
// summary: true and get a count instead of the images.
export function serializeSession(session, { summary = false } = {}) {
  if (!session) return null
  if (summary) {
    const { screenshots, ...rest } = session
    return serializeSession({ ...rest, screenshotCount: screenshots?.length ?? 0 })
  }
  const tradesRemaining = session.status === 'open'
    ? Math.max(0, session.maxTrades - session.tradesLogged)
    : 0
  return {
    ...session,
    screenshotCount: session.screenshotCount ?? session.screenshots?.length ?? 0,
    tradesRemaining,
    canTrade: tradesRemaining > 0,
  }
}
