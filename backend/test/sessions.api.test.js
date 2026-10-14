// The session gate end to end: real Postgres, real Express app, real
// transactions. The pure rules are pinned down in session.test.js; this file
// is about the things only the database can get wrong — the counter, the
// locks, the race for the last slot, and whether a refusal really wrote
// nothing.
import { test, before, after, describe as rawDescribe } from 'node:test'
import assert from 'node:assert/strict'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-anywhere-real'

const describe = TEST_DATABASE_URL ? rawDescribe : rawDescribe.skip
if (!TEST_DATABASE_URL) {
  console.log('TEST_DATABASE_URL is not set — skipping the session gate tests.')
}

// Every trade here is entered "now", and has to land on the same local date
// as the plan written a moment earlier. Run near midnight in a fixed zone and
// that silently stops being true — so pick the fixed-offset zone where it is
// currently around noon. (POSIX Etc zones invert the sign: Etc/GMT+5 is UTC-5.)
function zoneNearNoon() {
  const n = new Date().getUTCHours() - 12
  return n === 0 ? 'Etc/GMT' : n > 0 ? `Etc/GMT+${n}` : `Etc/GMT-${-n}`
}
const ZONE = zoneNearNoon()

// Two users, because readiness is per person: once one is blocked for the
// day, every account they own is. The blocked-day tests cannot share a user
// with the open-day ones. Emails are unique to this file so the suites, which
// node:test runs in parallel, never touch each other's rows.
const EMAILS = { tired: 'session-tired@example.com', rested: 'session-rested@example.com' }

let server, baseUrl, prisma
const users = {}

before(async () => {
  if (!TEST_DATABASE_URL) return
  const [{ default: app }, { default: client }, { signToken }] = await Promise.all([
    import('../src/app.js'),
    import('../src/prisma/client.js'),
    import('../src/auth/jwt.js'),
  ])
  prisma = client
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } })

  for (const [key, email] of Object.entries(EMAILS)) {
    const user = await prisma.user.create({ data: { email, passwordHash: 'x' } })
    const accounts = {}
    for (const name of ['Lucid 50K', 'Tradeify 50K', 'Race']) {
      accounts[name] = await prisma.account.create({ data: { userId: user.id, name, mode: 'Live' } })
    }
    users[key] = { id: user.id, token: signToken(user.id), accounts }
  }

  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)) })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  if (!TEST_DATABASE_URL) return
  await prisma?.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } })
  await prisma?.$disconnect()
  await new Promise(resolve => server?.close(resolve))
})

