import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET
const EXPIRES_IN = '7d'

if (!SECRET) {
  throw new Error('JWT_SECRET is not set in .env')
}

// Create a signed token carrying the user's id.
export function signToken(userId) {
  return jwt.sign({ userId }, SECRET, { expiresIn: EXPIRES_IN })
}

// Verify a token's signature + expiry. Throws if invalid.
export function verifyToken(token) {
  return jwt.verify(token, SECRET)  // returns the decoded payload, e.g. { userId, iat, exp }
}
