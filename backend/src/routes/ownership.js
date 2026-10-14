import prisma from '../prisma/client.js'

// Guard: if a record references an account, it must be one THIS user owns.
// (null/undefined account is allowed — trades and sessions can be untagged.)
export async function accountAllowed(accountId, userId) {
  if (accountId == null) return true
  const acct = await prisma.account.findFirst({
    where: { id: Number(accountId), userId },
  })
  return Boolean(acct)
}

// Query strings carry everything as text, and "no account" arrives as a
// missing parameter, an empty string, or the word null depending on the caller.
export function parseAccountId(raw) {
  if (raw === undefined || raw === null || raw === '' || raw === 'null') return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : NaN
}
