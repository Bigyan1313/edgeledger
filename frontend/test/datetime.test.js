import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isoToZonedInput, possibleInstantsForLocal, zonedInputToIso } from '../src/utils/datetime.js'

test('a profile timezone determines the instant independently of the browser timezone', () => {
  assert.equal(zonedInputToIso('2026-09-09T09:00', 'Asia/Tokyo'), '2026-09-09T00:00:00.000Z')
  assert.equal(zonedInputToIso('2026-09-09T09:00', 'America/Chicago'), '2026-09-09T14:00:00.000Z')
})

test('UTC and fractional-offset timezones preserve the original instant', () => {
  const instant = '2026-09-09T23:50:12.345Z'
  for (const zone of ['UTC', 'Asia/Kathmandu', 'America/Chicago', 'Pacific/Chatham']) {
    assert.equal(zonedInputToIso(isoToZonedInput(instant, zone), zone), instant)
  }
  assert.equal(isoToZonedInput('2026-09-09T23:50:00Z', 'Asia/Kathmandu'), '2026-09-10T05:35')
})

test('midnight is formatted as hour zero rather than the next day at hour 24', () => {
  assert.equal(isoToZonedInput('2026-09-09T00:00:00Z', 'UTC'), '2026-09-09T00:00')
})

test('spring-forward gaps are rejected instead of silently changing the entered time', () => {
  assert.deepEqual(possibleInstantsForLocal('2026-03-08T02:30', 'America/Chicago'), [])
  assert.throws(() => zonedInputToIso('2026-03-08T02:30', 'America/Chicago'), /does not exist/)
})

test('fall-back overlaps require a choice and preserve imported or amended occurrences', () => {
  const local = '2026-11-01T01:30'
  const zone = 'America/Chicago'
  const occurrences = ['2026-11-01T06:30:00.000Z', '2026-11-01T07:30:00.000Z']
  assert.deepEqual(possibleInstantsForLocal(local, zone), occurrences)
  assert.throws(() => zonedInputToIso(local, zone), /occurs twice/)
  for (const instant of occurrences) {
    assert.equal(zonedInputToIso(isoToZonedInput(instant, zone), zone, instant), instant)
  }
})

test('half-hour DST transitions also expose both occurrences', () => {
  assert.deepEqual(possibleInstantsForLocal('2026-04-05T01:45', 'Australia/Lord_Howe'), [
    '2026-04-04T14:45:00.000Z', '2026-04-04T15:15:00.000Z',
  ])
})

test('invalid dates are rejected instead of being normalized into another month', () => {
  assert.throws(() => zonedInputToIso('2026-02-30T12:00', 'UTC'), /valid date/)
  assert.throws(() => zonedInputToIso('2026-09-09T24:00', 'UTC'), /valid date/)
})
