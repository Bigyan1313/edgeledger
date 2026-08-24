// End-to-end checks against a real Postgres and the real Express app: the
// acceptance criteria that only hold once the database is involved.
//
// Requires TEST_DATABASE_URL pointing at a throwaway database that has had
// `prisma migrate deploy` run against it. `npm run test:db` sets one up.
import { test, before, after, describe as rawDescribe } from 'node:test'
import assert from 'node:assert/strict'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-anywhere-real'

// Without a throwaway database these cannot run. Skipping is loud but not
// fatal, so `npm test` still exercises the pure domain rules anywhere.
const describe = TEST_DATABASE_URL ? rawDescribe : rawDescribe.skip
if (!TEST_DATABASE_URL) {
  console.log('TEST_DATABASE_URL is not set — skipping the database-backed API tests.')
}

let server, baseUrl, prisma, token, userId

// Imported dynamically: both the Prisma client and the JWT helper read their
// configuration at module load, so the env above has to be in place first.
before(async () => {
  if (!TEST_DATABASE_URL) return
  const [{ default: app }, { default: client }, { signToken }] = await Promise.all([
    import('../src/app.js'),
    import('../src/prisma/client.js'),
    import('../src/auth/jwt.js'),
  ])
  prisma = client

  await prisma.tradeAmendment.deleteMany({})
  await prisma.trade.deleteMany({})
  await prisma.user.deleteMany({ where: { email: 'apitest@example.com' } })
  const user = await prisma.user.create({
    data: { email: 'apitest@example.com', passwordHash: 'x' },
  })
  userId = user.id
  token = signToken(userId)

  server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s))
  })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  if (!TEST_DATABASE_URL) return
  await prisma?.tradeAmendment.deleteMany({})
  await prisma?.trade.deleteMany({})
  await prisma?.user.deleteMany({ where: { email: 'apitest@example.com' } })
  await prisma?.$disconnect()
  await new Promise(resolve => server?.close(resolve))
})

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const body = res.status === 204 ? null : await res.json()
  return { status: res.status, body }
}

let positionCounter = 0
const stageA = (overrides = {}) => ({
  brokerPositionId: `POS-${++positionCounter}-${Date.now()}`,
  brokerAccountId: 'CT-4471',
  brokerPlatform: 'cTrader',
  pair: 'XAUUSD.pro',
  direction: 'long',
  entryTimeUtc: '2026-08-01T13:30:00.000Z',
  captureTimezone: 'America/Chicago',
  entryPrice: 2350,
  stopLoss: 2345,
  takeProfit: 2365,
  lotSize: 0.5,
  technicalSetup: 'Break & retest',
  emotionalState: 'Calm',
  followedChecklist: true,
  fullPort: false,
  notes: 'Swept the Asia high, waited for the retest.',
  ...overrides,
})

describe('Task 1 — broker linkage', () => {
  test('a trade without brokerPositionId is rejected with a clear message', async () => {
    const { brokerPositionId, ...withoutId } = stageA()
    const { status, body } = await api('/trades', { method: 'POST', body: withoutId })
    assert.equal(status, 400)
    assert.match(body.error, /position ID is required/i)
    assert.ok(body.fieldErrors.some(e => e.field === 'brokerPositionId'))
  })

  test('two trades cannot share a brokerPositionId', async () => {
    const shared = stageA().brokerPositionId
    const first = await api('/trades', { method: 'POST', body: stageA({ brokerPositionId: shared }) })
    assert.equal(first.status, 201)

    const second = await api('/trades', {
      method: 'POST',
      body: stageA({ brokerPositionId: shared, entryPrice: 2400, stopLoss: 2395 }),
    })
    assert.equal(second.status, 409)
    assert.match(second.body.error, /already exists/i)
  })
})

