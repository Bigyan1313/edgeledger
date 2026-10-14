// The Tradovate import through the real app and database: preview writes
// nothing, apply closes only what was confirmed and is still open, the same
// file twice changes nothing the second time, and one user's export can never
// close another user's trades.
import { test, before, after, describe as rawDescribe } from 'node:test'
import assert from 'node:assert/strict'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-anywhere-real'

const describe = TEST_DATABASE_URL ? rawDescribe : rawDescribe.skip
if (!TEST_DATABASE_URL) console.log('TEST_DATABASE_URL is not set — skipping the import API tests.')

const EMAILS = { me: 'import-me@example.com', other: 'import-other@example.com' }
let server, baseUrl, prisma
const users = {}

// The real report's layout, invented numbers. Central time.
const CSV = [
  'symbol,_priceFormat,_priceFormatType,_tickSize,buyFillId,sellFillId,qty,buyPrice,sellPrice,pnl,boughtTimestamp,soldTimestamp,duration',
  // Long 5, 08:38:20 → 08:39:47 CT, +$215
  'MNQZ6,-2,0,0.25,1001,1002,5,21000.00,21021.50,$215.00,10/13/2026 08:38:20,10/13/2026 08:39:47,1min 27sec',
  // Short 5, 08:50:25 → 08:53:27 CT, −$277.50
  'MNQZ6,-2,0,0.25,1004,1003,5,21050.00,21022.25,$(277.50),10/13/2026 08:53:27,10/13/2026 08:50:25,3min 1sec',
  // Long 10, never journaled
  'MNQZ6,-2,0,0.25,1005,1006,10,21030.00,21031.25,$25.00,10/13/2026 09:15:11,10/13/2026 09:18:57,3min 46sec',
].join('\r\n')

before(async () => {
  if (!TEST_DATABASE_URL) return
  const [{ default: app }, { default: client }, { signToken }] = await Promise.all([
    import('../src/app.js'), import('../src/prisma/client.js'), import('../src/auth/jwt.js'),
  ])
  prisma = client
  await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } })
  for (const [key, email] of Object.entries(EMAILS)) {
    const user = await prisma.user.create({ data: { email, passwordHash: 'x' } })
    users[key] = { id: user.id, token: signToken(user.id) }
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

const as = (who) => async (path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json() }
}

// Stage A entries as the trader journaled them: times typed a little after
// the fill, prices as seen on screen.
const journal = (userId, over) => prisma.trade.create({
  data: { userId, pair: 'MNQZ6', entryStage: 'pending_exit', followedChecklist: true, fullPort: false, ...over },
})

