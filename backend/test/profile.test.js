// The trader profile: validation rules, and the API that stores them.
import { test, before, after, describe as rawDescribe } from 'node:test'
import assert from 'node:assert/strict'
import { validateProfile, coerceProfile, emptyProfile, BASE_CURRENCIES } from '../src/domain/profile.js'

// --- validation (no database needed) ---------------------------------------

test('an empty profile is valid — every field is optional', () => {
  assert.deepEqual(validateProfile({}), [])
  assert.deepEqual(validateProfile(emptyProfile()), [])
})

test('a fully filled profile is valid', () => {
  assert.deepEqual(validateProfile({
    displayName: 'Bigyan', timezone: 'America/Chicago', baseCurrency: 'USD',
    defaultBrokerPlatform: 'cTrader', defaultBrokerAccountId: '5039284',
    defaultRiskPercent: 1,
  }), [])
})

test('the timezone rule matches the trade model — no ambiguous abbreviations', () => {
  // "CST" is US Central in Chicago and China Standard in Shanghai. Accepting it
  // here would reintroduce the ambiguity captureTimezone exists to remove.
  for (const bad of ['CST', 'EST', 'GMT+2', 'Chicago']) {
    const errors = validateProfile({ timezone: bad })
    assert.ok(errors.some(e => e.field === 'timezone'), `expected "${bad}" to be rejected`)
  }
  for (const good of ['America/Chicago', 'Europe/London', 'Asia/Kathmandu', 'UTC']) {
    assert.deepEqual(validateProfile({ timezone: good }), [], `expected "${good}" to be accepted`)
  }
})

test('risk percent must be a real percentage', () => {
  for (const bad of [0, -1, 101, 'lots']) {
    assert.ok(validateProfile({ defaultRiskPercent: bad }).some(e => e.field === 'defaultRiskPercent'),
      `expected ${bad} to be rejected`)
  }
  for (const good of [0.25, 1, 2.5, 100]) {
    assert.deepEqual(validateProfile({ defaultRiskPercent: good }), [], `expected ${good} to be accepted`)
  }
})

test('platform and currency are held to their known sets', () => {
  assert.ok(validateProfile({ defaultBrokerPlatform: 'Tradovate' }).some(e => e.field === 'defaultBrokerPlatform'))
  assert.deepEqual(validateProfile({ defaultBrokerPlatform: 'cTrader' }), [])
  assert.ok(validateProfile({ baseCurrency: 'XYZ' }).some(e => e.field === 'baseCurrency'))
  for (const c of BASE_CURRENCIES) assert.deepEqual(validateProfile({ baseCurrency: c }), [])
})

test('an over-long display name is rejected rather than silently truncated', () => {
  assert.ok(validateProfile({ displayName: 'x'.repeat(61) }).some(e => e.field === 'displayName'))
  assert.deepEqual(validateProfile({ displayName: 'x'.repeat(60) }), [])
})

test('clearing a field stores null, not an empty string', () => {
  const out = coerceProfile({ displayName: '   ', timezone: '', defaultRiskPercent: null })
  assert.equal(out.displayName, null)
  assert.equal(out.timezone, null)
  assert.equal(out.defaultRiskPercent, null)
})

test('coercion ignores anything not a profile field', () => {
  const out = coerceProfile({ displayName: 'B', userId: 99, isAdmin: true, id: 5 })
  assert.deepEqual(Object.keys(out), ['displayName'])
})

test('currency is normalised to upper case, other text is trimmed', () => {
  const out = coerceProfile({ baseCurrency: ' usd ', defaultBrokerAccountId: '  5039284  ' })
  assert.equal(out.baseCurrency, 'USD')
  assert.equal(out.defaultBrokerAccountId, '5039284')
})

// --- the API ---------------------------------------------------------------

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL
process.env.DATABASE_URL = TEST_DATABASE_URL
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-not-used-anywhere-real'

