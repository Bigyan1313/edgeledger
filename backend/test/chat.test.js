// Edge, the in-app assistant. No real API call is made: a stand-in client
// records exactly what would have been sent, so these check the brief the
// model would see — that it carries today's plan and limits, that it is
// placed after the cached prompt, and that it never contains another user's
// journal.
import { test, before, after, describe as rawDescribe } from 'node:test'
import assert from 'node:assert/strict'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DATABASE_URL = TEST_DATABASE_URL || 'postgresql://unused@localhost:5432/unused'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-anywhere-real'

const { formatCoachContext } = await import('../src/domain/coachContext.js')

const NOW = new Date('2026-10-14T15:00:00Z')
const base = {
  now: NOW, timezone: 'America/New_York', today: '2026-10-14', profile: { displayName: 'B' },
  sessions: [], standings: [], trades: [], reviews: [],
  reviewWindow: { state: 'not_yet', opensAt: new Date('2026-10-14T16:30:00Z'), writtenToday: false },
}

rawDescribe('the brief', () => {
  test('with nothing written today, it says a trade would be refused', () => {
    assert.match(formatCoachContext(base), /No plan written today/)
  })

  test('an open plan shows trades left and the no-trade condition verbatim', () => {
    const text = formatCoachContext({
      ...base,
      sessions: [{
        status: 'open', account: { name: 'Lucid 50K' }, maxTrades: 2, tradesLogged: 1, sleepHours: 7.5, minSleepHoursApplied: 6,
        bias: 'long', wantToSee: 'Sweep of the Asia low, then a 5m BOS', noTradeIf: 'Still chopping inside Asia at 10:30',
        scenarios: [{ if: 'Asia low swept', then: 'Long the retest' }], blockedReasons: [],
      }],
    })
    assert.match(text, /Lucid 50K: open\. Trades used 1 of 2; 1 left\./)
    assert.match(text, /NO TRADE IF: Still chopping inside Asia at 10:30/)
    assert.match(text, /If Asia low swept → then Long the retest/)
  })

  test('a no-trade day and an over-limit day are stated in capitals, not left to inference', () => {
    const text = formatCoachContext({
      ...base,
      sessions: [
        { status: 'blocked', account: { name: 'Tradeify' }, blockedReasons: ['Slept 4h — the floor is 6h.'] },
        { status: 'open', account: { name: 'Lucid' }, maxTrades: 2, tradesLogged: 3, sleepHours: 8, minSleepHoursApplied: 6, wantToSee: 'x', noTradeIf: 'y', scenarios: [], blockedReasons: [] },
      ],
    })
    assert.match(text, /Tradeify: NO-TRADE DAY/)
    assert.match(text, /OVER THE LIMIT/)
  })

  test('account room is given in dollars with the binding limit', () => {
    const text = formatCoachContext({
      ...base,
      standings: [{ name: 'Lucid 50K', standing: {
        configured: true, status: 'danger', balance: 49700, dailyRemaining: 120, todayPnl: -880,
        distanceToFloor: 1700, floor: 48000, binding: 'daily', openRisk: 80, roomIfStopsHit: 40,
      } }],
    })
    assert.match(text, /daily loss room \$120\.00 \(today -\$880\.00\)/)
    assert.match(text, /binding limit: daily/)
    assert.match(text, /room if all stops hit \$40\.00/)
    assert.match(text, /Status: DANGER/)
  })

  test('rule breaks on recent trades are named', () => {
    const text = formatCoachContext({
      ...base,
      trades: [{ entryTimeUtc: NOW.toISOString(), pair: 'MNQZ6', direction: 'short', lotSize: 5, riskDollars: 485, entryStage: 'complete', outcome: 'Loss', pnl: -485, rMultiple: -1, ruleViolations: ['over_trade_cap'], emotionalState: 'Revenge', followedChecklist: false }],
    })
    assert.match(text, /RULE BREAK: over_trade_cap/)
    assert.match(text, /Checklist NOT followed/)
    assert.match(text, /risk \$485\.00/)
  })

  test('long free text is clipped, so one essay cannot crowd out the rest', () => {
    const text = formatCoachContext({
      ...base,
      sessions: [{ status: 'open', account: { name: 'A' }, maxTrades: 1, tradesLogged: 0, sleepHours: 8, minSleepHoursApplied: 6, wantToSee: 'x'.repeat(5000), noTradeIf: 'y', scenarios: [], blockedReasons: [] }],
    })
    assert.ok(text.length < 1500)
  })
})