describe('importing a Tradovate export', () => {
  const api = as('me')
  let longId, shortId

  before(async () => {
    if (!TEST_DATABASE_URL) return
    longId = (await journal(users.me.id, { direction: 'long', lotSize: 5, entryPrice: 21000, stopLoss: 20980, entryTimeUtc: new Date('2026-10-13T13:39:00Z') })).id
    shortId = (await journal(users.me.id, { direction: 'short', lotSize: 5, entryPrice: 21022.25, stopLoss: 21040, entryTimeUtc: new Date('2026-10-13T13:51:00Z') })).id
    // Another user's identical-looking long. Must never be touched.
    await journal(users.other.id, { direction: 'long', lotSize: 5, entryPrice: 21000, stopLoss: 20980, entryTimeUtc: new Date('2026-10-13T13:39:00Z') })
  })

  test('the timezone must be named', async () => {
    const { status, body } = await api('/imports/tradovate/preview', { csv: CSV, timezone: 'CST' })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'timezone')
  })

  test('a file that is not a Tradovate export is refused with what was found', async () => {
    const { status, body } = await api('/imports/tradovate/preview', { csv: 'a,b\n1,2', timezone: 'America/Chicago' })
    assert.equal(status, 400)
    assert.deepEqual(body.found, ['a', 'b'])
  })

  test('preview matches, explains, and writes nothing', async () => {
    const { status, body } = await api('/imports/tradovate/preview', { csv: CSV, timezone: 'America/Chicago' })
    assert.equal(status, 200)
    assert.deepEqual(body.summary, { brokerTrades: 3, willClose: 2, withProblems: 0, alreadyClosed: 0, ambiguous: 0, notInJournal: 1 })
    const short = body.rows.find(r => r.trade?.id === shortId)
    assert.equal(short.broker.direction, 'short')
    assert.equal(short.broker.pnl, -277.5)
    assert.equal((await prisma.trade.findUnique({ where: { id: longId } })).entryStage, 'pending_exit')
  })

  test('the wrong timezone matches nothing — an hour off is outside the tolerance', async () => {
    const { body } = await api('/imports/tradovate/preview', { csv: CSV, timezone: 'America/New_York' })
    assert.equal(body.summary.willClose, 0)
    assert.equal(body.summary.notInJournal, 3)
  })

  test('apply closes only the confirmed trade, with the broker\'s numbers', async () => {
    const { status, body } = await api('/imports/tradovate/apply', { csv: CSV, timezone: 'America/Chicago', tradeIds: [longId] })
    assert.equal(status, 200)
    assert.deepEqual(body.closed, [longId])
    // The response shows the state after closing, not before.
    assert.equal(body.rows.find(r => r.trade?.id === longId).status, 'already_closed')
    assert.equal(body.summary.willClose, 1)
    const long = await prisma.trade.findUnique({ where: { id: longId } })
    assert.equal(long.entryStage, 'complete')
    assert.equal(long.pnl, 215)
    assert.equal(long.exitPrice, 21021.5)
    assert.equal(long.exitTimeUtc.toISOString(), '2026-10-13T13:39:47.000Z')
    assert.ok(long.lastEditedAt)
    assert.equal((await prisma.trade.findUnique({ where: { id: shortId } })).entryStage, 'pending_exit')
  })

  test('the same file again closes nothing twice', async () => {
    const { body } = await api('/imports/tradovate/apply', { csv: CSV, timezone: 'America/Chicago', tradeIds: [longId, shortId] })
    assert.deepEqual(body.closed, [shortId])
    assert.equal(body.summary.alreadyClosed, 2)
    const again = await api('/imports/tradovate/apply', { csv: CSV, timezone: 'America/Chicago', tradeIds: [longId, shortId] })
    assert.deepEqual(again.body.closed, [])
    assert.equal(again.body.summary.alreadyClosed, 2)
  })

  test("another user's look-alike trade was never touched", async () => {
    const theirs = await prisma.trade.findFirst({ where: { userId: users.other.id } })
    assert.equal(theirs.entryStage, 'pending_exit')
    assert.equal(theirs.pnl, null)
  })

  test('a close that would break the Stage B rules is shown as a problem and not applied', async () => {
    // A 50-second scalp, 10:00:00 → 10:00:50 CT, journaled at 10:01:30 —
    // after the exit, but within the match tolerance of the entry. Exit-before-
    // entry is refused for an import as it is for a typed close.
    const SCALP = [
      CSV.split('\r\n')[0],
      'MNQZ6,-2,0,0.25,2001,2002,1,21100.00,21104.00,$8.00,10/13/2026 10:00:00,10/13/2026 10:00:50,50sec',
    ].join('\r\n')
    const late = await journal(users.me.id, { direction: 'long', lotSize: 1, entryPrice: 21100, stopLoss: 21090, entryTimeUtc: new Date('2026-10-13T15:01:30Z') })
    const { body } = await api('/imports/tradovate/preview', { csv: SCALP, timezone: 'America/Chicago' })
    const row = body.rows.find(r => r.trade?.id === late.id)
    assert.ok(row, 'the late entry is matched')
    assert.equal(body.summary.withProblems, 1)
    assert.match(row.problems.join(' '), /Exit time must be at or after entry time/)
    const applied = await api('/imports/tradovate/apply', { csv: SCALP, timezone: 'America/Chicago', tradeIds: [late.id] })
    assert.deepEqual(applied.body.closed, [])
    assert.equal((await prisma.trade.findUnique({ where: { id: late.id } })).entryStage, 'pending_exit')
  })
})
