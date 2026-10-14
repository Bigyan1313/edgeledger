// The price action review end to end: real Postgres, real app, real clock.
//
// The window depends on the time of day, and the server reads the real one.
// Rather than fake the clock, each run picks a fixed-offset zone where it is
// currently a weekday mid-day, and sets the market open relative to "now"
// there — so the window is genuinely open, or genuinely not yet, whenever the
// suite happens to run. (POSIX Etc zones invert the sign: Etc/GMT-5 is UTC+5.)
import { test, before, after, describe as rawDescribe } from 'node:test'
import assert from 'node:assert/strict'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-anywhere-real'

function localNow(timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(new Date()).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday }
}

function pickZone() {
  for (let k = 14; k >= -12; k--) {
    const zone = k === 0 ? 'Etc/GMT' : k > 0 ? `Etc/GMT-${k}` : `Etc/GMT+${-k}`
    const now = localNow(zone)
    if (!['Sat', 'Sun'].includes(now.weekday) && now.minutes >= 5 * 60 && now.minutes <= 21 * 60) return { zone, ...now }
  }
  return null
}

const hhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

const PICK = pickZone()
const describe = TEST_DATABASE_URL && PICK ? rawDescribe : rawDescribe.skip
if (!TEST_DATABASE_URL) console.log('TEST_DATABASE_URL is not set — skipping the review API tests.')
else if (!PICK) console.log('No fixed-offset zone is on a weekday mid-day right now — skipping the review API tests.')

const ZONE = PICK?.zone
const TODAY = PICK?.date
const EMAILS = { me: 'review-me@example.com', other: 'review-other@example.com' }

let server, baseUrl, prisma
const users = {}

before(async () => {
  if (!TEST_DATABASE_URL || !PICK) return
  const [{ default: app }, { default: client }, { signToken }] = await Promise.all([
    import('../src/app.js'), import('../src/prisma/client.js'), import('../src/auth/jwt.js'),
  ])
  prisma = client
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } })
  for (const [key, email] of Object.entries(EMAILS)) {
    const user = await prisma.user.create({ data: { email, passwordHash: 'x' } })
    const account = await prisma.account.create({ data: { userId: user.id, name: 'Lucid 50K', mode: 'Live' } })
    users[key] = { id: user.id, token: signToken(user.id), account }
  }
  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)) })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  if (!TEST_DATABASE_URL || !PICK) return
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

// The open set so the window opened 30 minutes ago, or opens an hour from now.
const openWindow = () => ({ marketTimezone: ZONE, marketOpenTime: hhmm(localNow(ZONE).minutes - 210) })
const notYet = () => ({ marketTimezone: ZONE, marketOpenTime: hhmm(localNow(ZONE).minutes - 120) })

const REVIEW = {
  symbol: 'MNQZ6',
  dayType: 'reversal',
  summary: 'Swept the Asia low on the open, reclaimed it by 10:05, trended to PDH.',
  keyLevels: 'Asia low, PDH',
  liquidityTaken: 'sell_side',
  validSetup: true,
  lesson: 'The retest came 20 minutes after the sweep.',
}

describe('the market settings', () => {
  const api = as('me')
  test('an open time that leaves no window before midnight is refused', async () => {
    const { status, body } = await api('/profile', { method: 'PUT', body: { marketOpenTime: '21:30' } })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'marketOpenTime')
  })
  test('an ambiguous zone abbreviation is refused', async () => {
    const { status, body } = await api('/profile', { method: 'PUT', body: { marketTimezone: 'EST' } })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'marketTimezone')
  })
})

describe('before the window opens', () => {
  const api = as('me')
  test('today says not yet, and when', async () => {
    assert.equal((await api('/profile', { method: 'PUT', body: notYet() })).status, 200)
    const { body } = await api('/reviews/today')
    assert.equal(body.window.state, 'not_yet')
    assert.equal(body.window.reviewDate, TODAY)
    assert.equal(body.recentDays[0].status, 'pending')
    assert.equal(body.recentDays.length, 10)
  })

  test('writing it is refused, and nothing is stored', async () => {
    const { status, body } = await api('/reviews', { method: 'POST', body: REVIEW })
    assert.equal(status, 409)
    assert.equal(body.code, 'REVIEW_WINDOW')
    assert.match(body.error, /three hours after the open/)
    assert.equal(await prisma.priceActionReview.count({ where: { userId: users.me.id } }), 0)
  })
})

