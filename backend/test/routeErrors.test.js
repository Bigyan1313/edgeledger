// Database outages must reach Express's error middleware rather than escape
// as unhandled rejections. Stub only Prisma and the model, leaving the actual
// routers in charge of dispatch; these regressions need no running database.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import prisma from '../src/prisma/client.js'
import profileRouter from '../src/routes/profile.js'
import { createExtractRouter } from '../src/routes/extract.js'

// Prisma methods are provided through a Proxy, so restore the callable value
// directly instead of asking node:test to replace its property descriptor.
function stubMethod(t, target, name, replacement) {
  const original = target[name]
  target[name] = replacement
  t.after(() => { target[name] = original })
}

function routeError(router, method, url, body = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Route did not forward its error')), 1000)
    const req = { method, url, body, userId: 42 }
    const res = {
      json() {
        clearTimeout(timer)
        reject(new Error('A failed database operation must not return a successful response'))
      },
    }
    router.handle(req, res, err => {
      clearTimeout(timer)
      resolve(err)
    })
  })
}

test('profile reads forward rejected database queries to error middleware', async t => {
  const failure = new Error('Profile table unavailable')
  stubMethod(t, prisma.profile, 'findUnique', async () => { throw failure })
  stubMethod(t, prisma.user, 'findUnique', async () => ({ email: 'test@example.com' }))

  assert.equal(await routeError(profileRouter, 'GET', '/'), failure)
})

test('profile saves forward rejected database writes to error middleware', async t => {
  const failure = new Error('Database disconnected')
  stubMethod(t, prisma.profile, 'upsert', async () => { throw failure })

  assert.equal(await routeError(profileRouter, 'PUT', '/', { displayName: 'Trader' }), failure)
})

test('screenshot imports forward failed duplicate lookups to error middleware', async t => {
  const failure = new Error('Database disconnected')
  stubMethod(t, prisma.trade, 'findFirst', async () => { throw failure })
  const client = {
    messages: {
      create: async () => ({
        content: [{
          type: 'tool_use',
          name: 'record_trade_from_screenshot',
          input: { brokerPositionId: 'position-1' },
        }],
      }),
    },
  }
  const router = createExtractRouter({ client })

  assert.equal(await routeError(router, 'POST', '/extract', {
    image: 'data:image/png;base64,AAAA',
  }), failure)
})
