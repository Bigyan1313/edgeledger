import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { OAuth2Client } from 'google-auth-library'
import prisma from '../prisma/client.js'
import { signToken } from '../auth/jwt.js'

const router = Router()

const BCRYPT_COST = 12  // ~250ms per hash; raise as hardware improves

// Basic email shape check. Not exhaustive — just catches obvious garbage.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID)

// Shape the public response: our app token + a safe subset of the user.
// Never send passwordHash to the client.
function sendAuth(res, user, status = 200) {
  const token = signToken(user.id)
  res.status(status).json({
    token,
    user: { id: user.id, email: user.email, displayName: user.displayName },
  })
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { email, password, displayName } = req.body

  // --- validation ---
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'A valid email is required' })
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  // --- reject duplicate emails ---
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' })
  }

  // --- hash the password (slow + salted, never store plaintext) ---
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)

  const user = await prisma.user.create({
    data: { email, passwordHash, displayName: displayName || null },
  })

  sendAuth(res, user, 201)  // logged in immediately after signup
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' })
  }

  const user = await prisma.user.findUnique({ where: { email } })

  // user.passwordHash may be null for Google-only accounts — guard before compare.
  // Same generic error whether email is unknown OR password is wrong (don't leak which).
  const ok = user && user.passwordHash && await bcrypt.compare(password, user.passwordHash)
  if (!ok) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  sendAuth(res, user)
})

// POST /api/auth/google
// The frontend sends the ID token (a JWT signed by Google) as `credential`.
router.post('/google', async (req, res) => {
  const { credential } = req.body
  if (!credential) {
    return res.status(400).json({ error: 'Missing Google credential' })
  }

  // 1. Verify the token against Google's public keys.
  //    Checks signature, expiry, issuer, AND that the audience is OUR client id
  //    (so a token minted for some other app can't be replayed against us).
  let payload
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    })
    payload = ticket.getPayload()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid Google token' })
  }

  const { sub: googleId, email, name, email_verified } = payload
  if (!email || !email_verified) {
    return res.status(401).json({ error: 'Google account email not verified' })
  }

  // 2. Find-or-create (with account linking):
  //    a) already linked by googleId → log in
  let user = await prisma.user.findUnique({ where: { googleId } })

  if (!user) {
    //  b) same email exists from password signup → LINK the Google id to it
    const byEmail = await prisma.user.findUnique({ where: { email } })
    if (byEmail) {
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: { googleId },
      })
    } else {
      //  c) brand-new Google user → create with no password
      user = await prisma.user.create({
        data: { email, googleId, displayName: name || null },
      })
    }
  }

  // 3. From here it's identical to any other login: issue OUR app token.
  sendAuth(res, user)
})

export default router
