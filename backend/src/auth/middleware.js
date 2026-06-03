import { verifyToken } from './jwt.js'

// Express middleware: guards routes that require a logged-in user.
// Reads "Authorization: Bearer <token>", verifies it, and attaches req.userId.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const [scheme, token] = header.split(' ')

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' })
  }

  try {
    const payload = verifyToken(token)   // throws if signature/expiry invalid
    req.userId = payload.userId          // hand the user id to downstream handlers
    next()                               // pass control to the actual route
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}
