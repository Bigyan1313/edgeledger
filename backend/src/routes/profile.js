import { Router } from 'express'
import prisma from '../prisma/client.js'
import { validateProfile, coerceProfile, emptyProfile, PROFILE_FIELDS } from '../domain/profile.js'

const router = Router()

// Every route assumes requireAuth has set req.userId.

function serializeProfile(row, user) {
  return {
    ...emptyProfile(),
    ...(row ? Object.fromEntries(PROFILE_FIELDS.map(f => [f, row[f] ?? null])) : {}),
    // Always present so the client has something to greet the user with.
    email: user?.email ?? null,
  }
}

// GET /api/profile — this user's profile, whether or not they've ever saved one.
//
// A missing row is not an error; it is a profile nobody has filled in yet. It
// returns the same shape with every field null so the client renders one form
// either way.
router.get('/', async (req, res) => {
  const [row, user] = await Promise.all([
    prisma.profile.findUnique({ where: { userId: req.userId } }),
    prisma.user.findUnique({ where: { id: req.userId }, select: { email: true, displayName: true } }),
  ])

  const profile = serializeProfile(row, user)
  // Fall back to the name captured at sign-up (Google supplies one) until the
  // trader sets their own.
  if (!profile.displayName) profile.displayName = user?.displayName ?? null
  res.json(profile)
})

// PUT /api/profile — create or update it.
//
// Upsert rather than separate create/update: a profile is a single thing per
// user that either exists or doesn't, and making the client care which is a
// distinction without a difference.
router.put('/', async (req, res) => {
  const input = coerceProfile(req.body ?? {})
  const errors = validateProfile(input)
  if (errors.length) {
    return res.status(400).json({
      error: errors.map(e => e.message).join(' '),
      fieldErrors: errors,
    })
  }

  const row = await prisma.profile.upsert({
    where: { userId: req.userId },
    create: { userId: req.userId, ...input },
    update: input,
  })

  const user = await prisma.user.findUnique({
    where: { id: req.userId }, select: { email: true, displayName: true },
  })
  res.json(serializeProfile(row, user))
})

export default router