describe('Task 2 — journaling latency', () => {
  test('journaledAt is set server-side and a client cannot dictate it', async () => {
    const { status, body } = await api('/trades', {
      method: 'POST',
      body: { ...stageA(), journaledAt: '2020-01-01T00:00:00.000Z' },
    })
    assert.equal(status, 201)
    assert.notEqual(new Date(body.journaledAt).getUTCFullYear(), 2020)
    assert.equal(body.lastEditedAt, null, 'nothing has been edited yet')
  })

  test('editing updates lastEditedAt only — journaledAt never moves', async () => {
    const created = await api('/trades', { method: 'POST', body: stageA() })
    const originalJournaledAt = created.body.journaledAt

    const closed = await api(`/trades/${created.body.id}/close`, {
      method: 'POST',
      body: { exitTimeUtc: '2026-08-01T15:00:00.000Z', exitPrice: 2360, pnl: 500, exitNotes: 'Target hit.' },
    })
    assert.equal(closed.status, 200)
    assert.equal(closed.body.journaledAt, originalJournaledAt)
    assert.ok(closed.body.lastEditedAt, 'lastEditedAt is set on the first edit')

    const edited = await api(`/trades/${created.body.id}`, {
      method: 'PUT',
      body: { exitNotes: 'Target hit, gave back a little on the trail.' },
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.journaledAt, originalJournaledAt, 'journaledAt is immutable')
    assert.notEqual(edited.body.lastEditedAt, closed.body.lastEditedAt)
  })

  test('the journaling lag is exposed on every trade', async () => {
    const { body } = await api('/trades', {
      method: 'POST',
      body: stageA({ entryTimeUtc: new Date(Date.now() - 90 * 60_000).toISOString() }),
    })
    assert.ok(body.journalingLagMinutes >= 89 && body.journalingLagMinutes <= 91,
      `expected a ~90 minute lag, got ${body.journalingLagMinutes}`)
    assert.ok(body.dataQualityFlags.includes('retroactive_journal'),
      'a 90-minute lag is not contemporaneous journaling and should say so')
  })
})

describe('Task 5 — risk fields', () => {
  test('the six rules reject bad input through the API', async () => {
    const cases = [
      [{ lotSize: -16.83 }, 'lotSize'],
      [{ stopLoss: -1 }, 'stopLoss'],
      [{ direction: 'long', entryPrice: 2350, stopLoss: 2360 }, 'stopLoss'],
      [{ direction: 'short', entryPrice: 2350, stopLoss: 2340 }, 'stopLoss'],
      [{ entryPrice: null }, 'entryPrice'],
    ]
    for (const [overrides, expectedField] of cases) {
      const { status, body } = await api('/trades', { method: 'POST', body: stageA(overrides) })
      assert.equal(status, 400, `expected ${JSON.stringify(overrides)} to be rejected`)
      assert.ok(body.fieldErrors.some(e => e.field === expectedField),
        `expected an error on ${expectedField}, got ${JSON.stringify(body.fieldErrors)}`)
    }
  })

  test('exitTime before entryTime is rejected on close', async () => {
    const created = await api('/trades', { method: 'POST', body: stageA() })
    const { status, body } = await api(`/trades/${created.body.id}/close`, {
      method: 'POST',
      body: { exitTimeUtc: '2026-08-01T12:00:00.000Z', exitPrice: 2360, pnl: 500 },
    })
    assert.equal(status, 400)
    assert.ok(body.fieldErrors.some(e => e.field === 'exitTimeUtc'))
  })

  test('a pnl sign that contradicts the price move is rejected on close', async () => {
    const created = await api('/trades', { method: 'POST', body: stageA() })
    const { status, body } = await api(`/trades/${created.body.id}/close`, {
      method: 'POST',
      body: { exitTimeUtc: '2026-08-01T15:00:00.000Z', exitPrice: 2360, pnl: -500 },
    })
    assert.equal(status, 400)
    assert.ok(body.fieldErrors.some(e => e.field === 'pnl'))
  })

  test('riskDollars and rMultiple are computed, not accepted from the client', async () => {
    const created = await api('/trades', {
      method: 'POST',
      body: { ...stageA(), riskDollars: 99999, outcome: 'Win' },
    })
    const closed = await api(`/trades/${created.body.id}/close`, {
      method: 'POST',
      body: { exitTimeUtc: '2026-08-01T15:00:00.000Z', exitPrice: 2360, pnl: 500 },
    })
    assert.equal(closed.body.riskDollars, 250) // |2350-2345| × 0.5 × 100
    assert.equal(closed.body.rMultiple, 2)
    assert.equal(closed.body.outcome, 'Win')
  })
})

describe('Task 7 — two-stage entry', () => {
  test('a new trade lands at Stage A and is queryable as pending', async () => {
    const created = await api('/trades', { method: 'POST', body: stageA() })
    assert.equal(created.body.entryStage, 'pending_exit')

    const pending = await api('/trades?stage=pending_exit')
    assert.ok(pending.body.some(t => t.id === created.body.id))
  })

  test('a Stage A field cannot be changed through the ordinary edit path', async () => {
    const created = await api('/trades', { method: 'POST', body: stageA() })
    const { status, body } = await api(`/trades/${created.body.id}`, {
      method: 'PUT',
      body: { technicalSetup: 'Trend continuation' },
    })
    assert.equal(status, 409)
    assert.deepEqual(body.lockedFields, ['technicalSetup'])
    assert.match(body.error, /locked/i)

    const unchanged = await api(`/trades/${created.body.id}`)
    assert.equal(unchanged.body.technicalSetup, 'Break & retest')
  })

  test('changing technicalSetup or emotionalState produces an audit record', async () => {
    const created = await api('/trades', { method: 'POST', body: stageA() })
    assert.equal(created.body.wasAmended, false)

    const amended = await api(`/trades/${created.body.id}/amend`, {
      method: 'POST',
      body: {
        fields: { technicalSetup: 'Trend continuation', emotionalState: 'Revenge' },
        reason: 'Misclassified at entry; it was a continuation and I was on tilt.',
      },
    })
    assert.equal(amended.status, 200)
    assert.equal(amended.body.technicalSetup, 'Trend continuation')
    assert.equal(amended.body.emotionalState, 'Revenge')
    assert.equal(amended.body.wasAmended, true)
    assert.ok(amended.body.amendedAt)

    const { body: trail } = await api(`/trades/${created.body.id}/amendments`)
    assert.equal(trail.length, 2)

    const setupRecord = trail.find(a => a.field === 'technicalSetup')
    assert.equal(setupRecord.oldValue, 'Break & retest', 'the original value is preserved')
    assert.equal(setupRecord.newValue, 'Trend continuation')
    assert.match(setupRecord.reason, /Misclassified/)

    const emotionRecord = trail.find(a => a.field === 'emotionalState')
    assert.equal(emotionRecord.oldValue, 'Calm')
  })

  test('an amendment without a reason is refused', async () => {
    const created = await api('/trades', { method: 'POST', body: stageA() })
    const { status } = await api(`/trades/${created.body.id}/amend`, {
      method: 'POST',
      body: { fields: { technicalSetup: 'Trend continuation' } },
    })
    assert.equal(status, 400)
  })

  test('an amendment cannot put the trade into a state it could never have been created in', async () => {
    const created = await api('/trades', { method: 'POST', body: stageA() })
    const { status, body } = await api(`/trades/${created.body.id}/amend`, {
      method: 'POST',
      body: { fields: { stopLoss: 2400 }, reason: 'typo' }, // above entry on a long
      })
    assert.equal(status, 400)
    assert.ok(body.fieldErrors.some(e => e.field === 'stopLoss'))

    const untouched = await api(`/trades/${created.body.id}`)
    assert.equal(untouched.body.stopLoss, 2345)
    assert.equal(untouched.body.wasAmended, false, 'a rejected amendment leaves no trace')
  })

  test('the pipeline can filter to trades where no amendment occurred', async () => {
    const { body: all } = await api('/trades')
    assert.ok(all.length > 0)
    const untouched = all.filter(t => !t.wasAmended)
    assert.ok(untouched.length > 0)
    assert.ok(untouched.every(t => t.amendedAt == null))
  })

  test('Stage B values stay freely editable — there is no intent to protect in a result', async () => {
    const created = await api('/trades', { method: 'POST', body: stageA() })
    await api(`/trades/${created.body.id}/close`, {
      method: 'POST',
      body: { exitTimeUtc: '2026-08-01T15:00:00.000Z', exitPrice: 2360, pnl: 500 },
    })
    const edited = await api(`/trades/${created.body.id}`, {
      method: 'PUT',
      body: { exitNotes: 'Reviewed a week later: the trail was too tight.' },
    })
    assert.equal(edited.status, 200)
    assert.equal(edited.body.wasAmended, false, 'a Stage B edit is not an amendment')
  })
})

describe('Task 8 — legacy rows', () => {
  test('v1 rows do not appear in the default list, and do with the explicit toggle', async () => {
    const legacy = await prisma.trade.create({
      data: {
        userId,
        schemaVersion: 1,
        entryTimeUtc: new Date('2026-06-01T08:00:00Z'),
        pair: 'XAUUSD',
        direction: 'long',
        legacySetup: 'Other',
        pnl: 120,
        entryStage: 'complete',
        journaledAt: new Date('2026-06-01T08:04:00Z'),
        dataQualityFlags: ['legacy_unlinked', 'missing_stop_loss'],
      },
    })

    const { body: defaultList } = await api('/trades')
    assert.ok(!defaultList.some(t => t.id === legacy.id), 'a v1 row must not appear by default')
    assert.ok(defaultList.every(t => t.schemaVersion === 2))

    const { body: withLegacy } = await api('/trades?includeLegacy=true')
    assert.ok(withLegacy.some(t => t.id === legacy.id), 'the explicit toggle includes it')
  })
})
