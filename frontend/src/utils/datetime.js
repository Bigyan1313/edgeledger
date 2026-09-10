const formatters = new Map()

function wallTime(instant, timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }))
  }
  const date = new Date(instant)
  const parts = Object.fromEntries(formatters.get(timeZone).formatToParts(date).map(p => [p.type, p.value]))
  const millis = date.getUTCMilliseconds()
  return {
    text: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${String(millis).padStart(3, '0')}`,
    utc: Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second, millis),
  }
}

// datetime-local has no timezone of its own. Every display and conversion must
// use the same named zone, including imported instants and the Now button.
export function isoToZonedInput(iso, timeZone) {
  return wallTime(iso, timeZone).text.replace(/:00\.000$/, '').replace(/\.000$/, '')
}

export function possibleInstantsForLocal(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value)
  if (!match) throw new Error('Enter a valid date and time.')
  const [, year, month, day, hour, minute, second = '00', fraction = ''] = match
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, '0')}`
  const wallUtc = new Date(`${normalized}Z`).getTime()
  if (!Number.isFinite(wallUtc) || new Date(wallUtc).toISOString() !== `${normalized}Z`) {
    throw new Error('Enter a valid date and time.')
  }

  // Gather the offsets around this date, including both sides of a DST change.
  // Verify candidates by formatting them back; a skipped wall time has none,
  // while a repeated wall time has two and requires an explicit choice.
  const offsets = new Set()
  for (let hours = -36; hours <= 36; hours += 12) {
    const sample = wallUtc + hours * 60 * 60 * 1000
    offsets.add(wallTime(sample, timeZone).utc - sample)
  }
  return [...offsets]
    .map(offset => wallUtc - offset)
    .filter(candidate => wallTime(candidate, timeZone).utc === wallUtc)
    .sort((a, b) => a - b)
    .map(candidate => new Date(candidate).toISOString())
}

export function zonedInputToIso(value, timeZone, selectedInstant = null) {
  const candidates = possibleInstantsForLocal(value, timeZone)
  if (selectedInstant) {
    const selected = new Date(selectedInstant).toISOString()
    if (candidates.includes(selected)) return selected
  }
  if (candidates.length === 1) return candidates[0]
  if (candidates.length === 0) throw new Error(`That time does not exist in ${timeZone} because the clocks move forward. Choose a valid time.`)
  throw new Error(`That time occurs twice in ${timeZone}. Choose which occurrence you mean.`)
}
