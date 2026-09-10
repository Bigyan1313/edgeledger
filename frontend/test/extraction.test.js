import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyExtractedFields, notesForImport } from '../src/utils/extraction.js'

test('a closed screenshot preserves after-outcome provenance even if saved immediately', () => {
  const draft = applyExtractedFields({ notes: 'My existing notes', pair: 'EURUSD' }, {
    isClosed: true, entryTimeUtc: '2026-09-09T00:00:00Z', pair: null, entryPrice: 1.1,
  }, 'Asia/Tokyo')
  assert.equal(draft.entryTimeUtc, '2026-09-09T09:00')
  assert.equal(draft.entryInstant, '2026-09-09T00:00:00Z')
  assert.equal(draft.pair, 'EURUSD')
  assert.equal(draft.entryPrice, 1.1)
  assert.equal(draft.journaledAfterOutcome, true)
  assert.match(draft.notes, /^My existing notes\nLogged after/)
  assert.match(notesForImport('Revised notes', draft.journaledAfterOutcome), /Logged after/)
})

test('repeated imports keep one provenance note and an open import cannot erase it', () => {
  const first = applyExtractedFields({ notes: '' }, { isClosed: true }, 'UTC')
  const second = applyExtractedFields(first, { isClosed: false }, 'UTC')
  assert.equal(second.journaledAfterOutcome, true)
  assert.equal(second.notes, first.notes)
})

test('an open screenshot does not invent a retroactive marker', () => {
  const draft = applyExtractedFields({ notes: 'Original' }, { isClosed: false }, 'UTC')
  assert.equal(draft.journaledAfterOutcome, false)
  assert.equal(draft.notes, 'Original')
})