describe('once the window is open', () => {
  const api = as('me')
  let firstId

  test('today says the review is due', async () => {
    await api('/profile', { method: 'PUT', body: openWindow() })
    const { body } = await api('/reviews/today')
    assert.equal(body.window.state, 'open')
    assert.equal(body.planExists, false)
    assert.equal(body.recentDays[0].status, 'due')
  })

  test('with no plan today, a comparison is neither asked for nor stored', async () => {
    const { status, body } = await api('/reviews', { method: 'POST', body: { ...REVIEW, planPlayedOut: 'yes', reviewDate: '2020-01-01' } })
    assert.equal(status, 201)
    assert.equal(body.planPlayedOut, null)
    // The day is the server's: a date sent by the client is ignored.
    assert.equal(body.reviewDate, TODAY)
    assert.equal(body.marketTimezone, ZONE)
    assert.ok(body.writtenAt)
    firstId = body.id
  })

  test('one review per symbol per day', async () => {
    const { status, body } = await api('/reviews', { method: 'POST', body: REVIEW })
    assert.equal(status, 409)
    assert.match(body.error, /already written/)
  })

  test('once a plan exists, the next review must say whether it played out', async () => {
    const plan = await as('me')('/sessions', {
      method: 'POST',
      body: {
        accountId: users.me.account.id, timezone: ZONE, sleepHours: 8, fitToTrade: true,
        wantToSee: 'NY sweeps the Asia low, then a 5m BOS back above it',
        noTradeIf: 'Still inside the Asia range at 10:30',
        scenarios: [{ if: 'Asia low swept and reclaimed', then: 'Long the retest' }],
        maxTrades: 2,
      },
    })
    assert.equal(plan.status, 201)

    const today = await api('/reviews/today')
    assert.equal(today.body.planExists, true)
    assert.match(today.body.plans[0].wantToSee, /sweeps the Asia low/)
    assert.equal(today.body.plans[0].account.name, 'Lucid 50K')

    const missing = await api('/reviews', { method: 'POST', body: { ...REVIEW, symbol: 'MESZ6' } })
    assert.equal(missing.status, 400)
    assert.equal(missing.body.fieldErrors[0].field, 'planPlayedOut')

    const ok = await api('/reviews', { method: 'POST', body: { ...REVIEW, symbol: 'MESZ6', planPlayedOut: 'partly' } })
    assert.equal(ok.status, 201)
    assert.equal(ok.body.planPlayedOut, 'partly')
  })

  test('today is now marked reviewed', async () => {
    const { body } = await api('/reviews/today')
    assert.equal(body.recentDays[0].status, 'reviewed')
    assert.equal(body.reviews.length, 2)
    assert.equal(body.lastSymbol, 'MESZ6')
  })

  test('a review can be corrected on its day; writtenAt never moves', async () => {
    const before = await prisma.priceActionReview.findUnique({ where: { id: firstId } })
    const { status, body } = await api(`/reviews/${firstId}`, {
      method: 'PUT', body: { ...REVIEW, planPlayedOut: 'no', lesson: 'Corrected: the retest came 30 minutes later.' },
    })
    assert.equal(status, 200)
    assert.match(body.lesson, /Corrected/)
    assert.ok(body.lastEditedAt)
    assert.equal(new Date(body.writtenAt).getTime(), before.writtenAt.getTime())
  })

  test('charts must be images, and few', async () => {
    const { status, body } = await api(`/reviews/${firstId}`, { method: 'PUT', body: { ...REVIEW, planPlayedOut: 'no', screenshots: ['https://example.com/x.png'] } })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'screenshots')
  })

  test('the list leaves the images out', async () => {
    await api(`/reviews/${firstId}`, { method: 'PUT', body: { ...REVIEW, planPlayedOut: 'no', screenshots: ['data:image/jpeg;base64,AAAA'] } })
    const { body } = await api('/reviews')
    const row = body.find(r => r.id === firstId)
    assert.equal(row.screenshots, undefined)
    assert.equal(row.screenshotCount, 1)
    assert.equal((await api(`/reviews/${firstId}`)).body.screenshots.length, 1)
  })
})

describe('after the day', () => {
  const api = as('me')

  test("yesterday's review is closed to edits — and yesterday counts as reviewed", async () => {
    const yesterday = new Date(`${TODAY}T12:00:00Z`)
    do { yesterday.setUTCDate(yesterday.getUTCDate() - 1) } while ([0, 6].includes(yesterday.getUTCDay()))
    const date = yesterday.toISOString().slice(0, 10)
    const old = await prisma.priceActionReview.create({
      data: { userId: users.me.id, reviewDate: date, symbol: 'MNQZ6', marketTimezone: ZONE, marketOpenTime: '09:30', dayType: 'chop', summary: 'Chopped in the Asia range all morning.', validSetup: false },
    })
    const { status, body } = await api(`/reviews/${old.id}`, { method: 'PUT', body: { ...REVIEW } })
    assert.equal(status, 409)
    assert.match(body.error, /hindsight/)
    const today = await api('/reviews/today')
    assert.equal(today.body.recentDays[1].status, 'reviewed')
    assert.ok(today.body.recentDays.slice(2).every(d => d.status === 'missed'))
  })
})

describe('ownership', () => {
  test("another user's review is invisible to them", async () => {
    const mine = (await as('me')('/reviews')).body[0]
    assert.equal((await as('other')(`/reviews/${mine.id}`)).status, 404)
    assert.equal((await as('other')(`/reviews/${mine.id}`, { method: 'PUT', body: REVIEW })).status, 404)
    assert.equal((await as('other')('/reviews')).body.length, 0)
  })
})