function as(who) {
  return async (path, options = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${users[who].token}` },
      body: options.body ? JSON.stringify(options.body) : undefined,
    })
    return { status: res.status, body: res.status === 204 ? null : await res.json() }
  }
}

let positionCounter = 0
const trade = (accountId, overrides = {}) => ({
  accountId,
  brokerPositionId: `SESS-${++positionCounter}-${Date.now()}`,
  brokerAccountId: 'LUC-1',
  brokerPlatform: 'other',
  pair: 'MNQZ6',
  direction: 'long',
  entryTimeUtc: new Date().toISOString(),
  captureTimezone: ZONE,
  entryPrice: 21000,
  stopLoss: 20980,
  takeProfit: 21060,
  lotSize: 1,
  technicalSetup: 'Break & retest',
  emotionalState: 'Calm',
  followedChecklist: true,
  fullPort: false,
  ...overrides,
})

const PLAN = {
  bias: 'long',
  wantToSee: 'NY sweeps the Asia low, then a 5m BOS back above it',
  noTradeIf: 'Price is still chopping inside the Asia range at 10:30',
  scenarios: [
    { if: 'Asia low swept and reclaimed', then: 'Long the retest, stop under the sweep' },
    { if: 'Asia high taken first with no reaction', then: 'Stand aside, no shorts into strength' },
  ],
  maxTrades: 2,
}

const plan = (accountId, overrides = {}) => ({
  accountId, timezone: ZONE, sleepHours: 7.5, fitToTrade: true, ...PLAN, ...overrides,
})

const sessionRow = (id) => prisma.tradingSession.findUnique({ where: { id } })

describe('before the first plan is ever written', () => {
  const api = as('rested')

  test('trades log exactly as they always did — the rules start when adopted', async () => {
    const { status, body } = await api('/trades', { method: 'POST', body: trade(users.rested.accounts['Lucid 50K'].id) })
    assert.equal(status, 201)
    assert.equal(body.sessionId, null)
    assert.deepEqual(body.ruleViolations, [])
  })

  test('today reports no session and an inactive gate', async () => {
    const { status, body } = await api(`/sessions/today?accountId=${users.rested.accounts['Lucid 50K'].id}&timezone=${ZONE}`)
    assert.equal(status, 200)
    assert.equal(body.session, null)
    assert.equal(body.gateActive, false)
    assert.equal(body.minSleepHours, 6)
  })
})

describe('writing the plan', () => {
  const api = as('rested')
  const lucid = () => users.rested.accounts['Lucid 50K'].id

  test('a third trade cannot be planned for — the refusal names the rule', async () => {
    const { status, body } = await api('/sessions', { method: 'POST', body: plan(lucid(), { maxTrades: 3 }) })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'maxTrades')
    assert.match(body.error, /does not go higher/)
  })

  test('an open day needs if/then scenarios', async () => {
    const { status, body } = await api('/sessions', { method: 'POST', body: plan(lucid(), { scenarios: [] }) })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'scenarios')
  })

  test('a plan for a day already gone is refused', async () => {
    const { status, body } = await api('/sessions', { method: 'POST', body: plan(lucid(), { sessionDate: '2020-01-01' }) })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'sessionDate')
  })

  test('a valid plan opens the day with two trades available', async () => {
    const { status, body } = await api('/sessions', { method: 'POST', body: plan(lucid()) })
    assert.equal(status, 201)
    assert.equal(body.status, 'open')
    assert.equal(body.tradesRemaining, 2)
    assert.equal(body.minSleepHoursApplied, 6)
    assert.equal(body.scenarios.length, 2)
    assert.equal(body.account.name, 'Lucid 50K')
  })

  test('the plan is locked once written — a second one for the day is refused', async () => {
    const { status, body } = await api('/sessions', { method: 'POST', body: plan(lucid(), { maxTrades: 1 }) })
    assert.equal(status, 409)
    assert.match(body.error, /locked once written/)
  })
})

describe('the trade gate', () => {
  const api = as('rested')
  const lucid = () => users.rested.accounts['Lucid 50K'].id
  const tradeify = () => users.rested.accounts['Tradeify 50K'].id
  let lucidSession, firstTradeId

  test('trades 1 and 2 log under the plan', async () => {
    const one = await api('/trades', { method: 'POST', body: trade(lucid()) })
    const two = await api('/trades', { method: 'POST', body: trade(lucid()) })
    assert.equal(one.status, 201)
    assert.equal(two.status, 201)
    assert.ok(one.body.sessionId)
    assert.deepEqual(two.body.ruleViolations, [])
    firstTradeId = one.body.id
    lucidSession = one.body.sessionId
    assert.equal((await sessionRow(lucidSession)).tradesLogged, 2)
  })

  test('trade 3 is refused, carries the plan, and writes nothing', async () => {
    const before = await prisma.trade.count({ where: { userId: users.rested.id } })
    const { status, body } = await api('/trades', { method: 'POST', body: trade(lucid()) })
    assert.equal(status, 409)
    assert.equal(body.code, 'SESSION_RULES')
    assert.deepEqual(body.violations.map(v => v.code), ['over_trade_cap'])
    assert.match(body.session.noTradeIf, /chopping inside the Asia range/)
    assert.match(body.error, /log it as a rule break/)
    assert.equal(await prisma.trade.count({ where: { userId: users.rested.id } }), before)
    assert.equal((await sessionRow(lucidSession)).tradesLogged, 2)
  })

  test('a trade already taken can be logged — but only as a recorded rule break', async () => {
    const { status, body } = await api('/trades', { method: 'POST', body: trade(lucid(), { acknowledgeRuleBreak: true }) })
    assert.equal(status, 201)
    assert.deepEqual(body.ruleViolations, ['over_trade_cap'])
    assert.equal(body.sessionId, lucidSession)
    assert.equal((await sessionRow(lucidSession)).tradesLogged, 3)
  })

  test('only a literal true acknowledges — a truthy string does not', async () => {
    const { status } = await api('/trades', { method: 'POST', body: trade(lucid(), { acknowledgeRuleBreak: 'yes' }) })
    assert.equal(status, 409)
  })

  test('deleting a trade does not hand back a slot', async () => {
    const del = await api(`/trades/${firstTradeId}`, { method: 'DELETE' })
    assert.ok(del.status === 204 || del.status === 200)
    const { status, body } = await api('/trades', { method: 'POST', body: trade(lucid()) })
    assert.equal(status, 409)
    assert.deepEqual(body.violations.map(v => v.code), ['over_trade_cap'])
  })

  test('the violations are not writable through edit or amend', async () => {
    const created = await api('/trades', { method: 'POST', body: trade(lucid(), { acknowledgeRuleBreak: true }) })
    const id = created.body.id
    await api(`/trades/${id}`, { method: 'PUT', body: { ruleViolations: [], sessionId: null } })
    await api(`/trades/${id}/amend`, { method: 'POST', body: { ruleViolations: [], reason: 'clean it up' } })
    const row = await prisma.trade.findUnique({ where: { id } })
    assert.deepEqual(row.ruleViolations, ['over_trade_cap'])
    assert.equal(row.sessionId, lucidSession)
  })

  test('a counted trade cannot be moved onto another account', async () => {
    const counted = await prisma.trade.findFirst({ where: { sessionId: lucidSession } })
    const { status, body } = await api(`/trades/${counted.id}`, { method: 'PUT', body: { accountId: tradeify() } })
    assert.equal(status, 409)
    assert.deepEqual(body.lockedFields, ['accountId'])
    assert.equal((await prisma.trade.findUnique({ where: { id: counted.id } })).accountId, lucid())
  })

  test('another account with no plan today is refused', async () => {
    const { status, body } = await api('/trades', { method: 'POST', body: trade(tradeify()) })
    assert.equal(status, 409)
    assert.deepEqual(body.violations.map(v => v.code), ['no_session_plan'])
    assert.equal(body.session, null)
  })

  test('a plan written after the trade is caught', async () => {
    const written = await api('/sessions', { method: 'POST', body: plan(tradeify()) })
    assert.equal(written.status, 201)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { status, body } = await api('/trades', { method: 'POST', body: trade(tradeify(), { entryTimeUtc: thirtyMinutesAgo }) })
    assert.equal(status, 409)
    assert.deepEqual(body.violations.map(v => v.code), ['before_plan'])
  })

  test('two saves racing for the last slot: exactly one wins', async () => {
    const race = users.rested.accounts.Race.id
    const written = await api('/sessions', { method: 'POST', body: plan(race, { maxTrades: 1 }) })
    assert.equal(written.status, 201)
    const results = await Promise.all([
      api('/trades', { method: 'POST', body: trade(race) }),
      api('/trades', { method: 'POST', body: trade(race) }),
      api('/trades', { method: 'POST', body: trade(race) }),
    ])
    const statuses = results.map(r => r.status).sort()
    assert.deepEqual(statuses, [201, 409, 409])
    assert.equal((await sessionRow(written.body.id)).tradesLogged, 1)
    assert.equal(await prisma.trade.count({ where: { sessionId: written.body.id } }), 1)
  })
})

describe('closing the day', () => {
  const api = as('rested')
  const tradeify = () => users.rested.accounts['Tradeify 50K'].id
  let sessionId

  test('the review needs an honest yes or no', async () => {
    sessionId = (await api(`/sessions/today?accountId=${tradeify()}&timezone=${ZONE}`)).body.session.id
    const { status, body } = await api(`/sessions/${sessionId}/close`, { method: 'POST', body: { review: 'fine' } })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'followedPlan')
  })

  test('closing records the review and ends the day', async () => {
    const { status, body } = await api(`/sessions/${sessionId}/close`, {
      method: 'POST', body: { followedPlan: true, review: 'Waited for the sweep. No trade. Good day.' },
    })
    assert.equal(status, 200)
    assert.equal(body.status, 'closed')
    assert.equal(body.followedPlan, true)
    assert.ok(body.closedAt)
    assert.equal(body.canTrade, false)
  })

  test('nothing is taken after the close, and it cannot be closed twice', async () => {
    const after = await api('/trades', { method: 'POST', body: trade(tradeify()) })
    assert.equal(after.status, 409)
    assert.deepEqual(after.body.violations.map(v => v.code), ['after_session_closed'])
    const again = await api(`/sessions/${sessionId}/close`, { method: 'POST', body: { followedPlan: false } })
    assert.equal(again.status, 409)
  })

  test("another user's session is not theirs to close", async () => {
    const { status } = await as('tired')(`/sessions/${sessionId}/close`, { method: 'POST', body: { followedPlan: false } })
    assert.equal(status, 404)
  })
})

describe('a tired day', () => {
  const api = as('tired')
  const lucid = () => users.tired.accounts['Lucid 50K'].id
  const tradeify = () => users.tired.accounts['Tradeify 50K'].id

  test('the trader can set their own floor, within limits', async () => {
    assert.equal((await api('/profile', { method: 'PUT', body: { minSleepHours: 2 } })).status, 400)
    assert.equal((await api('/profile', { method: 'PUT', body: { minSleepHours: 7 } })).status, 200)
    const today = await api(`/sessions/today?accountId=${lucid()}&timezone=${ZONE}`)
    assert.equal(today.body.minSleepHours, 7)
  })

  test('readiness must be answered even to be told no', async () => {
    const { status, body } = await api('/sessions', { method: 'POST', body: { accountId: lucid(), timezone: ZONE, sleepHours: 5 } })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'fitToTrade')
  })

  test('under the floor, the day is blocked — and no plan was asked for', async () => {
    const { status, body } = await api('/sessions', {
      method: 'POST', body: { accountId: lucid(), timezone: ZONE, sleepHours: 6.5, fitToTrade: true },
    })
    assert.equal(status, 201)
    assert.equal(body.status, 'blocked')
    assert.equal(body.minSleepHoursApplied, 7)
    assert.match(body.blockedReasons[0], /Slept 6.5h — the floor is 7h/)
    assert.equal(body.wantToSee, null)
    assert.equal(body.maxTrades, null)
    assert.equal(body.canTrade, false)
  })

  test('the no stands on every account — asking again elsewhere does not help', async () => {
    const { status, body } = await api('/sessions', { method: 'POST', body: plan(tradeify(), { sleepHours: 9 }) })
    assert.equal(status, 201)
    assert.equal(body.status, 'blocked')
    assert.match(body.blockedReasons.join(' '), /Lucid 50K/)
    assert.equal(body.wantToSee, null, 'a blocked day stores no plan even if one was sent')
  })

  test('a blocked day refuses trades', async () => {
    const { status, body } = await api('/trades', { method: 'POST', body: trade(lucid()) })
    assert.equal(status, 409)
    assert.deepEqual(body.violations.map(v => v.code), ['trading_while_blocked'])
    assert.ok(body.session.blockedReasons.length)
  })

  test('an account with no plan is refused for the real reason: it is a no-trade day', async () => {
    const { status, body } = await api('/trades', { method: 'POST', body: trade(users.tired.accounts.Race.id) })
    assert.equal(status, 409)
    assert.deepEqual(body.violations.map(v => v.code), ['trading_while_blocked'])
  })

  test('a blocked day cannot be closed into looking like a traded one', async () => {
    const id = (await api(`/sessions/today?accountId=${lucid()}&timezone=${ZONE}`)).body.session.id
    const { status } = await api(`/sessions/${id}/close`, { method: 'POST', body: { followedPlan: true } })
    assert.equal(status, 409)
  })

  test('the history lists both days, newest first, with their accounts', async () => {
    const { status, body } = await api('/sessions')
    assert.equal(status, 200)
    assert.equal(body.length, 2)
    assert.ok(body.every(s => s.status === 'blocked' && s.account?.name))
  })
})
