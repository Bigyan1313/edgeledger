// Account rules and standing through the real app and database. The math is
// pinned in standing.test.js; this is about the wiring — the right trades,
// the right user, the planned trade priced from the query, and the database
// refusing a half-specified drawdown even if the API were bypassed.
import { test, before, after, describe as rawDescribe } from 'node:test'
import assert from 'node:assert/strict'

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-anywhere-real'

const describe = TEST_DATABASE_URL ? rawDescribe : rawDescribe.skip
if (!TEST_DATABASE_URL) console.log('TEST_DATABASE_URL is not set — skipping the account API tests.')

const EMAILS = { me: 'accounts-me@example.com', other: 'accounts-other@example.com' }
let server, baseUrl, prisma
const users = {}

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

const as = (who) => async (path, options = {}) => {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${users[who].token}` },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  return { status: res.status, body: res.status === 204 ? null : await res.json() }
}

describe('account rules and standing', () => {
  const api = as('me')
  let lucid

  test('an account starts with no rules and therefore no room', async () => {
    lucid = (await api('/accounts', { method: 'POST', body: { name: 'Lucid 50K', mode: 'Live', startingBalance: 50000 } })).body
    const { status, body } = await api(`/accounts/${lucid.id}/standing`)
    assert.equal(status, 200)
    assert.equal(body.balance, 50000)
    assert.equal(body.status, 'no_rules')
  })

  test('a half-specified drawdown is refused', async () => {
    const { status, body } = await api(`/accounts/${lucid.id}`, { method: 'PUT', body: { maxDrawdown: 2000 } })
    assert.equal(status, 400)
    assert.equal(body.fieldErrors[0].field, 'drawdownType')
  })

  test('the firm\'s rules can be set', async () => {
    const { status, body } = await api(`/accounts/${lucid.id}`, {
      method: 'PUT', body: { dailyLossLimit: 1000, maxDrawdown: 2000, drawdownType: 'eod_trailing', drawdownLockBalance: 50100 },
    })
    assert.equal(status, 200)
    assert.equal(body.drawdownType, 'eod_trailing')
    assert.equal(body.name, 'Lucid 50K')
  })

  test('standing reflects today\'s closed trades, open stops, and the trade being planned', async () => {
    const now = new Date()
    await prisma.trade.createMany({
      data: [
        { userId: users.me.id, accountId: lucid.id, pair: 'MNQZ6', direction: 'long', entryTimeUtc: now, exitTimeUtc: now, entryStage: 'complete', pnl: -300 },
        { userId: users.me.id, accountId: lucid.id, pair: 'MNQZ6', direction: 'long', entryTimeUtc: now, entryPrice: 21000, stopLoss: 20980, lotSize: 2, entryStage: 'pending_exit' },
      ],
    })
    const { body } = await api(`/accounts/${lucid.id}/standing?pair=MNQZ6&entry=21000&stop=20975&lots=2`)
    assert.equal(body.balance, 49700)
    assert.equal(body.todayPnl, -300)
    assert.equal(body.dailyRemaining, 700)
    assert.equal(body.binding, 'daily')
    assert.equal(body.openRisk, 80)          // 20 pts × 2 × $2
    assert.equal(body.plannedRisk, 100)      // 25 pts × 2 × $2
    assert.equal(body.roomAfterPlanned, 520) // 700 − 80 − 100
    assert.equal(body.rules.drawdownLockBalance, 50100)
  })

  test("another user's trades never reach this account's standing", async () => {
    const other = (await as('other')('/accounts', { method: 'POST', body: { name: 'Mine', mode: 'Live', startingBalance: 1000 } })).body
    await prisma.trade.create({ data: { userId: users.other.id, accountId: other.id, pair: 'MNQZ6', direction: 'long', entryTimeUtc: new Date(), exitTimeUtc: new Date(), entryStage: 'complete', pnl: -999 } })
    const { body } = await api(`/accounts/${lucid.id}/standing`)
    assert.equal(body.todayPnl, -300)
  })

  test("another user's account cannot be read or edited", async () => {
    assert.equal((await as('other')(`/accounts/${lucid.id}/standing`)).status, 404)
    assert.equal((await as('other')(`/accounts/${lucid.id}`, { method: 'PUT', body: { dailyLossLimit: 1 } })).status, 404)
  })

  test('the account details themselves can be edited after creation', async () => {
    const renamed = await api(`/accounts/${lucid.id}`, { method: 'PUT', body: { name: 'Lucid Flex 50K', mode: 'Demo', propFirm: 'Lucid Trading' } })
    assert.equal(renamed.status, 200)
    assert.equal(renamed.body.name, 'Lucid Flex 50K')
    assert.equal(renamed.body.mode, 'Demo')
    assert.equal(renamed.body.propFirm, 'Lucid Trading')
    // Live accounts carry no prop firm, as at creation.
    const live = await api(`/accounts/${lucid.id}`, { method: 'PUT', body: { mode: 'Live' } })
    assert.equal(live.body.propFirm, null)
    assert.equal((await api(`/accounts/${lucid.id}`, { method: 'PUT', body: { mode: 'Paper' } })).status, 400)
    assert.equal((await api(`/accounts/${lucid.id}`, { method: 'PUT', body: { name: '  ' } })).status, 400)
  })

  test('clearing the drawdown clears both halves together', async () => {
    const { status, body } = await api(`/accounts/${lucid.id}`, {
      method: 'PUT', body: { maxDrawdown: '', drawdownType: '', drawdownLockBalance: '' },
    })
    assert.equal(status, 200)
    assert.equal(body.maxDrawdown, null)
    assert.equal(body.drawdownType, null)
  })

  test('the database refuses a drawdown without a type even if the API is bypassed', async () => {
    await assert.rejects(
      prisma.account.update({ where: { id: lucid.id }, data: { maxDrawdown: 2000 } }),
      /Account_drawdown_pair_check/,
    )
  })
})