const describe = TEST_DATABASE_URL ? rawDescribe : rawDescribe.skip
if (!TEST_DATABASE_URL) console.log('TEST_DATABASE_URL is not set — skipping the profile API tests.')

let server, baseUrl, prisma, token, userId

before(async () => {
  if (!TEST_DATABASE_URL) return
  const [{ default: app }, { default: client }, { signToken }] = await Promise.all([
    import('../src/app.js'), import('../src/prisma/client.js'), import('../src/auth/jwt.js'),
  ])
  prisma = client
  await prisma.user.deleteMany({ where: { email: 'profile@example.com' } })
  const user = await prisma.user.create({
    data: { email: 'profile@example.com', passwordHash: 'x', displayName: 'From Signup' },
  })
  userId = user.id
  token = signToken(userId)
  server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)) })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  if (!TEST_DATABASE_URL) return
  await prisma?.user.deleteMany({ where: { email: 'profile@example.com' } })
  await prisma?.$disconnect()
  await new Promise(resolve => server?.close(resolve))
})

async function api(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

describe('the profile API', () => {
  test('a user who has never saved one still gets a profile shape back', async () => {
    const { status, body } = await api('/profile')
    assert.equal(status, 200)
    assert.equal(body.email, 'profile@example.com')
    assert.equal(body.timezone, null)
    assert.equal(body.defaultRiskPercent, null)
  })

  test('the sign-up display name shows until the trader sets their own', async () => {
    const { body } = await api('/profile')
    assert.equal(body.displayName, 'From Signup')
  })

  test('saving creates the profile, and saving again updates it', async () => {
    const first = await api('/profile', {
      method: 'PUT',
      body: { displayName: 'Bigyan', timezone: 'America/Chicago', baseCurrency: 'usd', defaultRiskPercent: 1 },
    })
    assert.equal(first.status, 200)
    assert.equal(first.body.displayName, 'Bigyan')
    assert.equal(first.body.baseCurrency, 'USD')

    const second = await api('/profile', { method: 'PUT', body: { defaultRiskPercent: 0.5 } })
    assert.equal(second.status, 200)
    assert.equal(second.body.defaultRiskPercent, 0.5)

    assert.equal(await prisma.profile.count({ where: { userId } }), 1, 'upsert must not create a second row')
  })

  test('saved values survive a reload', async () => {
    await api('/profile', { method: 'PUT', body: { defaultBrokerPlatform: 'cTrader', defaultBrokerAccountId: '5039284' } })
    const { body } = await api('/profile')
    assert.equal(body.defaultBrokerPlatform, 'cTrader')
    assert.equal(body.defaultBrokerAccountId, '5039284')
  })

  test('an invalid value is rejected with the field named', async () => {
    const { status, body } = await api('/profile', { method: 'PUT', body: { timezone: 'CST' } })
    assert.equal(status, 400)
    assert.ok(body.fieldErrors.some(e => e.field === 'timezone'))
  })

  test('a rejected save leaves the stored profile untouched', async () => {
    const before = (await api('/profile')).body
    await api('/profile', { method: 'PUT', body: { defaultRiskPercent: 999 } })
    const after = (await api('/profile')).body
    assert.deepEqual(after, before)
  })

  test('clearing a field actually clears it', async () => {
    await api('/profile', { method: 'PUT', body: { defaultBrokerAccountId: '' } })
    assert.equal((await api('/profile')).body.defaultBrokerAccountId, null)
  })

  test('a client cannot write fields that are not part of the profile', async () => {
    const { status } = await api('/profile', { method: 'PUT', body: { displayName: 'B', userId: 99999, id: 1 } })
    assert.equal(status, 200)
    const row = await prisma.profile.findUnique({ where: { userId } })
    assert.equal(row.userId, userId, 'userId must come from the token, never the body')
  })

  test('authentication is required', async () => {
    const res = await fetch(`${baseUrl}/profile`)
    assert.equal(res.status, 401)
  })
})
