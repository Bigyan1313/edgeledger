import { isoToZonedInput } from './datetime.js'

const RETROACTIVE_NOTE = 'Logged after the trade was closed (screenshot import).'

export function notesForImport(notes, journaledAfterOutcome) {
  if (!journaledAfterOutcome || notes.includes(RETROACTIVE_NOTE)) return notes
  return [notes.trim(), RETROACTIVE_NOTE].filter(Boolean).join('\n')
}

export function applyExtractedFields(form, fields, timeZone) {
  const next = { ...form }
  for (const key of ['brokerPositionId', 'brokerAccountId', 'brokerPlatform', 'pair',
    'direction', 'entryPrice', 'stopLoss', 'takeProfit', 'lotSize']) {
    if (fields[key] != null) next[key] = fields[key]
  }
  if (fields.entryTimeUtc) {
    next.entryTimeUtc = isoToZonedInput(fields.entryTimeUtc, timeZone)
    next.entryInstant = fields.entryTimeUtc
  }
  next.journaledAfterOutcome = form.journaledAfterOutcome || fields.isClosed === true
  next.notes = notesForImport(form.notes, next.journaledAfterOutcome)
  return next
}