const describe = TEST_DATABASE_URL ? rawDescribe : rawDescribe.skip
if (!TEST_DATABASE_URL) console.log('TEST_DATABASE_URL is not set — skipping the assistant route tests.')

const EMAILS = { me: 'chat-me@example.com', other: 'chat-other@example.com' }
let server, baseUrl, prisma, sent
const users = {}

// Stands in for the Anthropic client: records the request, streams two chunks.
const stub = {
  messages: {
    stream(params) {
      sent = params
      return (async function* () {
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'One trade ' } }
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'left.' } }
      })()
    },
  },
}

before(async () => {
  if (!TEST_DATABASE_URL) return
  const [{ default: express }, { createChatRouter }, { default: client }, { signToken }, { requireAuth }, { localDate }] = await Promise.all([
    import('express'), import('../src/routes/chat.js'), import('../src/prisma/client.js'),
    import('../src/auth/jwt.js'), import('../src/auth/middleware.js'), import('../src/domain/session.js'),
  ])
  prisma = client
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } })
  const today = localDate(new Date(), 'America/New_York')
  for (const [key, email] of Object.entries(EMAILS)) {
    const user = await prisma.user.create({ data: { email, passwordHash: 'x' } })
    const account = await prisma.account.create({ data: { userId: user.id, name: `${key}-account`, mode: 'Live', startingBalance: 50000, dailyLossLimit: 1000 } })
    await prisma.tradingSession.create({ data: {
      userId: user.id, accountId: account.id, sessionDate: today, timezone: 'America/New_York',
      sleepHours: 8, fitToTrade: true, minSleepHoursApplied: 6, status: 'open', maxTrades: 2, tradesLogged: 1,
      wantToSee: `${key}: sweep of the Asia low`, noTradeIf: `${key}-secret-condition`, scenarios: [{ if: 'a', then: 'b' }],
    } })
    users[key] = { id: user.id, token: signToken(user.id) }
  }

  const app = express()
  app.use(express.json())
  app.use('/api/chat', requireAuth, createChatRouter({ client: stub, prisma }))
  app.use('/api/chat-off', requireAuth, createChatRouter({ client: null, prisma }))
  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)) })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  if (!TEST_DATABASE_URL) return
  await prisma?.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } })
  await prisma?.$disconnect()
  await new Promise(resolve => server?.close(resolve))
})

const post = async (path, body, who = 'me') => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, text: await res.text() }
}

describe('the assistant route', () => {
  test('without an API key it says so instead of failing oddly', async () => {
    const { status, text } = await post('/chat-off', { messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(status, 503)
    assert.match(text, /not configured/)
  })

  test('a reply streams back as plain text', async () => {
    const { status, text } = await post('/chat', { messages: [{ role: 'user', content: 'Can I take another trade?' }] })
    assert.equal(status, 200)
    assert.equal(text, 'One trade left.')
  })

  test('the brief comes after the cached prompt, and carries this trader\'s plan', () => {
    assert.equal(sent.system.length, 2)
    assert.deepEqual(sent.system[0].cache_control, { type: 'ephemeral' })
    assert.equal(sent.system[1].cache_control, undefined)
    assert.match(sent.system[1].text, /^<journal>/)
    assert.match(sent.system[1].text, /NO TRADE IF: me-secret-condition/)
    assert.match(sent.system[1].text, /Trades used 1 of 2; 1 left/)
    assert.match(sent.system[1].text, /daily loss room \$1000\.00/)
  })

  test("another trader's journal never reaches the prompt", () => {
    assert.doesNotMatch(sent.system[1].text, /other-secret-condition/)
    assert.doesNotMatch(sent.system[1].text, /other-account/)
  })

  test('the conversation sent starts with the trader and ends with their question', async () => {
    await post('/chat', { messages: [
      { role: 'assistant', content: 'Hi, I am Edge.' },
      { role: 'user', content: 'Where do I stand?' },
    ] })
    assert.equal(sent.messages[0].role, 'user')
    assert.equal(sent.messages.at(-1).content, 'Where do I stand?')
  })

  test('a malformed conversation is refused', async () => {
    assert.equal((await post('/chat', { messages: [] })).status, 400)
    assert.equal((await post('/chat', { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] })).status, 400)
  })
})
